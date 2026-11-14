# MIKO (PET_BOT): project log

This is the running record of the project. Read it first when you pick the project up on a new machine or in a new chat. New entries go at the top of **Session log**.

---

## Snapshot (as of 2026-11-14)

**What it is:** MIKO is a desktop pet companion built with Electron, React, TypeScript, and three.js. A 3D Doberman sits on top of your other windows. You talk to it in a chat panel, by typing or by push-to-talk voice. It can walk around, sit, follow the active window, open and close apps, and pass questions on to ChatGPT.

**Platforms:** Developed on macOS. The code targets Windows too, but the Windows smoke test in README.md has not been run yet. There is no installer.

**Run it:**

```bash
npm install
npm run build && npm start   # production bundle
npm run dev                  # dev with reload
npm run typecheck
npm test                     # node --test on src/shared/*.test.ts
npm run preview:phase2       # photo-frame puppy preview window
npm run preview:living       # "living dog" walk-frame preview window
```

Needs Node 22.12 or newer.

### Architecture

| Area | Path | Notes |
|---|---|---|
| Main process | `src/main/` | `index.ts` is the entry: single-instance lock, tray, summon shortcut, follow loop, pet window. `pet-window.ts` is the frameless, transparent, always-on-top window and its click-through hit rects. `ipc.ts` holds every IPC handler. `apps.ts` finds, launches, and quits apps. `speech.ts` runs on-device speech-to-text. `follow.ts` and `foreground.ts` follow the active window. `tray.ts`, `presence.ts` (show/hide/exit animation), `summon-shortcut.ts`, `quit.ts`. |
| Preload | `src/preload/index.ts` | Exposes `window.miko` (the `MikoApi` in `src/shared/api.ts`). The renderer runs sandboxed with contextIsolation on and nodeIntegration off. |
| Renderer (live) | `src/renderer/index.html` → `src/renderer/src/motion/` | `MotionApp.tsx` (about 900 lines) is the real app: 3D dog (`DobermanRig.ts`, loads `assets/doberman.glb`), behavior loop, chat panel, and command routing. |
| Renderer (older/preview) | `src/renderer/src/App.tsx`, `PetView.tsx`, `preview/`, `living/` | `App.tsx` and `PetView.tsx` are the Phase 1 SVG puppy and are no longer loaded by index.html. `preview/` and `living/` are the experimental 2D photo and walk-frame versions of "Miko". |
| Shared logic | `src/shared/` | Pure, tested TS: `commands.ts` (text/voice command router), `doberman.ts` (behavior state machine: Idle/Walk/Sit/SitIdle/StandUp), `guide.ts`, `look.ts`, `layout.ts`, `movement.ts`, `wander.ts`, `follow.ts`, `gait.ts`, `sequence.ts`, `photo-walk.ts`, `walk-review.ts`. |
| Speech helpers | `resources/listen-mac.swift`, `resources/listen-win.ps1` | The Mac helper is compiled with `swiftc` on first use into userData (SFSpeechRecognizer, on-device only). Windows uses System.Speech. Each session has a 12 s cap. Read-aloud uses the renderer's `speechSynthesis`. |
| 3D asset | `doberman_dog/` | `build_doberman.py` (Blender bpy) generates `doberman.glb` with 21 bones and 5 clips. A copy lives in `src/renderer/src/assets/`. |
| Art | `art/miko-puppy/` (Blender sculpt revs 1–4 plus previews), `art/miko-walk/` (walk-cycle video, stride.json) | Source for the 2D "Miko" frames in `src/renderer/src/assets/miko-*`. |

### What the chat panel understands (`src/shared/commands.ts`)

- **Movement:** "move/walk left|right", "a little left|right", "left|right corner", "come back/home", "sit", "stand", "stay", "wander"
- **Follow:** "follow me", "come here", "stay here"
- **Apps:** "open/launch/start X", "close/quit X", "force quit X" (asks first), "quit MIKO" (asks first). Apps it hasn't seen before need a confirm before the first launch.
- **Questions** (ending in `?`, or starting with how/what/why/explain/write/…) become a **ChatGPT handoff**

### Important: how ChatGPT works today

There is **no API backend**. `routeCommand` marks a message as a question. "Use ChatGPT" then **copies the prompt to the clipboard and opens https://chatgpt.com in the browser**. You paste it there yourself, copy the answer, and click "Paste reply" to bring it back into the panel. Nothing is sent automatically, and no API key exists anywhere in the code.

Voice commands for movement currently return "Voice control is not connected yet." (`VOICE_PENDING`).

### Known loose ends seen on first read

- `README.md` still describes Phase 1 (SVG puppy, notes only) and is out of date.
- The folder is **not a git repository**, so there is no history or backup.
- `.blend1` backups, the two `gemini_generated_video_*.mp4` files in assets, and `out/` take up a lot of space (about 486 MB in total).
- The Windows smoke test is still pending.

---

## History before this log (from the user's brief)

The app was built in Cursor. The current Doberman asset was made with Claude.

1. **Desktop foundation:** a transparent floating pet with a tray/menu-bar icon. It starts hidden and appears with ⌘⇧R (Mac) or Ctrl⇧R (Windows).
2. **Character development:** tried a realistic fluffy puppy, PNG animations, Blender sculpts (`art/miko-puppy`, revs 1–4), and Gemini walking videos. Settled on a blocky rigged Doberman with five clips: Idle, Walk, Sit, SitIdle, StandUp.
3. **Living behavior:** walks, turns toward you, sits, stands, wags, and tracks the cursor with its head. Its home is near the bottom-right.
4. **Movement controls:** dragging guides MIKO toward the pointer while it walks. Option/Alt-drag moves it freely. Typed commands include "move left/right", "come back", and "stay".
5. **Interaction panel:** double-click opens a text panel beside MIKO. It keeps your draft, takes commands, and Esc closes it.
6. **App launching:** opens supported installed apps, handles missing ones, and offers choices when a request is ambiguous.
7. **ChatGPT handoff:** copies the question and opens ChatGPT in the browser. You paste the reply back into MIKO.
8. **Verification:** the last confirmed build passed 48 tests, typecheck, and build, with live checks on the Mac.

**Latest phase (code is present, but no completion report was given):** app closing, microphone input, and following the active app.

## Open items / roadmap

- [x] Hands-on live check of the latest phase on the Mac: close app ✅, follow/come here ✅, mic ✅ (after fix, 2026-11-14)
- [x] Decided 2026-11-14: a voice transcript stays in the chat box for review. *Superseded the same day:* clear voice commands now run automatically, and the tray setting turns that off.
- [ ] Automatic ChatGPT replies inside MIKO (a real API backend instead of the copy/paste handoff)
- [x] Voice commands execute (2026-11-14): clear ones run, risky ones confirm, setting in the tray
- [ ] Hands-on Windows verification (smoke test in README.md)
- [ ] Rewrite README.md intro (controls table is current; intro still says Phase 1)
- [x] Local git history (2026-11-14), branch `main`, author PRANAV SAIRAM
- [x] Published 2026-11-14 to **private** GitHub repo https://github.com/PranavSairam/MIKO (remote `origin`, branch `main`)
- [ ] Consider Git LFS for `art/` binaries before publishing (about 50 MB of .blend/.png/.mp4)

---

## Session log

### 2026-11-14: Session 1, Mail panel (Gmail, read-only)
**Provider:** Gmail. Nothing was configured locally; the owner's addresses are Gmail.
- **Sign-in:** Google's installed-app OAuth flow (PKCE + loopback redirect on `127.0.0.1`), scope `gmail.readonly` only.
- **Token storage:**
  - refresh tokens are encrypted with Electron `safeStorage` (Keychain) in `userData/mail-accounts.enc`
  - nothing is stored if encryption isn't available
  - access tokens are kept in memory only
  - no token reaches the renderer
- **Credentials file:** the OAuth client is read from `userData/mail-oauth.json` (or `MIKO_GOOGLE_CLIENT_ID` / `MIKO_GOOGLE_CLIENT_SECRET`), never from the repo.

**Gmail setup (owner action, one time):**
1. https://console.cloud.google.com/: create a project, e.g. "MIKO".
2. APIs & Services → Library → **Gmail API** → Enable.
3. Google Auth Platform (OAuth consent screen) → Get started:
   - app name MIKO
   - support email = your Gmail
   - Audience **External**
   - contact email
   - Create
4. Audience → **Test users** → add every Gmail you'll connect (e.g. pranavsairamanc@gmail.com).
5. Data access → Add or remove scopes → add `https://www.googleapis.com/auth/gmail.readonly` → Update → Save.
6. Clients → **Create client** → type **Desktop app**, name "MIKO desktop" → Create, then copy the Client ID and Client secret.
7. Create `~/Library/Application Support/MIKO/mail-oauth.json`:
   `{"google": {"clientId": "<…>.apps.googleusercontent.com", "clientSecret": "<…>"}}`
   then run `chmod 600` on it.
8. Restart MIKO → Mail tab → **Connect account**. In the browser, pick the account → "Google hasn't verified this app" → Continue (it's your own app in Testing) → allow. The tab says "MIKO is connected".
- **Limitation:** while the Google app is in *Testing*, Google expires refresh tokens for this scope after about 7 days, so MIKO will show **Reconnect**. Publishing it needs Google's restricted-scope verification.

**What was built**
- **Window:**
  - layout takes a panel size (`PanelSize`)
  - `fitMailPanel()` asks for 700×520 and shrinks to the free side and height, minimum 360×300
  - `setPanelOpen(open, mode)` returns the size and the renderer sets the CSS variables
  - look-at math uses the live size
  - Chat stays 272×220
  - a compact stacked toolbar applies below an 860 px window width
- **Look:** "glass" surfaces with gradient highlights, a thin edge, a 14 px backdrop blur, and an opaque fallback under `prefers-reduced-transparency`.
  - Note: MIKO's window is transparent, so blur can't reach the desktop behind it. The surface is therefore 86% opaque to keep text readable.
- **Mail tab:**
  - search box (debounced 350 ms; stale responses dropped by sequence number)
  - account selector ("All accounts" merges newest-first across accounts)
  - clear search, Refresh, Accounts (Connect, Reconnect, Disconnect with Google token revoke)
  - Recent / Unread / Important filters
  - rows show unread dot, sender, subject, snippet, local date/time and account badge
  - loading, empty, error/retry, reconnect banner and preview banner states
  - Connect mail state, with "Ask ChatGPT instead" as a fallback
- **Mailbox rules:**
  - Recent = 10 newest in `in:inbox`, read and unread
  - Unread = `in:inbox is:unread`
  - Search = Gmail-side query over the whole mailbox with `-in:spam -in:trash`
  - Load more follows Gmail page tokens
  - message keys are `gmail:<account>:<messageId>`
- **Reader:**
  - shows sender, recipients, subject, date and "still unread"
  - HTML runs through an allowlist sanitizer (drops scripts, forms, embeds, event handlers, styles with `url()`, and remote image sources; links made inert with the address on hover)
  - shown in a `sandbox=""` iframe with its own CSP (no scripts, no network, `img-src data:`)
  - plain-text fallback
  - Back to results keeps the query and scroll position
  - viewing uses `messages.get`, which can't change labels; the scope is read-only anyway
- **Open original:** `https://mail.google.com/mail/u/<account>/#all/<messageId>` (hex id checked). The UI warns that Gmail may mark it read.
- **Important:**
  - Gmail's `IMPORTANT` label, plus heuristic rules: direct request to you, deadline, approval, payment, your own keywords
  - Promotions, Social and Forums are skipped by the rules
  - each row shows "Gmail: important" or "Rule", with the reason ("Heuristic: …")
  - rules are editable via Important → Rules, stored as `mailRules` in settings
- **Routing:**
  - mail phrases come before app launching (`parseMailCommand`)
  - "open the second email" uses the results on screen and asks if unclear
  - in the Mail tab, bare words or "find X" search mail
  - outside it, "find/search X" asks "Search mail or app command?"
  - "check mail in ChatGPT" keeps the old ChatGPT handoff
- **Dev preview:** `MIKO_MAIL_PREVIEW=1 npm run dev` / `npm start` (unpackaged only) uses `[Sample]` messages across two fake accounts. `MIKO_MAIL_PREVIEW_EXPIRE=<account>` simulates an expired sign-in.

**Verification: mocked (dev preview in the real app, Playwright)**
- "chk mail" switched to the Mail tab, panel 700×520 (window 932×520), dog beside it
- 10 rows, newest first, read and unread mixed, both account badges
- Load more gave 20 distinct rows, still newest first
- Unread showed only unread messages
- Important rows carry reasons ("Gmail marked it important"; "Heuristic: Mentions a deadline ("overdue") · About a payment ("Invoice")"; …)
- search "tax refund" found the oldest message (beyond the first pages)
- rapid typing i→invoice ended with exactly the "invoice" results (same as a single slow search)
- reader: no `<script>`, `onclick`, remote image or `href` left; CSP present; "1 remote image blocked"; "still unread"
- Back restored the first row and scrollTop 120
- spoken "Open the second email." opened row 2
- bare "interview" + Enter in the Mail tab searched
- switching back to Chat restored 504×250
- "find invoice" in Chat asked Search mail / App command
- expired account: Reconnect banner, and the other account still listed
- normal mode with nothing set up: Connect mail state and no sample rows
- small screens: unit-tested with `fitMailPanel` on 800×480 (fits inside the work area, dog visible)
- typecheck passes, tests pass, build passes

**Verification: live (real Gmail): PENDING.** Needs the setup above. To do:
- latest 10 and pagination
- unread filter
- keyword search beyond the first page
- read a message and confirm it stays unread in Gmail
- Open original opens that exact message
- rapid search
- expired sign-in (wait about 7 days or revoke at myaccount.google.com/permissions)
- small-screen layout on a real small display

**Windows:** the mail code is cross-platform except storage. `safeStorage` uses DPAPI on Windows. Untested there.

### 2026-11-14: Session 1, "check mail" handoff
**How to use:** say or type "check mail", "chk mail", "check my inbox", "check my email" or "important unread mail(s)". MIKO shows the expanded request (`MAIL_REQUEST` in `src/shared/commands.ts`, worded exactly as the owner specified) with **Continue in ChatGPT** and **Paste reply**. Continue copies the request and brings the ChatGPT app forward; the card then reads "Request copied—paste into ChatGPT and press Send." plus where ChatGPT opened. Email retrieval and the summary stay inside ChatGPT.

**Composer insertion was investigated and is not used:**
- ChatGPT.app (`com.openai.codex` 26.924) is Electron-based (a renamed "Codex Framework" with Chromium resources and `app.asar`).
- Its Accessibility tree stops at the windows (8 elements, no text areas).
- Both supported ways to ask for the full tree failed: `AXManualAccessibility` returned -25205 (unsupported) and `AXEnhancedUserInterface` returned -25208 (not implemented).
- So the composer can't be found or verified, and MIKO never types or pastes into ChatGPT itself.
- `codex://new?prompt=` (documented) would prefill a *Codex local chat*, not a ChatGPT chat with connected mail, so it isn't used.
- **Re-check after ChatGPT updates:** `scripts/probe-chatgpt-composer.swift`. If it ever finds a verifiable composer, insertion could be added, asking before replacing existing text.

**Windows:** the existing handoff fallback applies (copy, then chatgpt.com in the browser). Untested on Windows.

**Verified live:**
- typed "chk mail" showed the card with the request text byte-identical to the spec, the Continue in ChatGPT / Paste reply buttons, and no destination picker
- Continue put exactly the request on the clipboard, ChatGPT became frontmost, and the card said "Request copied—paste into ChatGPT and press Send. The ChatGPT app is in front."
- the spoken "Chk mail." transcript gave the same card (Heard note shown)
- the owner's clipboard was saved before the test and restored after
- typecheck passes, 84/84 tests pass, build passes

### 2026-11-14: Session 1, ChatGPT app handoff and saved chats
**How to use**
- **"open ChatGPT"** (typed or spoken): launches or focuses the ChatGPT desktop app (`/Applications/ChatGPT.app`, bundle `com.openai.codex`; `com.openai.chat` is also detected). Without the app it opens https://chatgpt.com in the default browser and says which.
- **Saved chats:** the panel's **Saved chats** button (or "show saved chats") opens Add / Open / Rename (✎) / Remove (×). Each entry is a name plus a chatgpt.com link:
  - a conversation `/c/<id>`
  - a Project `/g/g-p-<id>[/project]`
  - a custom GPT `/g/g-<id>`
  - a conversation inside a Project or GPT `/g/g-…/c/<id>`

  Stored as `savedChats` in `userData/miko-settings.json`.
- **Opening a saved chat:** "open my FreshNet chat" / "open my major project chat". If the name is ambiguous MIKO lists the matches to choose from; unknown names give "I don't have a saved chat called …".
- **"ask GPT <question>"** (typed or spoken) shows the exact question card:
  - an optional **Send to** saved-chat picker
  - **Copy and open ChatGPT**: copies the question, brings ChatGPT or the chosen chat forward, and shows "Question copied. Paste it into the ChatGPT conversation you want." plus where it opened
  - **Paste reply**, as before
  - a note that continuing uses that conversation's context and the account's memory settings, and that MIKO hasn't read it

  Ordinary questions ("how…?") use the same card.

**Decisions**
- **No app deep links for chats.** OpenAI's docs (learn.chatgpt.com/docs/app/commands) list only `codex://` links: new and local threads, settings, plugins. Nothing opens a chatgpt.com conversation, Project or custom GPT, and the app has no associated-domains entitlement. So saved links go through `shell.openExternal`. MIKO asks macOS (NSWorkspace) which app handles the link and reports it. On this Mac that is Google Chrome.
- **URL validation** (`src/shared/chatgpt.ts`, WHATWG URL parser): https only, host exactly `chatgpt.com`, no port, no username/password, supported paths only. Query and fragment are stripped.
- **Names** are trimmed, at most 60 characters, and unique ignoring case (duplicates are refused with a clear message). They render as plain React text. Main re-validates every edit and every stored entry.

**Bug found and fixed:** MIKO Keys (and MIKO Listen) kept running when MIKO was killed rather than quit. Two leftover helpers were still swallowing A and Q. Both helpers now get `--parent <pid>` and exit within about 1 s once MIKO is gone. Verified with a force-kill: 0 helpers left. The keys helper was recompiled, so macOS may ask once more for Accessibility / Input Monitoring.

**Verified** (real app, driven with Playwright):
- "open ChatGPT" opened the app and ChatGPT became frontmost
- invalid links were rejected with reasons: other host, http, credentials, unsupported path
- query strings are stripped
- a duplicate "freshnet" and a rename onto an existing name were both refused
- the name `<b>bold</b>` was stored and shown as literal text
- rename and remove work
- "show saved chats" opens the list
- "open my major chat" lists Major project / Major exam prep
- "open my biology chat" says it isn't saved
- ask GPT: the card prompt and the clipboard were byte-for-byte the question (`What is a B-tree, really? Explain "fan-out" & keys <in> 2 lines.`), ChatGPT became frontmost, and the detail text was shown
- saved chats persist across a restart
- typecheck passes, 80/80 tests pass, build passes

**Pending**
- Live destination check with a real chat link: none was supplied, so opening an actual saved conversation is untested.
- Browser fallback not exercised live: ChatGPT.app is installed here. The handler lookup did resolve Chrome for chatgpt.com links.
- **Windows:** ChatGPT app detection is macOS-only, so Windows always uses the browser fallback. Saved-chat handler naming is macOS-only. The panel and router are shared but untested on Windows.

### 2026-11-14: Session 1, local git history
- `git init -b main`. Local identity is `PRANAV SAIRAM <pranavsairamanc@gmail.com>`, the owner's choice.
- `.claude/settings.json` turns off Claude Code commit/PR attribution (`attribution.commit/pr = ""`, `sessionUrl: false`, `includeCoAuthoredBy: false`).
- AGENTS.md and CLAUDE.md say: commit as the owner only, no co-author or AI trailers, no remote publishing unless asked.
- `.gitignore` now also excludes: env/credential files, `.claude/settings.local.json`, `.superpowers/` (agent scratch ledger), editor folders, `*.blend1` Blender auto-backups, and the two unused `gemini_generated_video_*.mp4` files. All of these are still on disk.
- Included: app source, lockfile, resources, Doberman runtime asset (`src/renderer/src/assets/doberman.glb`) and its source (`doberman_dog/`), art sources and previews, docs, and project instructions.
- No credentials found in the staged files.
- **Features at this checkpoint:**
  - 3D Doberman pet: walk, sit, follow the cursor with its head, guide by dragging
  - chat panel with typed commands
  - open, close and force-quit apps
  - follow or come to the active app
  - ChatGPT copy/paste handoff
  - on-device speech: Mic button and hold Caps Lock + A, with clear voice commands running automatically (tray setting)
  - Tab + Q or click for the running-apps fan with Chrome/Safari tabs
- **Verification:** typecheck pass, tests 69/69, build pass. Live checks are as recorded in the entries below.

### 2026-11-14: Session 1, voice commands execute
**Decision change (user spec):** recognised speech now *runs* clear commands. The earlier "transcript stays in the box" rule only applies when the new setting is off.
- `src/shared/commands.ts`:
  - `routeCommand` no longer blocks voice movement (`voice-pending` removed); trailing commas are ignored
  - new `planVoice(decision, auto)` returns run / confirm / handoff / review
  - tests added (69 total)
- `MotionApp.tsx`:
  - typed and voice input share `runDecision`
  - `onVoice` shows `Heard: "…"` and then the result
  - close / force quit / quit MIKO / unfamiliar app use the confirm card (new purpose `close` → "Close X" button)
  - questions open the ChatGPT card
  - ambiguous input shows the choices and puts the transcript in the box; unclear input gives a note and the transcript in the box
- **One result per recording:** speech events carry a `session` number (main `speech.ts`), and the renderer ignores any session it already handled.
- **Hiding or exiting MIKO** cancels listening, so the helper exits and the mic is released. Closing the panel already cancelled it.
- **Setting:** tray checkbox "Execute voice commands automatically", stored as `voiceAutoExecute` in `userData/miko-settings.json`, default on. Off means the transcript goes into the box for review.
- **Caps Lock bug found and fixed:** `CGEventSource.keyState(57)` reports the Caps Lock *lock state*, not whether the key is held, so with Caps Lock on every "a" would have started a recording. MIKO Keys now reads the physical Caps Lock press through IOHIDManager. This needs **Input Monitoring** for MIKO Keys in addition to Accessibility. Caps Lock is restored to its pre-chord state when you let go.
- **Verified in the real app** (phrases injected as recognised transcripts, real panel, router and apps):
  - "Move left." walked 150 px left
  - "Sit." sat
  - "Open Calculator." opened it
  - "Open image." gave the Image Capture / Image Playground choices plus the transcript in the box
  - "Open Microsoft." gave "can't find" plus the transcript in the box
  - "Close Calculator." showed the confirm, then closed it
  - a question opened the ChatGPT card
  - the same session sent twice was handled once
  - with the setting off, the transcript went into the box and nothing ran
- **User-verified 2026-11-14:** Caps Lock + A with real voice works, and Caps Lock's normal behavior is unaffected. Input Monitoring and Accessibility are granted to MIKO Keys.
- Typecheck, 69/69 tests, and build pass.

### 2026-11-14: Session 1, hold-to-talk keys and app switcher
Design: `docs/superpowers/specs/2026-11-14-keys-and-switcher-design.md`. Plan: `docs/superpowers/plans/2026-11-14-keys-and-switcher.md`. Ledger: `.superpowers/sdd/2026-11-14-keys-and-switcher/progress.md`.
- **New:**
  - `resources/keys-mac.swift` ("MIKO Keys" helper, CGEventTap) and `src/main/keys.ts`
  - `src/main/helper-app.ts` (shared LaunchServices + FIFO launcher; helpers announce `{"pid":N}`)
  - `src/main/running.ts` (JXA: running apps, window order, icons, focus via `open -a`, polite quit, Chrome/Safari tabs)
  - `src/main/switcher-window.ts`, `src/preload/switcher.ts`, `src/renderer/switcher.html`, `src/renderer/src/switcher/*`
  - `src/shared/keys.ts`, `src/shared/switcher.ts` (+ tests)
- **Changed:**
  - `speech.ts` uses the shared launcher and has a hold mode (helper `--hold`: no 8 s finish, 55 s cap; main cap 60 s)
  - single click on MIKO opens the fan after the pet reaction
  - README controls updated
- **Controls:**
  - **Tab + Q** or **click MIKO**: fan of running apps over the dog. Most recent first, 2nd preselected for a quick flip back. Type to filter, ←/→ + Enter, 1–9, × quits, Tab or the "Tabs" chip lists Chrome/Safari tabs.
  - **Hold Caps Lock + A**: push-to-talk into the chat box.
- **Verified live:**
  - click → fan; filter "fin" + Enter switches to Finder
  - Chrome Tabs view lists tabs, and arrow + Enter jumps to the tab
  - Tab + Q toggles the fan (user: "works really well")
- **Not yet verified:** Caps Lock + A. In the test window no Caps Lock event was seen (no remapping found). Needs the user to try it and report.
- Tests 64/64, typecheck and build pass. Permissions granted along the way: Accessibility for MIKO Keys, Automation for Chrome (via Claude).

### 2026-11-14: Session 1, live test of the latest phase
I drove the production build with Playwright `_electron`. The driver lives in the Claude scratchpad, not in the repo. It summons MIKO with `app.emit('second-instance')`, double-clicks the pet, and types into the panel.
- **App closing: PASS.** "open calculator" opens it. "close calculator" gives "Calculator closed." and Calculator really quits. Saying it again gives "Calculator is already closed." "close zzfakeapp" gives "I can't find Zzfakeapp." "quit miko" shows a Quit MIKO / Not now confirm.
- **Follow / come here: BLOCKED.** It needs macOS Accessibility permission. MIKO shows the right message, pointing to System Settings → Privacy & Security → Accessibility. Even `osascript` from the terminal was refused (-1719), so permission has to be granted to the app that launches MIKO (the terminal or Claude app when run with `npm start`, plus Electron).
- **Microphone: NOT TESTED YET.** It needs the mic permission prompt and someone actually speaking.
- **Retest after granting Claude Accessibility and restarting Claude:**
  - **Come here: PASS.** With the panel open it says "I'll come over once this is closed". After Esc it walks to Calculator's bottom edge and stops at x=278, y≈842, exactly the `perchPoint` target.
  - **Follow me: PASS.** I moved Calculator to (1000, 250) and MIKO walked to its new bottom edge (≈890–904, 462). "stay here" turns following off again.
- **Microphone: FAIL, 2 bugs.**
  1. **The helper crashes on launch.** `miko-listen` aborts with `SIGABRT`, "Namespace TCC". macOS checks the Info.plist of the *responsible process*, meaning the app that launched MIKO (Claude here; Terminal or iTerm for `npm start`), and that plist has no `NSSpeechRecognitionUsageDescription`. The helper's own `miko-listen.app/Info.plist` is ignored because it is spawned as a plain child process, and `ensureSpeechKey()` patching Electron's plist doesn't help for the same reason. Likely fix: launch the helper through LaunchServices (`open -n -W --stdin/--stdout <fifo> miko-listen.app`) so it becomes its own responsible process, or package MIKO as a real .app.
  2. **The UI gets stuck on "Listening…".** When the helper dies, `speech.ts` clears `child` in the `close` handler but never posts a speech event. The 12 s kill timer then does nothing because `child !== proc`, so the panel shows "Listening… Stop / Cancel" forever (seen for over 40 s).
- **Microphone fix (code changed): now PASS.** Live test: the user said "Hi can you hear me" and it appeared in MIKO's chat box as the draft.
  - `src/main/speech.ts`:
    - On macOS the helper is now launched through LaunchServices (`/usr/bin/open -n -W -g --stdout <fifo> miko-listen.app`), so it is its own responsible process and its own Info.plist and permission prompts apply. Results come back through a FIFO in a temp dir.
    - Stop is `SIGUSR1` and cancel is `SIGTERM` (via `pkill -x -f <binary>`).
    - A shared `track()` posts `failed` when the helper exits without a result. The panel shows "Speech recognition stopped." and no longer hangs (checked by `kill -9` on the helper mid-listen).
    - Removed `ensureSpeechKey()`, which patched Electron's plist, and the Electron-side mic gate.
    - The helper plist gains `LSUIElement` (no Dock icon). It is rewritten and re-signed only when it changes.
  - `resources/listen-mac.swift`:
    - Explicitly asks for microphone access (`AVCaptureDevice.requestAccess`) before starting the audio engine. Before this, the engine ran but recorded silence, which was the real reason for "I didn't hear anything".
    - SIGUSR1 means stop and finish. A `stop` line on stdin still works for manual runs.
    - Status notes go to stderr (sent to /dev/null in the app).
  - Windows path (`listen-win.ps1`) is unchanged apart from the shared failure handling, and is not tested.
  - Known nit: on the very first run the macOS permission prompts can outlast the 12 s listen cap, so that first try ends as "cancelled". Press Mic again.
  - The helper recompiles on the next launch because the Swift source changed, so macOS may ask for mic and speech permission one more time.
- Typecheck, 51/51 tests, and build all pass after the change.
- Small UI note: the "Calculator closed." entries have no Read aloud button, but other notes do. Possibly intentional (`kind: 'closing'`).

### 2026-11-14: Session 1 (Claude Code)
- Read through the whole codebase and wrote this log (snapshot above).
- Added the user's brief as "History before this log" and the open-items list.
- Checked the latest-phase code as it is on disk: `npm test` gives **51/51 pass** (up from 48), and `npm run typecheck` and `npm run build` both pass. The new close, mic, and follow features have not been tried live yet.
- No code changed.
