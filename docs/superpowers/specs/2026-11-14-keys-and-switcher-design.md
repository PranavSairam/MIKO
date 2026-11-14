# Hold-to-talk keys and app switcher: design

Date: 2026-11-14 · Status: awaiting approval · Platform: macOS first (Windows later)

## Why
The user wants MIKO to make moving around the Mac easier:
- talk to MIKO by holding a key chord instead of clicking Mic
- see every running app at a glance and jump straight into one

## Goals
1. **Hold Caps Lock + A to talk.** Listening starts when both are down and stops when either is released. The transcript lands in the chat box, which opens if it is closed. Nothing is auto-sent (decided earlier: the user reviews and presses Send).
2. **App switcher.** Opened by **Tab + Q** or by a **single click on MIKO**. It shows every running app and lets you jump into one. Browser tabs (Chrome, Safari) can be opened from their app's card.

## Non-goals (for now)
- Windows support for the chords and the switcher (the existing Windows paths keep working as they are)
- Window-level switching inside one app (e.g. two Finder windows), other browsers (Arc, Firefox, Edge), and tab titles from apps that aren't browsers
- Changing the ⌘⇧R summon shortcut or double-click → chat

## Anti-goals (a failure even if it "works")
- Typing gets noticeably laggy anywhere because MIKO is watching keys
- Caps Lock is left in the wrong state after talking
- A stray "a" or "q" gets typed into the user's app

## Approaches considered
1. **Keep the user's exact chords with a native key helper** *(picked; the user handed the choice to me)*. It catches Caps+A and Tab+Q, hides the A/Q, and restores Caps Lock. Cost: the Tab itself still reaches the front app (a tab character or focus jump) before Q is seen.
2. Same, but hold every Tab back until we know whether Q follows. Rejected because it makes Tab laggy in every app (anti-goal).
3. Chords that don't type anything (Right-⌥ hold, ⌥+Tab). This would be the fallback if the stray Tab gets annoying, and swapping is a one-line change.

## Design

### Key helper: `resources/keys-mac.swift` → "MIKO Keys.app"
- A small Swift app using an active `CGEventTap` (keyDown/keyUp/flagsChanged). It is compiled, signed, and launched through LaunchServices the same way as the speech helper, so it has its own permission identity. It reports events as JSON lines through a FIFO.
- **Caps + A:** Caps Lock down plus A down sends `talk-start`. Releasing either sends `talk-stop`. The A key events are swallowed. Afterwards Caps Lock is put back to the state it had before the chord (IOKit `IOHIDSetModifierLockState`). Caps Lock's own "is it held" state comes from raw key down/up (keycode 57), not from the toggle flag.
- **Tab + Q:** while Tab is held, Q down sends `switcher` and the Q is swallowed. Tab passes through untouched (accepted cost).
- **Permissions:** macOS asks once for Accessibility (and possibly Input Monitoring) for "MIKO Keys". If it is denied, MIKO says so in the panel and click/Mic keep working.
- It runs only while MIKO is running and stops when MIKO quits.

### Hold-to-talk changes
- `talk-start` opens the panel if needed, then starts listening. `talk-stop` calls the existing stop (SIGUSR1) and the transcript fills the draft.
- The Swift listen helper gets a "hold" mode: no 8 s auto-finish, and the main-process cap becomes 60 s (Apple's on-device limit is about 1 min). The Mic button keeps today's 8 s behavior.

### Shared launcher
- The LaunchServices + FIFO + signal code in `speech.ts` moves into `src/main/helper-app.ts` so both helpers use the same code.

### App switcher
- **Data:** running "regular" apps (the ones with a Dock icon) from `NSWorkspace` via a JXA script: name, bundle id, bundle path, pid, and whether hidden. They are ordered front-to-back by on-screen window order (CGWindowList owner names, which needs no Screen Recording permission), so the app you were just in is first. Icons come from Electron `app.getFileIcon(bundlePath)`.
- **Look ("creative"):** a separate transparent, always-on-top window anchored above MIKO. App cards fan out in an arc over the dog like a hand of cards, with MIKO sitting and looking up at them. More than about 12 apps wrap onto a second, wider arc.
- **Using it:**
  - Click a card, or use ←/→ and Enter, to switch into that app.
  - Typing letters filters the cards by name. Esc, a click outside, or Tab+Q again closes it.
  - Hovering a card shows a small × that quits the app, using the existing close flow and its confirm for unsaved work.
- **Browser tabs:** Chrome and Safari cards have a "tabs" corner. Opening it swaps the arc for a list of that browser's tabs (title and domain), read with AppleScript, and picking one focuses that tab. macOS asks once per browser for Automation permission.
- **Switching:** apps are activated with `NSRunningApplication.activate` via JXA. Tabs use `set active tab index` plus `index of window` (Chrome) or `current tab` (Safari).
- **Single click on MIKO** now opens the switcher instead of the petting reaction. MIKO does a short "present" pose. Double-click still opens chat.

### IPC additions (preload `window.miko`)
- `onKeys(listener)`: talk-start, talk-stop, switcher, permission problem
- `listApps2()` / `listRunning()`: running apps with icon data URLs
- `focusApp(id)`
- `listTabs(browser)`
- `focusTab(browser, windowIndex, tabIndex)`

All ids are validated in the main process, the same way `parseActionId` is today.

## Testing
- **Unit tests:** the chord state machine (pure TS mirror of the Swift logic, or table-driven tests on the Swift side), the ordering/filtering of switcher items, and id validation.
- **Live tests:** hold Caps+A and speak, then check the draft and that Caps Lock is restored. Tab+Q opens and closes the switcher. Clicking a card focuses the app. Switching to a Chrome tab works.

## Left to the builder
- Exact arc geometry and animation timing, and icon size (about 64 px)
- JXA vs a small Swift query for the app list (pick whichever is faster in practice)
