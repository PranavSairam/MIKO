import AppKit
import ApplicationServices
import CryptoKit
import Foundation

// miko-ax: one-shot Accessibility helper for MIKO (spawned as a child process).
// Reads and writes only the focused text field of the frontmost app, and only
// when MIKO asks. Prints one JSON object. Text to insert arrives on stdin.
//
//   focus-info [--bundle <id>] [--activate <pid>]
//   capture                         selected text (Accessibility, else a deliberate ⌘C with clipboard restore)
//   replace --pid P --sig S --hash H [--method ax|copy]   replace that exact selection with stdin text
//   insert  --pid P [--sig S] [--mode append|replace|selection]  insert stdin text into a verified field
//   paste   --exclude-pid P [--expect-pid P]   paste stdin text into the field focused now (armed paste)
//
// Password fields (AXSecureTextField) are never read or written.

struct Out: Encodable {
    var ok: Bool
    var reason: String = ""
    var pid: Int32 = 0
    var bundle: String = ""
    var app: String = ""
    var role: String = ""
    var editable: Bool = false
    var secure: Bool = false
    var sig: String = ""
    var text: String? = nil
    var hash: String = ""
    var valueLength: Int = -1
    var method: String = ""
    var verified: Bool = false
    var clipboardRestored: Bool = false
    var changeCount: Int = 0
}

func emit(_ out: Out) -> Never {
    let data = (try? JSONEncoder().encode(out)) ?? Data("{\"ok\":false}".utf8)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    exit(0)
}

func fail(_ reason: String, _ base: Out = Out(ok: false)) -> Never {
    var o = base
    o.ok = false
    o.reason = reason
    emit(o)
}

let args = CommandLine.arguments
func flag(_ name: String) -> String? {
    guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func attr(_ e: AXUIElement, _ n: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, n as CFString, &v) == .success ? v : nil
}

func settable(_ e: AXUIElement, _ n: String) -> Bool {
    var s: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(e, n as CFString, &s) == .success && s.boolValue
}

func sha(_ s: String) -> String {
    SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

func frame(_ e: AXUIElement) -> String {
    var p = CGPoint.zero, z = CGSize.zero
    if let v = attr(e, "AXPosition") { AXValueGetValue(v as! AXValue, .cgPoint, &p) }
    if let v = attr(e, "AXSize") { AXValueGetValue(v as! AXValue, .cgSize, &z) }
    return "\(Int(p.x)),\(Int(p.y)),\(Int(z.width)),\(Int(z.height))"
}

let editableRoles: Set<String> = ["AXTextArea", "AXTextField", "AXComboBox", "AXSearchField"]

struct Target {
    let app: NSRunningApplication
    let element: AXUIElement?
    var out: Out
}

/// The frontmost app and its focused element, described. Never reads secure fields.
func focused() -> Target {
    guard AXIsProcessTrusted() else { fail("MIKO needs Accessibility permission (System Settings → Privacy & Security → Accessibility).") }
    guard let app = NSWorkspace.shared.frontmostApplication else { fail("No app is in front.") }
    var out = Out(ok: true, pid: app.processIdentifier, bundle: app.bundleIdentifier ?? "", app: app.localizedName ?? "App")
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    guard let raw = attr(axApp, "AXFocusedUIElement") else {
        out.reason = "\(out.app) doesn’t expose a focused field to macOS Accessibility."
        return Target(app: app, element: nil, out: out)
    }
    let el = raw as! AXUIElement
    let role = attr(el, "AXRole") as? String ?? ""
    let subrole = attr(el, "AXSubrole") as? String ?? ""
    out.role = role
    out.secure = subrole == "AXSecureTextField" || role == "AXSecureTextField"
    out.editable = !out.secure && (editableRoles.contains(role) || settable(el, "AXSelectedText") || settable(el, "AXValue"))
    out.sig = sha("\(app.processIdentifier)|\(role)|\(subrole)|\(frame(el))|\(attr(el, "AXIdentifier") as? String ?? "")|\(attr(el, "AXDescription") as? String ?? "")")
    if !out.secure, let value = attr(el, "AXValue") as? String { out.valueLength = value.count }
    return Target(app: app, element: el, out: out)
}

// MARK: Clipboard (all items, all types), conditional restore

struct Snapshot { let items: [[NSPasteboard.PasteboardType: Data]] }

func snapshot() -> Snapshot {
    let items = NSPasteboard.general.pasteboardItems ?? []
    return Snapshot(items: items.map { item in
        var d: [NSPasteboard.PasteboardType: Data] = [:]
        for t in item.types { if let v = item.data(forType: t) { d[t] = v } }
        return d
    })
}

/// Restores only if the clipboard still holds MIKO's own write (changeCount unchanged).
func restore(_ s: Snapshot, ifChange expected: Int) -> Bool {
    let delay = Int(ProcessInfo.processInfo.environment["MIKO_AX_RESTORE_DELAY_MS"] ?? "") ?? 0
    if delay > 0 { usleep(useconds_t(delay * 1000)) }
    let pb = NSPasteboard.general
    guard pb.changeCount == expected else { return false }
    pb.clearContents()
    if !s.items.isEmpty {
        let items: [NSPasteboardItem] = s.items.map { d in
            let item = NSPasteboardItem()
            for (t, v) in d { item.setData(v, forType: t) }
            return item
        }
        pb.writeObjects(items)
    }
    return true
}

func key(_ code: CGKeyCode, pid: pid_t) {
    let src = CGEventSource(stateID: .combinedSessionState)
    for down in [true, false] {
        let e = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)
        e?.flags = .maskCommand
        e?.postToPid(pid)
    }
}

/// Deliberate ⌘C in the frontmost app; returns copied text and restores the clipboard if untouched.
func copySelection(pid: pid_t) -> (String?, Bool) {
    let saved = snapshot()
    let pb = NSPasteboard.general
    let before = pb.changeCount
    key(8, pid: pid) // C
    var copied: String? = nil
    for _ in 0..<30 {
        usleep(20_000)
        if pb.changeCount != before { copied = pb.string(forType: .string); break }
    }
    if copied == nil { return (nil, false) }
    return (copied, restore(saved, ifChange: pb.changeCount))
}

func activate(_ pid: pid_t) -> Bool {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return true }
    // Accessibility's AXFrontmost targets this exact process and works from a background helper
    // (macOS can ignore NSRunningApplication.activate() from a process that isn't active).
    AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), "AXFrontmost" as CFString, kCFBooleanTrue)
    for _ in 0..<20 {
        usleep(25_000)
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return true }
    }
    app.activate()
    for _ in 0..<40 {
        usleep(25_000)
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid { return true }
    }
    return false
}

func stdinText() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(decoding: data, as: UTF8.self)
}

/// Insert via Accessibility when the field allows it; verify by reading the value back.
func axInsert(_ el: AXUIElement, _ text: String, mode: String) -> Bool {
    if ProcessInfo.processInfo.environment["MIKO_AX_FORCE_PASTE"] == "1" { return false } // tests only
    if mode == "replace", settable(el, "AXValue") {
        guard AXUIElementSetAttributeValue(el, "AXValue" as CFString, text as CFString) == .success else { return false }
        return (attr(el, "AXValue") as? String) == text
    }
    if mode == "append", settable(el, "AXValue"), let current = attr(el, "AXValue") as? String {
        let next = current.isEmpty ? text : current + (current.hasSuffix("\n") ? "" : "\n") + text
        guard AXUIElementSetAttributeValue(el, "AXValue" as CFString, next as CFString) == .success else { return false }
        return (attr(el, "AXValue") as? String) == next
    }
    guard settable(el, "AXSelectedText") else { return false }
    let before = attr(el, "AXValue") as? String
    guard AXUIElementSetAttributeValue(el, "AXSelectedText" as CFString, text as CFString) == .success else { return false }
    usleep(60_000)
    if let after = attr(el, "AXValue") as? String { return after.contains(text) && after != before }
    return false
}

/// Paste via ⌘V with the clipboard preserved. Verified when the field's value can be read.
func pasteInsert(_ t: Target, _ text: String) -> (Bool, Bool, Bool) {
    let saved = snapshot()
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text, forType: .string)
    let ours = pb.changeCount
    let before = t.element.flatMap { attr($0, "AXValue") as? String }
    key(9, pid: t.app.processIdentifier) // V
    usleep(250_000)
    var verified = false
    if let el = t.element, let after = attr(el, "AXValue") as? String { verified = after.contains(text) && after != before }
    let restored = restore(saved, ifChange: ours)
    return (true, verified, restored)
}

// MARK: Commands

let command = args.count > 1 ? args[1] : ""
switch command {
case "focus-info":
    if let p = flag("--activate"), let pid = Int32(p), !activate(pid) { fail("Couldn’t bring that app to the front.") }
    let t = focused()
    var o = t.out
    if let b = flag("--bundle"), o.bundle != b { fail("\(b) isn’t the app in front (\(o.app) is).", o) }
    if t.element == nil { o.ok = false }
    emit(o)

case "capture":
    let t = focused()
    var o = t.out
    if o.secure { fail("That’s a password field. MIKO never reads it.", o) }
    if let el = t.element, let sel = attr(el, "AXSelectedText") as? String, !sel.isEmpty {
        o.text = sel; o.hash = sha(sel); o.method = "ax"; emit(o)
    }
    let (copied, restored) = copySelection(pid: t.app.processIdentifier)
    guard let text = copied, !text.isEmpty else { fail("No selected text found in \(o.app).", o) }
    o.text = text; o.hash = sha(text); o.method = "copy"; o.clipboardRestored = restored
    emit(o)

case "replace":
    guard let p = flag("--pid"), let pid = Int32(p), let sig = flag("--sig"), let hash = flag("--hash") else { fail("Missing target.") }
    let text = stdinText()
    guard activate(pid) else { fail("The original app isn’t available any more.") }
    usleep(150_000)
    let t = focused()
    var o = t.out
    guard let el = t.element, o.editable else { fail("The original field isn’t focused or editable any more.", o) }
    guard o.sig == sig else { fail("The focus moved to a different field. Choose the target again.", o) }
    if (flag("--method") ?? "ax") == "ax" {
        guard let sel = attr(el, "AXSelectedText") as? String, sha(sel) == hash else { fail("The selection changed. Select the text again.", o) }
    } else {
        let (current, _) = copySelection(pid: pid)
        guard let cur = current, sha(cur) == hash else { fail("The selection changed. Select the text again.", o) }
    }
    if axInsert(el, text, mode: "selection") { o.method = "ax"; o.verified = true; emit(o) }
    let (_, verified, restored) = pasteInsert(t, text)
    o.method = "paste"; o.verified = verified; o.clipboardRestored = restored
    emit(o)

case "insert":
    guard let p = flag("--pid"), let pid = Int32(p) else { fail("Missing target.") }
    let text = stdinText()
    guard activate(pid) else { fail("Couldn’t bring that app to the front.") }
    usleep(200_000)
    let t = focused()
    var o = t.out
    guard o.pid == pid else { fail("A different app came to the front.", o) }
    guard let el = t.element, o.editable else { fail(o.reason.isEmpty ? "No editable field is focused in \(o.app)." : o.reason, o) }
    if let sig = flag("--sig"), o.sig != sig { fail("The focused field changed. Try again.", o) }
    let mode = flag("--mode") ?? "selection"
    if axInsert(el, text, mode: mode) { o.method = "ax"; o.verified = true; emit(o) }
    fail("Couldn’t insert and verify the text in \(o.app). Nothing was typed.", o)

case "paste":
    let text = stdinText()
    let t = focused()
    var o = t.out
    if let ex = flag("--exclude-pid"), Int32(ex) == o.pid { fail("MIKO is in front. Click into the field you want first.", o) }
    if let want = flag("--expect-pid"), Int32(want) != o.pid { fail("\(o.app) is in front, not the app you chose.", o) }
    guard t.element != nil, o.editable else { fail(o.secure ? "That’s a password field. MIKO won’t paste there." : "The focused place in \(o.app) isn’t an editable text field.", o) }
    if let el = t.element, axInsert(el, text, mode: "selection") { o.method = "ax"; o.verified = true; emit(o) }
    let (_, verified, restored) = pasteInsert(t, text)
    o.method = "paste"; o.verified = verified; o.clipboardRestored = restored
    emit(o)

default:
    fail("Unknown command.")
}
