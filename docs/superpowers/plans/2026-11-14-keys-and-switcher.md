# Hold-to-talk keys and app switcher: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Holding Caps Lock + A dictates into MIKO's chat box. Tab + Q, or a single click on MIKO, opens a fan of running apps (plus Chrome/Safari tabs) to switch into.

**Architecture:** A long-lived Swift "MIKO Keys" helper (CGEventTap) is launched through LaunchServices with the same FIFO launcher as the speech helper. It streams JSON key events to the main process. The switcher is a second transparent BrowserWindow (`switcher.html`) with its own small preload (`window.mikoSwitcher`). App and tab data come from JXA run by `osascript -l JavaScript`.

**Tech Stack:** Electron 45, React 19, TypeScript, Swift (CoreGraphics, IOKit, Speech), JXA, node:test.

**Spec:** `docs/superpowers/specs/2026-11-14-keys-and-switcher-design.md`

## Global Constraints
- macOS only for the new features. On win32 every new entry point returns early without errors.
- Keycodes: Caps Lock 57, A 0, Tab 48, Q 12.
- Mic button keeps the 8 s auto-finish. Hold mode has no auto-finish, a helper cap of 55 s, and a main-process cap of 60 s.
- Transcripts fill the draft and are never auto-sent.
- Never launch a browser just to read its tabs: only query a browser that is already running.
- Renderer stays sandboxed. Every id, pid and index is validated in main against the latest listing.
- Double-click → chat and ⌘⇧R summon stay unchanged.

## Review Focus
1. Caps Lock released before A (or A before Caps): talk must stop exactly once, and Caps Lock ends in its pre-chord state.
2. Holding A auto-repeats: there must be only one `talk-start`, and no "a" may leak.
3. The switcher opens while an app quits or launches mid-listing: focusing a pid that is gone must fail quietly and refresh the list.
4. A browser has zero windows, or Automation is denied: the tabs view shows a message and no exception reaches the user.
5. The key helper is denied Accessibility: the panel explains it once, and click/Mic still work.

---

### Task 1: Shared helper-app launcher

**Files:**
- Create: `src/main/helper-app.ts`
- Modify: `src/main/speech.ts` (use it)

**Interfaces:**
- Produces:
  - `compileHelper(opts: { source: string; name: string; bundleId: string; plist: string; frameworks: string[] }): { root: string; binary: string } | null`
  - `launchHelper(root: string, binary: string, args: string[], onLine: (line: string) => void, onEnd: () => void): { signal: (name: 'USR1' | 'TERM') => void } | null`

- [ ] Move the compile/sign/plist logic and the FIFO + `open -n -W -g` logic out of `speech.ts` unchanged in behavior. `args` are passed after `--args`.
- [ ] Verify with `npm run typecheck`, then a live Mic press still fills the draft.

### Task 2: Key helper and main-side key events

**Files:**
- Create: `resources/keys-mac.swift`
- Create: `src/main/keys.ts`
- Create: `src/shared/keys.ts`
- Test: `src/shared/keys.test.ts`
- Modify: `src/shared/api.ts`, `src/main/index.ts`

**Interfaces:**
- Produces:
  - `type KeyEvent = { kind: 'talk-start' } | { kind: 'talk-stop' } | { kind: 'switcher' } | { kind: 'permission' }`
  - `parseKeyEvent(line: string): KeyEvent | null` in `src/shared/keys.ts`
  - `startKeys(handlers: { talkStart(): void; talkStop(): void; switcher(): void; permission(): void }): () => void` in `src/main/keys.ts`

- [ ] Test `parseKeyEvent`:
  - `'{"event":"talk-start"}'` gives `{kind:'talk-start'}`
  - `'{"event":"switcher"}'` gives `{kind:'switcher'}`
  - `'{"error":"permission"}'` gives `{kind:'permission'}`
  - `'garbage'`, `'{"event":"rm -rf"}'` and `''` give `null`
- [ ] Run `npm test`. Expect FAIL (module missing).
- [ ] Implement `parseKeyEvent`, then run `npm test`. Expect PASS.
- [ ] Swift helper:
  - Active `CGEventTap` on keyDown/keyUp/flagsChanged.
  - Re-enable on `tapDisabledByTimeout`.
  - If the tap is nil, call `AXIsProcessTrustedWithOptions(prompt)`, emit `{"error":"permission"}` and exit.
  - Physical key state comes from `CGEventSource.keyState(.hidSystemState, key:)`.
  - A keyDown while Caps is physically down: swallow; emit `talk-start` once (ignore autorepeat); remember `capsWasOn = !currentCapsFlag`.
  - A keyUp while talking: swallow, stop.
  - A 50 ms timer while talking: stop if Caps or A is physically up.
  - Stop: emit `talk-stop`, then restore Caps with `IOHIDSetModifierLockState(kIOHIDCapsLockState, capsWasOn)`. Swallow the trailing A keyUp.
  - Q keyDown while Tab is physically down: swallow (and its keyUp); emit `switcher`.
  - Flush stdout per line.
- [ ] `keys.ts`: compile with `compileHelper` (frameworks CoreGraphics, IOKit, ApplicationServices; plist adds LSUIElement), launch, map lines to handlers, and relaunch at most once if it dies. `index.ts` starts it after `createPetWindow`, darwin only, and stops it on `before-quit`.

### Task 3: Hold-to-talk wiring

**Files:**
- Modify: `resources/listen-mac.swift`, `src/main/speech.ts`, `src/main/index.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/renderer/src/motion/MotionApp.tsx`

**Interfaces:**
- Consumes: `startKeys` (Task 2)
- Produces:
  - `startListening(hold?: boolean)`
  - IPC `IPC.keys = 'miko:keys'` (main → pet) with payload `KeyEvent`
  - `MikoApi.onKeys(listener: (event: KeyEvent) => void): () => void`

- [ ] Listen helper: `--hold` argument. It skips the 8 s finish, uses a 55 s cap, and keeps SIGUSR1 = stop.
- [ ] Main: `talkStart` runs `presence.show()`, then `startListening(true)` (60 s cap), then `postToPet(IPC.keys, {kind:'talk-start'})`. `talkStop` calls `stopListening()`. `permission` posts `{kind:'permission'}`.
- [ ] Renderer:
  - `talk-start` opens the panel and sets listening with the detail "Listening… let go of Caps Lock + A to stop."
  - `permission` pushes the note: "MIKO Keys needs Accessibility access for Caps Lock + A and Tab + Q. System Settings → Privacy & Security → Accessibility."
- [ ] Verify: typecheck, then a live hold puts the transcript in the draft and Caps Lock is unchanged.

### Task 4: Running apps, tabs, focus and quit (main + shared)

**Files:**
- Create: `src/main/running.ts`
- Create: `src/shared/switcher.ts`
- Test: `src/shared/switcher.test.ts`

**Interfaces:**
- Produces in `src/shared/switcher.ts`:
  - `interface RunningApp { pid: number; name: string; bundleId: string; path: string; hidden: boolean; active: boolean }`
  - `interface SwitcherApp extends RunningApp { icon: string }`
  - `orderByWindows(apps: RunningApp[], frontPids: number[]): RunningApp[]`: apps with on-screen windows come first, in front-to-back order; the rest follow alphabetically. The active app is excluded only when `frontPids[0]` is MIKO.
  - `filterApps<T extends { name: string }>(apps: T[], query: string): T[]`: case-insensitive. Prefix matches rank before substring matches.
  - `arcSlots(count: number, width: number, height: number): { x: number; y: number; angle: number }[]`: one arc for up to 12 items, then two arcs (inner holds `ceil(count/2)`), spanning 150°, centered horizontally, apex at the top.
  - `interface BrowserTab { window: number; tab: number; title: string; url: string }`
  - `parseRunning(json: string): RunningApp[]` and `parseTabs(json: string): BrowserTab[]`: tolerant; bad rows are dropped.
- Produces in `src/main/running.ts`:
  - `listRunning(): Promise<SwitcherApp[]>`
  - `focusPid(pid: number): Promise<boolean>`
  - `quitPid(pid: number): Promise<boolean>`
  - `listTabs(browser: 'chrome' | 'safari'): Promise<{ ok: boolean; tabs: BrowserTab[]; reason: string }>`
  - `focusTab(browser, window: number, tab: number): Promise<boolean>`

- [ ] Tests:
  - `orderByWindows([A(1),B(2),C(3)], [3,1])` gives pids `[3,1,2]`.
  - `filterApps([{name:'Google Chrome'},{name:'Chess'}], 'ch')` gives `['Chess','Google Chrome']`.
  - `arcSlots(5, 700, 380)` gives 5 slots, symmetric x around 350, middle slot highest (smallest y).
  - `arcSlots(20, …)` gives 20 slots.
  - `parseRunning('[{"pid":"x"}]')` gives `[]`.
  - `parseTabs` keeps `{window:1,tab:2,title:'T',url:'https://a'}` and drops rows missing `url`.
- [ ] Run `npm test`. Expect FAIL. Implement, run again, expect PASS. Add both test files to the `test` script in `package.json`.
- [ ] `running.ts`:
  - JXA via `osascript -l JavaScript`: NSWorkspace `runningApplications` with `activationPolicy == 0`, excluding our own pid and "MIKO Listen"/"MIKO Keys".
  - Front pids come from `CGWindowListCopyWindowInfo(onScreenOnly|excludeDesktop)` with layer 0.
  - Icons come from `app.getFileIcon(path, {size:'large'})` and are cached by path.
  - Pids are validated against the last listing.
  - Focus is `activateWithOptions(ActivateAllWindows)` after `unhide`. Quit is `terminate` (polite, so the app's own save prompt protects unsaved work).
  - Tabs run only if the bundle id `com.google.Chrome` / `com.apple.Safari` is in the last listing.

### Task 5: Switcher window and UI, plus the triggers

**Files:**
- Create:
  - `src/main/switcher-window.ts`
  - `src/preload/switcher.ts`
  - `src/renderer/switcher.html`
  - `src/renderer/src/switcher/main.tsx`
  - `src/renderer/src/switcher/Switcher.tsx`
  - `src/renderer/src/switcher/switcher.css`
- Modify:
  - `electron.vite.config.ts` (preload + renderer inputs)
  - `src/shared/api.ts`
  - `src/main/ipc.ts`
  - `src/main/index.ts`
  - `src/preload/index.ts` (`openSwitcher`)
  - `src/renderer/src/hooks/usePetGestures.ts`
  - `src/renderer/src/motion/MotionApp.tsx`

**Interfaces:**
- Consumes: Task 4 functions, Task 2 `switcher` handler.
- Produces:
  - `toggleSwitcher()` and `openSwitcher()` in `switcher-window.ts`
  - `window.mikoSwitcher = { list, focus(pid), quit(pid), tabs(browser), focusTab(browser, w, t), close(), onOpen(listener) }`
  - IPC names prefixed `miko:switcher-`, accepted only from the switcher window's webContents
  - `MikoApi.openSwitcher(): void`

- [ ] Window:
  - 760×420, frameless, transparent, always on top, skip taskbar, sandboxed.
  - Placed with its bottom-center over the pet window's top-center, clamped to the work area.
  - Shown focused. Hidden on blur, Esc, or after a choice.
  - Each open sends `onOpen`, which refreshes the list.
- [ ] UI:
  - Cards (64 px icon plus name) are placed by `arcSlots`. The selected card is raised and outlined.
  - ←/→ moves the selection, Enter focuses, and typing filters.
  - Hovering shows a × (quit) and, for Chrome/Safari, a "Tabs" chip that swaps the arc for a scrollable tab list (title and domain). Esc in the tab list goes back to the arc.
  - Messages for an empty list and for permission problems.
- [ ] Triggers:
  - The keys `switcher` event toggles the window.
  - In `usePetGestures`, a new option `onSingleClick` runs after `pet()`. MotionApp passes `() => window.miko.openSwitcher()`.
- [ ] Verify: typecheck, tests, and build. Live: a click opens the fan, a click on a card switches app, and a Chrome tab jump works.

### Task 6: Docs and log
- [ ] Update the README controls table (Caps+A, Tab+Q, click) and the PROJECT_LOG.md session entry with the live-test results.
