import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import IOKit
import IOKit.hid

// MIKO Keys: watches two chords system-wide and reports them as JSON lines.
//   Hold Caps Lock + A  -> {"event":"talk-start"} ... {"event":"talk-stop"}
//   Tab + Q             -> {"event":"switcher"}
// The A and Q of a chord are swallowed. Caps Lock is put back to the state it
// had before the chord. Nothing is logged or stored; only these events leave.
// A plain Tab is held back until it's clear whether Q follows: with Q it opens the fan
// (and never reaches the app); without Q the Tab is replayed so the app gets it as usual.

let kCaps: CGKeyCode = 57
let kA: CGKeyCode = 0
let kTab: CGKeyCode = 48
let kQ: CGKeyCode = 12

func send(_ json: String) {
    FileHandle.standardOutput.write(Data((json + "\n").utf8))
}

/// Caps Lock is read from the keyboard itself (IOHIDManager). CGEventSource.keyState(57)
/// reports the Caps Lock *lock state*, not whether the key is held, so it would make every
/// "a" typed with Caps Lock on start a recording.
var capsHeld = false

func physicallyDown(_ key: CGKeyCode) -> Bool {
    if key == kCaps { return capsHeld }
    return CGEventSource.keyState(.hidSystemState, key: key)
}

func capsLockState() -> Bool {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching(kIOHIDSystemClass))
    guard service != 0 else { return false }
    defer { IOObjectRelease(service) }
    var connect: io_connect_t = 0
    guard IOServiceOpen(service, mach_task_self_, UInt32(kIOHIDParamConnectType), &connect) == KERN_SUCCESS else { return false }
    defer { IOServiceClose(connect) }
    var state = false
    IOHIDGetModifierLockState(connect, Int32(kIOHIDCapsLockState), &state)
    return state
}

func setCapsLock(_ on: Bool) {
    let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching(kIOHIDSystemClass))
    guard service != 0 else { return }
    defer { IOObjectRelease(service) }
    var connect: io_connect_t = 0
    guard IOServiceOpen(service, mach_task_self_, UInt32(kIOHIDParamConnectType), &connect) == KERN_SUCCESS else { return }
    IOHIDSetModifierLockState(connect, Int32(kIOHIDCapsLockState), on)
    IOServiceClose(connect)
}

var tap: CFMachPort?
var talking = false
var swallowAUp = false
var swallowQUp = false
/// A plain Tab went down and is being held back (Tab + Q, or replayed on release).
var tabHeld = false
var tabUsedForSwitcher = false
var tabFlags: CGEventFlags = []
/// Events MIKO Keys posts itself (a replayed Tab) carry this mark and pass straight through.
let replayMark: Int64 = 0x4D494B4F

func postKey(_ code: CGKeyCode, down: Bool, flags: CGEventFlags) {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { return }
    event.flags = flags
    event.setIntegerValueField(.eventSourceUserData, value: replayMark)
    event.post(tap: .cgSessionEventTap)
}

/// Give the held-back Tab to the app (as a normal press).
func releaseHeldTab() {
    guard tabHeld else { return }
    tabHeld = false
    if !tabUsedForSwitcher {
        postKey(kTab, down: true, flags: tabFlags)
        postKey(kTab, down: false, flags: tabFlags)
    }
}

func frontPid() -> Int32 {
    return NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0
}
/// Caps Lock lock state, refreshed every 50 ms while the key is not held.
var lastCaps = false
/// Snapshot of lastCaps when Caps Lock went down: what to restore after a chord.
var capsBefore = false
var restorePending = false

func stopTalk() {
    guard talking else { return }
    talking = false
    send("{\"event\":\"talk-stop\"}")
    restorePending = true
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    if event.getIntegerValueField(.eventSourceUserData) == replayMark {
        return Unmanaged.passUnretained(event)
    }
    let code = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))

    if type == .flagsChanged {
        return Unmanaged.passUnretained(event)
    }

    if code == kTab {
        let modified = !event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift]).isEmpty
        if type == .keyDown {
            // Hold a plain Tab back (and its auto-repeats while held) until we know if Q follows.
            if tabHeld { return nil }
            if !modified && event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                tabHeld = true
                tabUsedForSwitcher = false
                tabFlags = event.flags
                return nil
            }
        } else if type == .keyUp && tabHeld {
            // Without Q this replays the whole press (down + up); after Tab + Q it posts nothing.
            releaseHeldTab()
            return nil
        }
        return Unmanaged.passUnretained(event)
    }

    // Any other key while Tab is held (except Q): hand the Tab over first so typing order is kept.
    if type == .keyDown && tabHeld && code != kQ {
        releaseHeldTab()
    }

    if code == kA {
        if type == .keyDown && (talking || physicallyDown(kCaps)) {
            if !talking {
                talking = true
                swallowAUp = true
                send("{\"event\":\"talk-start\"}")
            }
            return nil
        }
        if type == .keyUp && swallowAUp {
            swallowAUp = false
            stopTalk()
            return nil
        }
    }

    if code == kQ {
        if type == .keyDown && (swallowQUp || tabHeld || physicallyDown(kTab)) {
            if !swallowQUp && event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                tabUsedForSwitcher = true
                send("{\"event\":\"switcher\",\"front\":\(frontPid())}")
            }
            swallowQUp = true
            return nil
        }
        if type == .keyUp && swallowQUp {
            swallowQUp = false
            return nil
        }
    }

    return Unmanaged.passUnretained(event)
}

func installTap() -> Bool {
    let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue) | (1 << CGEventType.flagsChanged.rawValue)
    guard let created = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .defaultTap,
        eventsOfInterest: CGEventMask(mask),
        callback: callback,
        userInfo: nil
    ) else { return false }
    tap = created
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: created, enable: true)
    return true
}

send("{\"pid\":\(getpid())}")
lastCaps = capsLockState()

/// Physical Caps Lock press/release from every keyboard (usage page 0x07, usage 0x39).
let hid = IOHIDManagerCreate(kCFAllocatorDefault, IOOptionBits(kIOHIDOptionsTypeNone))
IOHIDManagerSetDeviceMatching(hid, [kIOHIDDeviceUsagePageKey: kHIDPage_GenericDesktop, kIOHIDDeviceUsageKey: kHIDUsage_GD_Keyboard] as CFDictionary)
IOHIDManagerRegisterInputValueCallback(hid, { _, _, _, value in
    let element = IOHIDValueGetElement(value)
    guard IOHIDElementGetUsagePage(element) == UInt32(kHIDPage_KeyboardOrKeypad),
          IOHIDElementGetUsage(element) == UInt32(kHIDUsage_KeyboardCapsLock) else { return }
    let down = IOHIDValueGetIntegerValue(value) != 0
    if down && !capsHeld && !talking && !restorePending { capsBefore = lastCaps }
    capsHeld = down
}, nil)
IOHIDManagerScheduleWithRunLoop(hid, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
var hidOpen = IOHIDManagerOpen(hid, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess
if !hidOpen {
    // Input Monitoring: ask once, keep retrying until granted. Tab + Q keeps working meanwhile.
    _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
    send("{\"error\":\"permission\"}")
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { timer in
        if IOHIDManagerOpen(hid, IOOptionBits(kIOHIDOptionsTypeNone)) == kIOReturnSuccess {
            hidOpen = true
            timer.invalidate()
        }
    }
}

// Release watch: either key let go ends the talk. Once Caps Lock is up, restore its state.
Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { _ in
    if !capsHeld && !talking && !restorePending { lastCaps = capsLockState() }
    if talking && (!physicallyDown(kCaps) || !physicallyDown(kA)) { stopTalk() }
    if restorePending && !physicallyDown(kCaps) {
        setCapsLock(capsBefore)
        lastCaps = capsBefore
        restorePending = false
    }
}

if !installTap() {
    // Ask once, then wait for the grant instead of exiting.
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
    send("{\"error\":\"permission\"}")
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { timer in
        if installTap() { timer.invalidate() }
    }
}

// MIKO passes its pid. If MIKO goes away without stopping us (crash, kill), exit too:
// a leftover helper would keep swallowing A and Q with nobody listening.
if let index = CommandLine.arguments.firstIndex(of: "--parent"),
   index + 1 < CommandLine.arguments.count,
   let parent = Int32(CommandLine.arguments[index + 1]), parent > 1 {
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        if kill(parent, 0) != 0 && errno == ESRCH { exit(0) }
    }
}

CFRunLoopRun()
