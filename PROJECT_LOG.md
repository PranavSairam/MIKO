# MIKO (PET_BOT): project log

This is the running record of the project. Read it first when you pick the project up on a new machine or in a new chat. New entries go at the top of **Session log**.

---

## Snapshot (as of 2026-11-14)

**What it is:** MIKO is a desktop companion built with Electron, React, TypeScript, and three.js. A 3D Doberman sits on top of your other windows. You talk to it in a chat panel, by typing or by push-to-talk. It can walk, sit, follow the active window, open and close apps, search WhatsApp contacts on macOS, draft and insert WhatsApp replies (macOS), read Gmail, and answer through the MIKO assistant (Codex, using your ChatGPT sign-in in a separate thread) or hand a prompt to the ChatGPT app.

**Platforms:** Developed on macOS. The code targets Windows too, but the Windows smoke test in README.md has not been run. WhatsApp contact search on Windows uses UI Automation (`resources/whatsapp-win.ps1`, 2026-11-22, not live-tested yet); reading/drafting stays macOS-only. **Private beta (zero-budget):** unsigned Mac DMG/ZIP; manual Download latest link; feedback Preview + Export report (tester shares file). Auto-install disabled while unsigned. Signed electron-updater + feedback-server preserved for later. Guides: `beta/TESTER.md`, `beta/DISTRIBUTION.md`. Git history is on `main`.

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
| Renderer (live) | `src/renderer/index.html` → `src/renderer/src/motion/` | `MotionApp.tsx` is the real app: 3D dog (`DobermanRig.ts`, loads `assets/doberman.glb`), behavior loop, chat panel, and command routing. |
| Renderer (older/preview) | `src/renderer/src/App.tsx`, `PetView.tsx`, `preview/`, `living/` | `App.tsx` and `PetView.tsx` are the Phase 1 SVG puppy and are no longer loaded by index.html. `preview/` and `living/` are the experimental 2D photo and walk-frame versions of "Miko". |
| Shared logic | `src/shared/` | Pure, tested TS: `commands.ts` (text/voice command router), `doberman.ts` (behavior state machine: Idle/Walk/Sit/SitIdle/StandUp), `guide.ts`, `look.ts`, `layout.ts`, `movement.ts`, `wander.ts`, `follow.ts`, `gait.ts`, `sequence.ts`, `photo-walk.ts`, `walk-review.ts`. |
| Speech helpers | `resources/listen-mac.swift`, `resources/listen-win.ps1` | The Mac helper is compiled with `swiftc` on first use into userData (SFSpeechRecognizer, on-device only). Windows uses System.Speech. Each session has a 12 s cap. Read-aloud uses the renderer's `speechSynthesis`. |
| 3D asset | `doberman_dog/` | `build_doberman.py` (Blender bpy) generates `doberman.glb` with 21 bones and 5 clips. A copy lives in `src/renderer/src/assets/`. |
| Art | `art/miko-puppy/` (Blender sculpt revs 1–4 plus previews), `art/miko-walk/` (walk-cycle video, stride.json) | Source for the 2D "Miko" frames in `src/renderer/src/assets/miko-*`. |

### What the chat panel understands (`src/shared/commands.ts`)

- **Movement:** "move/walk left|right", "a little left|right", "left|right corner", "come back/home", "sit", "stand", "stay", "wander"
- **Follow:** "follow me", "come here", "stay here"
- **Apps:** "open/launch/start X", "close/quit X", "force quit X" (asks first), "quit MIKO" (asks first). Apps it hasn't seen before need a confirm before the first launch. "open WhatsApp" launches WhatsApp.
- **Websites:** "open YouTube" / "ok open youtube" opens `https://www.youtube.com/` locally. "… in Chrome" uses Chrome. A follow-up "in Chrome" finishes the last pending site open. "close YouTube" / "close it" closes matching browser tabs by host (macOS), never quits the browser.
- **WhatsApp contacts (macOS):** "open Mum in WhatsApp", "open WhatsApp chat with Mum", "find Mukundan on WhatsApp", and "open Dad in WhatsApp and tell him …" / "open Me in WhatsApp and type …" (navigate first; held draft resumes after the chat is verified). One exact result opens after the chat header matches. Several or approximate results are a choice. A bare "open Muku chat" opens an exact saved ChatGPT chat, otherwise uses a WhatsApp context you already chose, otherwise asks which. Aliases live in `userData/miko-settings.json` under `whatsappAliases`.
- **WhatsApp summarize / replies (macOS):** Bare "summarize" with a verified chat summarizes latest **incoming** text inside MIKO (composer unchanged, fresh model request). "tell him…", "reply saying…", "type … in a formal way" draft and insert unsent. Refine: shorter / more formal. "leave it" / "never mind" / "cancel that" cancel pending workflow.
- **Architecture helpers:** typed `ActionPlan` / capability registry / working context / task phases; unfamiliar wording → schema-validated interpret (async bridge) → `runActionPlan` gated by capabilities; structured preferences + correction examples in Preferences (not training); eval under `src/shared/eval/` including `holdout-unfamiliar.json`.
- **Type destinations (macOS):** “Open ChatGPT, new chat, type …” / “Type here” / omnibox insert / Notes write / “Paste now” via `type-plan` + `type-dest` + `TypeDestination` in working context. Type leaves unsent; submit only when explicitly asked and a verified path exists. See Session log 2026-11-21.
- **GPT Mode (opt-in):** Panel + paw toggle. When active, ordinary typed/final voice messages insert+submit in the ChatGPT app (not the MIKO assistant). Starts paused after relaunch. Optional Live ChatGPT view (whole-window mirror). See Session log 2026-11-21.
- **Interactive GPT / ChatGPT Web (opt-in, separate):** Panel **Interactive GPT** (beside GPT Mode) opens real `chatgpt.com` in an isolated `WebContentsView` (`persist:miko-chatgpt-web`). Pin, pill collapse, restore size/page; local open/show/hide; native DnD into composer; **Paste clipboard into GPT** + “copy this WhatsApp message to GPT” (explicit selection only). Not GPT Mode, not Lens. See Session log 2026-11-21.
- **Chrome profiles (macOS live-checked):** “open Chrome” / “choose chrome profile” / “open … in Chrome” → glass fan of real Local State profiles (avatar/initials, directory id separate from name). Optional saved default; never auto-saved. Launch by `--profile-directory` without closing other profile windows.
- **WhatsApp attachments (macOS):** “fetch/download the latest file/PDF”, “copy this file”, “save to Downloads”, “show in Finder”, “attach it here” → attachment actions (not the general assistant). Visible document bubbles only; Save to Downloads + verified local file; file card; real file pasteboard; attach unsent with header recheck.
- **Project video (2026-11-22):** "project video" / tray → Project video… mirrors a chosen window above MIKO (live mirror, no audio, crop, pin, collapse; protected video explained, not bypassed).
- **TL;DR (2026-11-22):** "TLDR: …" / "… TLDR" / "Summarize this briefly: …" → summary card via the assistant; follow-ups shorter / one sentence / action items only.
- **Play (Casual mode, 2026-11-22):** "let's play" / "play with me" open the Play menu; "play fetch" / "throw the ball" go straight to Fetch. Work mode (default) answers with how to turn Casual on. Any other command stops play first.
- **Questions** (ending in `?`, or starting with how/what/why/explain/write/…) go to the MIKO assistant when that setting is on, and to the ChatGPT app handoff when it is off.

### Known loose ends

- The Windows smoke test is still pending (0.1.2 handoff installer built; Victus checklist in Session log 2026-11-22). WhatsApp contact search exists on Windows (UI Automation, untested live); message reading, reply drafting/insertion and attachments are unimplemented there on purpose.
- Helper permission grants are tied to the exact ad-hoc build. A real Swift change means removing the helper in System Settings and adding it again.

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
- [x] Rewrite README.md intro (2026-11-14)
- [x] Local git history (2026-11-14), branch `main`, author PRANAV SAIRAM
- [x] Published 2026-11-14 to **private** GitHub repo https://github.com/PranavSairam/MIKO (remote `origin`, branch `main`)
- [ ] Consider Git LFS for `art/` binaries before publishing (about 50 MB of .blend/.png/.mp4)

---

## Session log

### 2026-11-23: Outstanding handoff verification after Claude usage-limit interrupt (Mac)
- **Context:** Took over uncommitted UI redesign + keyword Knowledge RAG. Did not restart the implementation. Treated prior “master smoke 37/37” as the **completed** layout/Knowledge smoke only; the **outstanding** suite (bird/toys, projector wording rerun, voice+IGPT, Screen Recording deny, idle/CPU, large PDFs, packaged assets) was what the usage limit interrupted — it was **not** finished in that earlier session.
- **Skills:** Installed and used **web-design-guidelines** (Vercel Web Interface Guidelines) + **redesign-existing-projects** for targeted a11y/layout review of the panel UI (code review; live Computer Use screenshots unavailable without Cursor Screen Recording). **design-taste-frontend** is installed but explicitly **not for app screens** — not used to redesign. No unavailable skills claimed.
- **A11y fixes applied:** `TaskStatus` `aria-live="polite"`; Knowledge results `aria-live="polite"`; Dialog backdrop/dialog `overscroll-behavior: contain`. Prior focus rings on play toys/chips and citation buttons kept.
- **Live Mac passes** (`MIKO_VERIFY_OUTSTANDING=1`, restores `pet=doberman` / `playMode=casual`): pet visible; Casual resting Ball+Stick; bird resting toys + move (Fly/lift path); projector open/close (1 source listed); Interactive GPT open+close; assistant-unavailable Knowledge copy path present. Packaged `release/mac-arm64/MIKO.app` launched with scratch `--user-data-dir` (sample guide + pdfjs/mammoth in asar). Scratch KnowledgeStore: large-handbook.pdf 80 pages → indexed in **191 ms**, **80 chunks**, RSS Δ **~33.7 MB**; cancel mid folder-add left **0** stuck queued/indexing; remove → `passage().ok=false`; reload keeps other docs. Automated: typecheck 0 errors; **512/512** tests; build PASS.
- **Code-only voice verification:** IGPT-open voice/local routing checked via code path (`parseInteractiveGptLocalAction`, dictate arm); live mic not re-driven this session.
- **CPU measurement with helpers disabled:** idle sample under `MIKO_NO_HELPERS=1` (settled): main Electron avg **~1.5 %CPU**, RSS **~201 MB** (8 samples).
- **Untested (honest, Mac):** Screen Recording denial live (permission currently allowed; deny UI present in Projector.tsx); owner Knowledge corpus empty this profile (`sources.json` `[]`) so in-app persistence not re-proven on owner data; CJK PDFs / CMaps not configured.
- **Windows, semantic retrieval, OCR, and protected streaming still pending.** Victus steps below.

#### Victus (Windows) exact test steps
1. Install the latest Windows handoff installer; first open → finish or skip Help & Setup; confirm pet appears and panel opens.
2. Preferences → Mode → Casual; point at pet → Play; drag Ball and Stick; Esc cancels.
3. Knowledge → Add folder with a text PDF + DOCX; wait until statuses settle; Cancel mid-import once and confirm UI stays responsive.
4. Ask “According to my documents…” → citation chips → preview → Open original; Remove one source → old citation shows stale; quit and relaunch → remaining sources still listed.
5. With Interactive GPT open: typed local command (e.g. open Calculator) and a normal chat question still route correctly; voice hold-to-talk once if mic works.
6. Projector: pick a normal window; confirm soft black-frame copy (“may be protected… Try again”) if black; do **not** expect Netflix/protected streaming to work until verified.
7. Display scaling 125–150%: header (Chat/Mail/Knowledge + Interactive GPT + More) stays one row; composer usable; More menu keyboard (arrows/Esc).
8. Report idle feel + any high CPU while Knowledge is idle vs indexing.

### 2026-11-23 (handoff): Commit b577251 and Windows 0.1.3 package for Dad (built on Mac; not tested on Windows)
- **Committed** b577251 (lag, Tab + Q, Talk to GPT, ChatGPT voice, voice phrasing) as PRANAV SAIRAM; not pushed. Left out: root `main` binary, `paused`, local `scripts/probe-*`, `scripts/live-chatgpt-web-acceptance.cjs`, and `test/outstanding-*.json` (verification output from another session).
- **Version 0.1.3**, START-HERE adds “See your open apps: hold Tab, press Q.”
- **Package:** `release/windows-handoff/MIKO-0.1.3/` → `MIKO-0.1.3-win-x64.exe` (153,408,219 bytes, SHA-256 6731307d6f5d96977afd9a4f88f5c2bf692dd927a1f421c4b39300d74a58d1d1), START-HERE.txt, TROUBLESHOOTING.txt, SHA256SUMS.txt. One-click, per-user, no admin, opens when done, keeps settings on upgrade/uninstall. Handoff checks: no personal/credential files; Windows helpers, pet models, pdfjs legacy build, mammoth, knowledge worker and sample doc present.
- **Not verified:** installing and running on Windows (SmartScreen, voice, Tab + Q, Knowledge PDF/DOCX, Interactive GPT voice). Not sent to Dad — the owner sends it.

### 2026-11-23 (late night): Talk to GPT; ChatGPT voice mode; “open GPT mode” (Mac; not committed)
- **Owner ask:** chat with Interactive GPT easily by voice. Chosen: both a Talk switch and ChatGPT’s own voice button; answers as text (no read-aloud).
- **Talk to GPT switch:** “talk to GPT / start talking to chat GPT / chat with ChatGPT / talk mode on” (with lead-ins like “can you …”) and a **Talk** button on the Interactive GPT toolbar. While on, each final MIKO voice transcript is inserted into chatgpt.com and sent with the existing verified submit (never on a signed-out page; if it fails the words stay in the box). MIKO’s own Interactive GPT / GPT Mode / cancel controls are still checked first; typing in MIKO stays local. Off: “stop talking to GPT / talk mode off / end chat with GPT”, the toolbar button, the panel banner’s Stop, or closing Interactive GPT. Turning Talk on cancels a one-shot Dictate. Tests for on/off phrases and non-triggers (“talk to mom”, “should I chat with GPT about this?”).
- **ChatGPT voice mode:** the Interactive GPT session now allows microphone (audio only) for chatgpt.com; camera/screen stay denied. `NSMicrophoneUsageDescription` added to the packaged Mac app.
- **“Open GPT mode”** was treated as an app; GPT Mode now accepts open/activate/switch on/go into and close/switch off/deactivate (tests).
- **Live (test profile):** Talk on/off by phrase, toolbar “● Talking”, mic granted / camera denied for chatgpt.com, “Open GPT mode” enabled GPT Mode. **Not live-tested:** an actual spoken sentence being sent and answered (needs the owner’s signed-in ChatGPT and real speech), ChatGPT’s voice button conversation. typecheck 0, 524/524 tests, build PASS. Windows UNTESTED.

### 2026-11-23 (night): Tab + Q permission recovery; “open interact ChatGPT” by voice (Mac; not committed)
- **Why Tab + Q “did nothing” after the helper rebuild:** macOS ties both grants to the ad-hoc helper binary. Accessibility was fixed by `tccutil reset Accessibility com.miko.keys` + re-grant; the keyboard tap then existed but with mask `0x1000` (modifier keys only) because Input Monitoring was stale; `tccutil reset ListenEvent com.miko.keys` (run by the owner) + re-grant → mask `0x1c00` (key down/up). Verified with `CGGetEventTapList` and new diagnostics: `keys: helper started / helper event: …` and `switcher: toggle from keys` (event names only, never keystrokes). Owner’s live Tab + Q at 17:41:41Z reached MIKO with the front app captured; Caps Lock + A voice worked 3×.
- **Lesson:** any change to `keys-mac.swift` resets both permissions for the owner; avoid helper edits unless needed, and say so first.
- **Voice:** “Nothing much can you open interact ChatGPT” went to the assistant. `parseInteractiveGptLocalAction` now strips a request lead-in (“hey MIKO”, “please”, “… can/could you”) and hears “interact / inter active” before GPT as “interactive”; questions and prompts that only mention it still don’t open it (tests added). typecheck 0, 519/519 tests, build PASS. Not yet re-tried by voice live.

### 2026-11-23 (later): Lag and Tab + Q fixes (Mac; not committed)
- **Lag, measured (test profile):** idle pet window 7–13 % CPU and GPU process 8–16 %; the 3D canvas redrew at 120 fps (ProMotion) even when idle, a debug attribute was written to the page every frame, and the WebGL canvas used non-premultiplied alpha (extra conversion per frame). Fixed: 60 fps while moving / 30 fps idle (`shared/frame-pacing.ts`, tested), change-only `data-look`, premultiplied alpha → idle about 4–5 % each.
- **Main-process freezes (biggest cause):** “Follow” (on in the owner’s profile) ran a blocking `osascript` every 700 ms for 175–230 ms, freezing window moves, click-through and Tab + Q. Now asynchronous. Main-process response with follow on: p90 263 ms → 0.7 ms, 14/117 → 0/195 calls over 100 ms. Follow still reads the front app.
- **Tab + Q:** Tab inside the fan now acts on release only if the fan is still open (Tab + Q to close no longer opens a browser’s tabs); closing the fan from the keyboard (Tab + Q or Esc) returns focus to the previous app when it was seen in the last 3 s. **Not live-tested** (needs physical keys). Owner approved the key-helper change: `keys-mac.swift` now holds a plain Tab back (and its repeats) until it’s clear whether Q follows; with Q nothing reaches the app, without Q the Tab is replayed (marked so the helper ignores its own events); modified Tab (Cmd/Ctrl/Alt/Shift) untouched; another key pressed while Tab is held releases the Tab first. The switcher event now carries the front app’s pid (`{"event":"switcher","front":pid}`, parsed in `shared/keys.ts`, tested) so closing the fan returns there exactly. Compiles (swiftc); **not live-tested** — it is rebuilt on MIKO’s next start and macOS will ask to re-allow “MIKO Keys” in Input Monitoring. Trade-off: holding Tab no longer auto-repeats (one Tab on release).
- **Checks:** typecheck 0 errors, 516/516 tests, build PASS. UI redesign not started (direction to be agreed with the owner). Windows: UNTESTED.

### 2026-11-23: Design system, panel layout fixes, Knowledge (document RAG) (Mac)
- **Skills used:** superpowers TDD (Knowledge core, extractor, store: red→green, mutation-checked); Vercel React best-practices (dynamic parser loading, deferred search results, no inline components). UI UX Pro Max / design-system / ui-styling / brand / Interface design are **not installed** in this session and were not used. `markdown.ts` tests were written after the code.
- **Audit findings fixed:** header wrapped to 2 rows (88 px) → one row (40 px) with Chat/Mail/Knowledge tabs, Interactive GPT icon, More menu; composer 3 rows (~150 px) → 1 auto-growing row; composer `maxLength=400` silently cut pasted text (TL;DR!) → 60 000; stale “Understanding…” note never removed; Read aloud under every routine note; ASSISTANT_NOTE repeated under every answer (now collapsed); default chat panel 272×220 → 420×480; pet jumped ~100 px when panel opened (now bottom-aligned); Preferences 2 657 px page (pet chooser + advanced sections now collapsible); setup step chips wrapped (now “Step n of 6” + dots); class-name clash with Mail (`m-*`) → new components use `ui-*`.
- **Design system:** `src/renderer/src/ui/tokens.css` (colour, type, spacing, radii, controls, motion, layers, compact + reduced-motion + high-contrast) and `ui.css`; components Button, IconButton, Input, Textarea, Tabs (arrow keys), Menu (focus/Esc), Dialog (focus trap), TaskStatus, EmptyState, ErrorState, SourceCard, FileCard, safe Markdown (no HTML).
- **Knowledge:** Add files / folder / drop on Knowledge; TXT, MD, text PDF (pdfjs-dist 6.5.438), DOCX (mammoth 1.13.0) read in a worker thread (60 s timeout, cancel); honest statuses (scanned/no OCR, password-protected, damaged, empty, too large, duplicate, missing); sensitive paths and outside-root symlinks skipped; index in userData/knowledge; refresh/retry/remove/clear; interrupted-job recovery; BM25 keyword search (labelled “Keyword search”; no semantic search, no model download). Answers: first-time consent, only matching excerpts sent to the MIKO assistant (never Interactive GPT), fenced as data, citations validated, per-sentence support check (numbers/terms), evidence banners (none / partial / conflicting), citation → passage preview → Open original, stale passages after removal/change. Follow-ups: which file, show source, shorter, one sentence, search only this document, compare. Chat drop asks before adding anything. Setup has an optional “Your documents” step with a sample document.
- **Other fixes found while testing:** concurrent `load()` race (“no documents” after restart); Cancel right after Add folder ignored; second main entry broke `__dirname` paths (switched to electron-vite `?nodeWorker`); assistant requests now wait their turn instead of failing “still answering” (Knowledge and TL;DR); projector black frame no longer always called DRM, adds Try again; **pre-existing** `dist:mac`/`dist:dir` failure (256 px `build/icon.png`) → `mac.icon: build/icon-mac.png` (1024 px upscale).
- **Automated:** typecheck 0 errors; 512/512 tests; build PASS; pack:win-check PASS.
- **Live (this Mac):** master smoke 37/37 (layout at small/medium/large, keyboard menu/tabs, chat Markdown, 5 106-char paste kept, TL;DR, incidental TLDR ignored, Knowledge answer + PDF page citation + preview, chat drop asks first, Knowledge tab single scroll, prefs, setup); Knowledge live: conflict shown with both sources, which-file, shorter, compare, scope, missing → no match, malicious doc did not open Calculator, removal → stale; packaged `release/mac-arm64/MIKO.app`: 12 fixtures indexed in 0.5 s inside the asar, sample doc indexed. App fan open/close/Esc + Chrome chooser cancel PASS.
- **Retrieval vs answer quality (fixtures):** retrieval: exact, paraphrase, multi-doc, conflict, scoped, PDF page, DOCX heading all top-ranked; answers: grounded with valid citations in every live case; semantic retrieval not implemented.
- **Not tested / pending (at end of that session — usage limit interrupted the outstanding suite):** bird + toys, projector wording rerun, voice, Netflix/protected video, Screen Recording denied, idle/indexing CPU/memory, large PDFs, CJK. **Clarification:** the **37/37** figure covers the master layout/Knowledge smoke only; it does **not** include those outstanding items. Follow-up session 2026-11-23 (Outstanding handoff verification) finished what could be finished on Mac; Windows + protected streaming remain UNTESTED.

### 2026-11-22: Fixes from owner + Mukundan testing — Chrome, readable controls, app fan, bird, toys; video projector; TL;DR (Mac)
- **Owner ask:** in order, (1) daily-use fixes: Chrome profiles, larger controls, the single-click app fan, bird movement, always-available Casual toys; (2) "Project video" above MIKO; (3) TL;DR in chat. Reuse existing code, keep Windows support, live-check on the Mac, Windows pending, local only.

#### Phase 1 — causes found and fixed
- **Chrome profiles:**
  - **Cause:** a choice wasn't consumed when the launch started, so a double-click / Enter + click on a profile card launched Chrome twice. The renderer now consumes the chooser token at launch start and hides the fan immediately. Main also merges identical launch requests (same profile + URL within 1.5 s).
  - **Cause:** launch errors were swallowed. The first line of `open` / spawn stderr now appears in the message, and "Nothing else was opened."
  - Chrome installed in `~/Applications` is found too (`open -na <bundle path>`).
  - The success message is honest: "Started Chrome with the "X" profile … I can't see which profile's window is in front."
  - **Found live:** with GPT Mode on or paused (the default after relaunch for anyone opted in), typed "cancel" only cancelled GPT Mode and left the Chrome chooser open. "Cancel" now also cancels a pending local task (chooser, held site/search, WhatsApp wait, unfinished task).
- **Readable controls:**
  - A default CSS layer gives primary buttons, bar buttons, Send, Mic and glass buttons a 40 px minimum height; tabs and chips 36 px; icon-only buttons (×, ⚙, ⤢, mail icons) a 40×40 hit area. Labels are 13–14 px, and every control has a visible focus ring.
  - Action rows wrap. Preferences → **Compact controls** (off by default) restores the small sizes.
  - **Found live:** the wrapped header row was drawn under the GPT Mode card. Cause: `.panel-bar` was a shrinkable flex item in the fixed-height column. It now has `flex-shrink: 0` (same for the banner).
  - Sizes are CSS px, so Windows display scaling and Retina scale them.
- **App fan (single click):**
  - **Cause 1:** while hidden, the fan kept its last layout, so a reopen showed it collapsing, then fanning again. It now resets on `visibilitychange` (hidden) and fans out once per opening.
  - **Cause 2:** every "opened" message, including a second click, restarted the animation. Main now ignores an open while visible, and the renderer guards with `isOpen`.
  - **Cause 3:** clicking MIKO while the fan was open blurred (hid) it, then the same click reopened it 250 ms later. New `toggleSwitcherFromPet()` closes when visible and ignores a pet click within ~750 ms of a blur-hide.
  - **Cause 4:** after a drag, `suppressClick` could stay set and eat the next real click. It now resets right after the drag's own click.
  - Quit stays graceful (window close / app quit, waits, "Waiting for X — finish any save dialog", never force).
- **Bird:**
  - **Inspected clips:** Chirp, Fly (0.42 s flap loop), Hop, Idle, Land, Peck, TakeOff, Walk.
  - Travelling now uses only `Fly` (no hop / walk fallback; `Idle` if missing), with `walkUnitsPerSecond` 0.7.
  - New `PetRig.setLift()`: the bird rises to a 26 px hover with a gentle 0.8 Hz, 2.5 px bob while it travels, and settles at rest. The click area follows, republished every ≥8 px rather than every frame.
  - Reduced motion: no lift or bob. Other pets never lift.
- **Casual toys:**
  - Ball and stick rest at fixed spots on the pet window's ground line, at its left and right edges. They move with MIKO, so they stay on screen at display edges, and never cover the pet.
  - Grab either to throw (no menu needed).
  - They hide while the panel is open, while any command runs (`taskBusy`, wrapped around `runDecision`), while the bird is airborne / perched, and during the drop reaction. They come back when idle.
  - They're DOM inside the pet window, so a summon, pet switch or monitor change can't duplicate them. Work mode / Dismiss: no play layer.
  - **Found live:** they were first anchored to the pet's box, so they floated up with the flying bird. Fixed.
  - Bird fetch flies, and carries the toy in its feet (new `carry: 'talons'`); other pets use the mouth anchor.

#### Phase 2 — Video projector (`src/main/projector.ts`, `src/renderer/src/projector/`, `src/shared/projector.ts`)
- Opens with "project video" (or the tray → Project video…). A picker lists the shareable windows, browsers first; MIKO's own windows are excluded by exact title.
- **Capture:**
  - `getDisplayMedia` in a dedicated partition, answered by `setDisplayMediaRequestHandler` with exactly the selected `desktopCapturer` window.
  - If that window is gone, the request is refused and no other source is used.
  - `audio: false`, so sound plays only from the original.
- **Badge and controls:**
  - The badge says **Live mirror**: it's a picture of the window, not a player.
  - Controls sit outside the video: Open original (reuses `lensOpenOriginal` on the Mac and `winFocusWindow` on Windows), Source, Crop / Uncrop (drag a box, Esc cancels), Freeze (only the mirror), Pin, Small / Medium / Large, Beam, Collapse to pill, Close.
  - No remote play / pause: there's no verified way to control another app's video, so the badge and Open original say playback stays in the original.
- **Window:** keeps the video's (or crop's) aspect, sized from the measured control height. It's placed above MIKO inside the work area, or beside it when there's no room, and never covers MIKO.
- **Health:**
  - Black for 3 s while frames still arrive → "probably protected (DRM) … MIKO doesn't get around that", with Open original.
  - No frames for 2.5 s → "paused, minimised, or on another desktop". It then checks whether the window still exists; macOS keeps a closed window's capture open without ending it.
  - Permission denied → a link to Screen Recording settings.
- **Cleanup:** Close, Dismiss and Quit stop every track and destroy the window. Switching sources stops the old capture first.

#### Phase 3 — TL;DR (`src/shared/tldr.ts`)
- **Forms:** "TLDR: …", "tl;dr - …", "TLDR⏎…", "… TLDR" (at least 8 words before it), "Summarize this briefly: …", "Give me a TLDR of this: …".
- **Not instructions:** a TLDR in the middle of text, a quoted / code / `>` example, or a message too short to be content.
- **Order:** checked first in `onSubmit`, before local controls, GPT Mode forwarding and the router, so pasted text is never routed, launched, drafted, forwarded or sent.
- **Prompt:** a fresh assistant request. The pasted text sits between fences that the text can't close. The prompt asks for 2–4 bullets (one sentence under ~40 words), keeps names / dates / amounts / decisions / action items, adds nothing, and treats embedded instructions as data.
- **Card:** the summary, Copy, Shorter / One sentence / Action items only (also as typed follow-ups within 15 min), Cancel, and the original text, collapsed.
- **Assistant off / missing / signed out:** a clear error and the original kept. No ChatGPT handoff, no truncation.

#### Automated (Mac)
- typecheck **PASS**
- `npm test` **463 PASS** (was 444). New `tldr.test.ts` and `phase1.test.ts` cover Chrome single launch and cancel, app-fan guards, bird clips and carry, toy anchoring, control sizing, projector placement / aspect / crop / health / phrases / capture guards. The `pets.test.ts` bird fallback was updated.
- build **PASS**

#### Live on this Mac (scratch profile, DevTools-driven; real Chrome profiles, real apps)

| Check | Result |
|---|---|
| Chrome: real profiles listed; "search Chrome for weather in Chennai" held until a choice; double-click on a profile → **one** "Opened search…" | **passed** |
| Chrome: "choose chrome profile" then "cancel" with GPT Mode paused → chooser closed, "Chrome wasn't opened" | **passed** (after the fix) |
| Readable controls: panel buttons 40 px; header wraps without overlapping the GPT card | **passed** (after the fix; screenshots) |
| App fan ×3: pet click opens fully, second click closes, no reopen; Escape closes | **passed** |
| App fan: drag + drop elsewhere → "Cancelled — nothing was closed"; next click still works; Esc mid-drag cancels; drag Calculator onto MIKO → target lights, "Release to quit Calculator", quit once | **passed** |
| Bird: ball and stick beside it; flies (lifted, side-on) carrying the ball in its feet; toys stay on the ground during flight | **passed** (after the anchor fix; screenshots) |
| Toys hidden while the panel is open, back after | **passed** |
| Projector, unprotected browser video (local MP4 page in Chrome): live mirror 3600×2260, frames advancing, 1 video track, **0 audio tracks**; crop resizes to the region; collapse to pill; expand keeps the picture (after the fix); close removes the window | **passed** |
| Projector, **YouTube** (Big Buck Bunny in Chrome): mirrored, not black | **passed** |
| Projector: source window closed → "The projected window closed…", tracks stopped | **passed** (after the fix) |
| TL;DR prefix with embedded "Open Calculator … send to Dad on WhatsApp … ignore previous instructions": 4 factual bullets, Calculator not opened, no WhatsApp / ChatGPT entries | **passed** |
| TL;DR "shorter", "action items only", short suffix note → one sentence; incidental "TLDR" made no card; original kept | **passed** |

- **Not tested live:**
  - **Protected streaming (Netflix etc.):** no account here; black-frame detection is unit-tested only.
  - Screen Recording denied path (permission already granted here).
  - Bird reduced motion.
  - Compact mode visuals.
  - Interactive GPT open with the projector.
- **Not claimed:** smoothness under load, or video compatibility beyond the two sources above.
- **Committed and pushed 2026-11-23** at the owner's request, together with the earlier mic / Casual / audit / installer stages. Before the commit: typecheck 0 errors, 463/463 tests, build PASS, and a secret / personal-data scan with no hits. Left out of the commit: the root `main` binary, the `paused` scratch file, the local `scripts/probe-*` scripts and `scripts/live-chatgpt-web-acceptance.cjs`. Protected streaming and all Windows checks: **UNVERIFIED**.

#### Windows checks still pending (Victus)
1. Chrome chooser / single launch / cancel.
2. 40 px controls at 125–150 % scaling.
3. Fan via pet click (Windows `focusable` / blur timing).
4. Bird flight and toys.
5. Projector: Windows needs no permission; check Open original via `winFocusWindow`, and Edge / Chrome capture.
6. TL;DR (needs Codex on PATH).

### 2026-11-22: Windows mic diagnostics, Casual mode (Fetch / Feed / Pet), automation audit, Windows handoff for Dad (made on the Mac)
- **Owner ask (4 stages):** (1) find and diagnose the intermittent Windows microphone without guessing, add diagnostics and a mic test in Preferences; (2) Work / Casual mode with a compact Play menu and three interactions on the existing pet controller; (3) audit existing automation per platform and pick three next workflows (no broad new automation); (4) an easy Windows installer + first open + Help & Setup + handoff folder for Dad. Local only, no commit/push.
- **Version bumped 0.1.1 → 0.1.2** (package.json + lock) so the new installer doesn't share a name with the older 0.1.1 build.

#### Stage 1: Windows microphone
- **Not reproduced (Mac).** Code reading found these real lifecycle problems, now fixed:
  - **Windows:** a second click while the helper was starting returned "Listening" before Windows had confirmed it was ready. It now joins the start in progress, so there is one helper and one answer.
  - **Windows:** a mic click during the microphone test showed "Listening" forever (the test owned the mic). It now gets a clear reason.
  - **Both:** the safety timeout ended a session silently. It now says "Listening stopped without a result. Retry…".
  - **Mac:** the Setup mic test ran the spoken words as a real command. The test now has its own result path.
  - **Both:** a renderer guard (75 s) stops a "Listening" that never got an answer.
- **Diagnostics** (`src/shared/mic-session.ts`, `miko-diagnostics.log`):
  - Per-session id, mode (tap / hold / test) and source.
  - Helper stage timings (`speech-loaded` / `recognizer` / `input` / `recognizing`), plus ready / heard / end times.
  - Outcome and error code (`ready-timeout`, `helper-exit`, `safety-timeout`, `no-audio`, …).
  - Stale-callback lines, the Windows default recording device (Core Audio, `[PreserveSig]` COM) and the installed recognizers.
  - Never audio or words (a transcript is logged only as its length).
- **Mic test card** (`MicTestCard.tsx`), in Preferences, Setup and Help:
  - Shows the microphone Windows uses ("Windows default"), Change microphone… (Sound settings) and Refresh.
  - Test → Starting → Listening → Hearing you… → the words, then Retry / Cancel.
  - Errors come with the settings page that fixes them. Leaving the card cancels the test and releases the mic.
- **Honest limit:** System.Speech records only from the Windows default input. MIKO shows and explains it; it does not claim to pick a device itself.
- Reproduction steps: `docs/WINDOWS_SETUP.md` → "Reproducing the intermittent microphone problem".

#### Stage 2: Casual mode
- **Mode:** Preferences → Mode (Work default / Casual), also tray → Mode. Play sounds are optional and off by default. Only the mode and sound are saved; unfinished games never are.
- **State machine** (`src/shared/play.ts`): idle → ready → activity (flying → chasing → carrying) → reaction → idle (fetch returns to ready with the toy).
  - Tokens on every transition, so stale timers and late events do nothing.
  - No overlap; cancel from anywhere.
- **Renderer** (`PlayLayer.tsx` + `MotionApp.tsx`): a compact Play pill (Fetch, Feed, Pet, Done) inside the pet window.
  - A "Play" chip appears for 2.5 s when the pointer is over the pet (Casual only).
  - Only visible controls are click targets (`data-hit`); a held toy holds the pointer only while dragged.
- **Fetch:**
  - Choose Ball or Stick, then drag and let go (velocity from the last 100 ms; a tap is a soft toss toward the side with more room).
  - Main (`src/main/play.ts`) flies the toy in its own tiny window: `focusable: false`, always click-through.
  - The arc and landing stay inside the pet display's work area (taskbar / Dock excluded). Throw length is limited by the pet's walk speed.
  - Display changes cancel the throw; reduced motion means no arc.
  - The pet walks with the existing controller's walk order. On arrival the toy window hides and the toy is drawn at the head anchor, then the pet walks back and drops it.
  - The toy window is destroyed 15 s after play ends.
- **Feed:** pick Bone or Biscuit and drag it onto the pet. The pet gets a subtle glow while the treat is over it.
  - The pet plays its `feedClips` if it has them; otherwise (Doberman) the existing short upward glance. Crumbs effect. No hunger, no nagging.
- **Pet:** a stroke, meaning the pointer moved back and forth over the pet four times with no button pressed (from main's cursor polling).
  - It can't collide with click, double-click or drag, and has a cooldown. The Pet button shows the hint.
  - The pet plays its `happyClips` (new per-pet field: cat Stretch, bird Chirp, koala Wave, Doberman none → a short hop) and hearts.
- **Priority:** any command (`runDecision`), opening the panel, Escape, Done, Dismiss, a pet switch, Work mode, or dragging the pet stops play immediately.
  - During a fetch, Follow and bird flights pause.
  - Router phrases: "let's play" / "play with me" → menu; "play fetch" / "throw the ball" → fetch. A bare "fetch" stays with WhatsApp attachments, and "play music" stays with Spotify.

#### Stage 3: Automation audit
- `docs/AUTOMATION_AUDIT.md`: every action's inputs, Mac / Windows status (live vs code), permissions, read / modify / send, how success is observed, and cancel / recovery.
- Three next workflows: site search templates, explicit selection → Interactive GPT, WhatsApp contact → reply prep (Windows draft shown in MIKO only).
- No new executor was added.

#### Stage 4: Windows install for Dad
- **NSIS:**
  - One-click and per-user (`perMachine: false`, `allowElevation: false`, no admin). Progress bar, Start menu shortcut, MIKO starts after install.
  - The desktop shortcut is no longer forced: "desktop shortcut" and "start when I sign in" are opt-in (`src/main/system-options.ts`, installed app only).
  - `build/installer.nsh`: a real uninstall (not an upgrade) removes MIKO's desktop link and Run entries, and says settings and ChatGPT sign-in were kept in `%APPDATA%\MIKO-Beta`.
  - Upgrades keep user data; single-instance is unchanged.
- **First open:** five steps with large controls:
  1. Meet MIKO (pet).
  2. Try MIKO (click, drag, live show/hide check).
  3. Enable voice (permission explained right before Test).
  4. Use ChatGPT (sign-in on ChatGPT's own page).
  5. Ready (three clickable examples + Windows options).

  Older saved step names map onto the new steps. Skip for now keeps the step, and Help → Continue setup resumes it. On a fresh install the panel opens at medium size.
- **Help & Setup** (tray "Help & Setup…", Preferences button):
  - Test microphone, show/change shortcut, tutorial / Continue setup, Open Interactive GPT.
  - What works on Windows, Send feedback (existing preview / export), Open logs folder (Explorer with the log selected).
  - Desktop shortcut / start at sign-in.
  - Update line: "Download the update" only when the existing manual flow reports one; otherwise "Updates come as a new installer file — there's no automatic update service set up." Nothing replays automation after a restart (tasks aren't persisted).
- **Handoff:** `npm run handoff:win` builds `release/windows-handoff/MIKO-<v>/` (git-ignored).
  - It checks `win-unpacked` for settings, logs, cookies, keys and browser partitions, and for the Windows helpers and pet models, then writes START-HERE.txt (three steps), TROUBLESHOOTING.txt and SHA256SUMS.txt.
  - **Built:** `release/windows-handoff/MIKO-0.1.2/MIKO-0.1.2-win-x64.exe`, 141,416,357 bytes (134.9 MB), SHA-256 `7ee8ee068ffdd38c9acd413e51abdce8fea7825e4cdc5debfe684931c184149f`.
  - **Not Dad-ready until the Windows checks below pass.**

#### Automated (Mac)
- typecheck **PASS**
- `npm test` **444 PASS** (was 405). New `mic-session.test.ts`, `play.test.ts`, `handoff.test.ts`; `win-speech.test.ts` and `setup.test.ts` were extended.
- build **PASS**
- `pack:win-check` **PASS**
- `dist:win` **PASS**: NSIS compiled, including `installer.nsh`.
- `handoff:win` **PASS**
- **Not compiled or run here:** the new C# (default-mic COM) and the PowerShell changes.

#### Live on the Mac
Scratch profile, MIKO driven through DevTools; real mouse events inside the pet window.

| Check | Result |
|---|---|
| "let's play" opens Play (panel stays closed); Fetch → Ball shows the toy and hint | **passed** |
| Drag-flick throw: toy leaves the window, pet walks ~220 px to it, carries it back to its start, drops it, toy ready again | **passed** |
| Escape removes menu and toy | **passed** |
| Feed: treat dragged onto pet, glow while over it, crumbs, treat gone, no panel or app action | **passed** |
| A command ("sit") mid-fetch stops play at once (menu, toy, carry gone; pet stops chasing) | **passed** |
| 3 throw + Done cycles, each fully cleaned | **passed** |
| Work mode: no play layer; "let's play" explains Casual mode | **passed** |
| Preferences: Mode + sound + mic card render; Help & Setup tiles; tutorial Meet → Try; Skip keeps "try" | **passed** |
| Toy window renderer released after Done (renderers 5 → 4 after 16 s) | **passed** |
| Resources, 11 processes total | Idle: pet renderer ~14 % CPU + GPU ~22 % (the always-on 3D pet), about 718–729 MB RSS. During play: total +~10 % CPU (main moves the toy window). Hidden toy window: 0 % CPU, about 84 MB until released. |

- **Not tested live on the Mac:**
  - The stroke gesture (DevTools can't move the real cursor; unit-tested instead).
  - The real mic test (skipped to avoid a macOS permission prompt for the scratch-profile helper).
  - Play with Interactive GPT open, display edges / monitor unplug, reduced motion, play sounds.

#### Windows checks still pending (Victus)
1. Install `MIKO-0.1.2-win-x64.exe` as a normal user. Expect SmartScreen → More info → Run anyway, no admin prompt, a progress bar, and MIKO starting by itself. Start menu entry present; no desktop shortcut.
2. Launch from the Start menu on a PC without Node / Git. The pet, the tray and Ctrl+Shift+R work.
3. First open: the five steps, Skip for now, Help → Continue setup resumes the step.
4. Help → Test microphone. Default device shown, the words appear (and aren't run), Cancel, Retry, Change microphone…
5. Mic reproduction (WINDOWS_SETUP.md), then send `miko-diagnostics.log`.
6. Help → Open logs folder; Interactive GPT opens inside MIKO.
7. Casual: Fetch at both screen edges and near the taskbar (throw, chase, return), Feed, Pet stroke, Esc, a command mid-fetch. Desktop clicks around the toys go through.
8. Desktop shortcut / start-at-sign-in toggles, then sign out and back in.
9. Upgrade: run the installer again. Preferences and the ChatGPT session are kept.
10. Uninstall: the message mentions `%APPDATA%\MIKO-Beta`, and the shortcut and Run entry are removed.
11. Earlier pending items (WhatsApp search, Chrome search, app launch).

### 2026-11-22: Windows WhatsApp contact search + Chrome web search (made on the Mac)
- **Owner ask:** WhatsApp contact search (typed/voice, chooser, no-match retry, Cancel, contextual "Open Dad", never touch the composer) and Chrome web search (encoded URL, profile choice, "search instead", no GPT side effects) on Windows; keep the Mac working; local only, no commit.
- **Important:** built on the MacBook. The spec asked to inspect the installed Windows WhatsApp first; that wasn't possible here. The helper therefore finds elements by accessibility role and label (not a fixed tree), and `npm run inspect:whatsapp-win` dumps what the installed version exposes (conversation text redacted) for the first live check. The spec's first step, verifying the earlier Windows app-launch fixes, also needs the PC: **UNTESTED**.
- **Chrome search (shared, all platforms):**
  - New `src/shared/web-search.ts`: `parseWebSearch` separates browser, profile and query ("Search Chrome for …", "Google …", "Search for … in Chrome", "look up … on Google", "… in Chrome with Work"). `webSearchUrl` builds the URL with `URLSearchParams`, so the query is always encoded; `searchQueryFromUrl` reads it back.
  - Router: searches become `open-url` with `search` set, so they reuse the existing Chrome profile flow (saved default, explicit profile overrides it, chooser when none, pending query kept until you pick). "Google Maps" / "Google Mail" stay sites. Any phrase naming WhatsApp is never a web search.
  - "Search instead for X" follows the most recent destination: the last web search (same browser), or WhatsApp. With neither, a short "where?" question. A bare "search for X" right after a web search searches again; otherwise it's unchanged (mail-or-app).
  - Renderer: "Opening Chrome…" status, then "Opened search in Chrome for "…" (profile "…")" only after the launch call succeeded. Results are not read or claimed. Cancel or a newer request bumps the chooser token: a launch finishing late shows "cancelled" and isn't recorded, and old "profile picker / open normally" offers turn inactive.
  - **Windows bug fixed:** `chrome.exe` was run with `execFile` + 15 s timeout. When Chrome wasn't already running, chrome.exe never exits, so MIKO would kill it and report failure. Now started detached (resolve on spawn). "Couldn't find Chrome on this Mac" now says "this PC" on Windows.
- **WhatsApp contact search on Windows:**
  - New `resources/whatsapp-win.ps1`: C# 5 UI Automation code compiled once to `%TEMP%` (broken cache recompiled). Same stdin/stdout JSON as the Mac `ax-helper whatsapp`, so `planWhatsApp`, the chooser, aliases, the no-match retry and the one stale-retry are shared.
  - Finds the WhatsApp window (WhatsApp process, or the Store frame host), brings it to front (AttachThreadInput, Alt-tap fallback), finds the edit labelled "search" (skipping anything labelled "Type a message"). Types the query once, checking before each character that the search box still has focus.
  - A non-empty search is cleared only while it has focus, else the run stops. Reads result rows (message-search hits skipped).
  - Opens a row only if exactly one matches name + preview (Invoke / Select / child Invoke / click verified with FromPoint). Success only after the header shows that name.
  - The opening step reuses the typed search (no retype). Never: SetValue, Enter, SendKeys, composer focus, WhatsApp Web, guessed coordinates. If search or results aren't exposed, the message says exactly that.
  - `src/main/whatsapp.ts`: win32 branch spawns the script (30 s limit for the first compile), parses BOM/CRLF output (`parseHelperOutput`), logs status/timing/diag (no message text) to the diagnostics log. Cancel still bumps the generation and kills the helper, so late results are dropped. The Mac spawn is unchanged.
  - Capabilities: `search_whatsapp_contacts` / `open_whatsapp_chat` are now `all`. Reading, summaries, insert and attachments stay `darwin`.
  - Panel says "Searching WhatsApp for "…"…". On Windows the opened line doesn't mention the message box (MIKO never moves focus there).
- **Docs:** `docs/WINDOWS_USER_GUIDE.md`, `docs/WINDOWS_SETUP.md` (how it works, inspect command, manual check).
- **Automated (Mac):**
  - typecheck **PASS**; `npm test` **405 PASS** (was 381); build **PASS**; `pack:win-check` **PASS**; Mac startup smoke (scratch profile) **PASS**.
  - New `web-search.test.ts`: routing typed = voice, encoding/injection, profile override, "instead", context destinations, Cancel, WhatsApp vs web, "Open Dad" vs "Open Calculator".
  - New `whatsapp-win.test.ts`: BOM/CRLF parsing, chooser never silently picks a substring, and static guards: ASCII-only script, C# 5 syntax, focus check per character, single SetFocus, no SetValue/Enter/SendKeys, single typed search, exact-one press, header before success, no WhatsApp Web, verified clicks only, honest limitation text, Mac spawn unchanged, cancel generation, Chrome late-launch token, detached chrome.exe.
  - `actions.test.ts` updated for the capability change.
  - **Not done:** the C# and PowerShell were not compiled or run (no compiler or PowerShell on this Mac).
- **Live on Windows: all UNTESTED.**
  - Earlier app-launch fixes (Calculator / WhatsApp open).
  - Typed and voice Chrome search; profile chooser, pick and Cancel; "search instead".
  - WhatsApp launch, one search, pick, verified header.
  - Ambiguous and no-match searches; Cancel mid-search.
  - Existing WhatsApp draft unchanged.
  - Interactive GPT open while these run; pet/panel responsive.
  - **Unsupported on purpose:** WhatsApp reading/summarize/reply insert/attachments on Windows. Header "already open" peek is Mac-only, so Windows always searches.
- **Unknown until live:** WhatsApp for Windows (WebView2 build) must expose its search box and result rows through UI Automation. Names/labels are English-only matches ("search", "Type a message"); another UI language reports the limitation instead of guessing.

### 2026-11-22: Windows Tab + Q switcher and Shift + A hold-to-talk (Mac unchanged)
- **Owner ask:** "a tab q tab switcher and a shift a for talk in windows and dont change for mac". Built on the Mac, so not run on Windows yet.
- **New `resources/keys-win.ps1`.** A long-lived PowerShell process that compiles a small C# 5 class (`Add-Type -IgnoreWarnings`, no admin). It installs a `WH_KEYBOARD_LL` hook.
  - **Tab + Q:** Tab passes through as on the Mac; only Q is swallowed. Emits `{"event":"switcher"}`.
  - **Shift + A (no Ctrl/Alt/Win):** the A is held back. Still held after 350 ms → `talk-start`; releasing A or Shift → `talk-stop`. Let go sooner → the A is replayed with SendInput (shift kept), so typing "A" still works.
  - Fast typing: another key during the wait replays the A first, then that key, in order. Injected keys are ignored by the hook.
  - On stdin it answers `list` (visible, unowned, non-tool, non-cloaked windows in z-order; Store apps resolved through ApplicationFrameHost to the real process), `focus` (restore + AttachThreadInput + SetForegroundWindow, Alt-tap fallback) and `close` (WM_CLOSE).
  - Exits on stdin close or parent exit.
- **`src/main/win-keys.ts`:** runs the helper (relaunch once), maps events to the same `KeyHandlers` as the Mac, and handles request/reply by id. `src/shared/win-keys.ts`: line parser and `groupWindows` (one card per app, front-most first, skips MIKO's exe and shell surfaces).
- **Mac kept unchanged:** `startKeys` gains a `win32` branch only; `keys-mac.swift` is untouched. `running.ts` switcher functions (list / focus / quit / graceful quit / pidAlive) gain `win32` branches only. `switcher-window.ts` opens on Windows too; the macOS-only window calls (`setHiddenInMissionControl`, `setWindowButtonVisibility`, `setVisibleOnAllWorkspaces`) are now inside a darwin check, which is the same behavior on the Mac. On Windows, if focus didn't move to the fan, the helper focuses it.
- **Hold-to-talk speech:** `listen-win.ps1 -Mode hold` uses RecognizeMode.Multiple with silence timeouts off. It joins phrases until `stop`, capped at 58 s. `startListening(true)` uses it on Windows. Copy says "let go of Shift + A"; the Mac copy still says Caps Lock + A. Releasing before recognition is ready cancels quietly. On Windows, start errors from the keys path carry the reason and settings link.
- **Copy and docs:** Setup voice step, Mail dictation hint (Windows: Shift + A), `docs/WINDOWS_SETUP.md`, `docs/WINDOWS_USER_GUIDE.md`.
- **Trade-offs to know:**
  - Holding Shift + A to auto-repeat "AAAA" now talks.
  - Keys typed into an admin window can't be replayed (UIPI).
  - Windows needs ~0.5–1.5 s to start recognition; speak after "Listening" appears.
  - Browser tab lists in the switcher remain Mac-only.
- **Checks (Mac):** typecheck pass; `npm test` **381** pass (new `win-keys.test.ts`, including C# 5 syntax and `-IgnoreWarnings` static guards); build pass; `pack:win-check` pass; Mac startup smoke clean. **The C# was not compiled** (no PowerShell or C# compiler on this Mac).
- **Live on Windows:** Tab + Q opens the fan / click switches / quit asks politely — UNTESTED. Shift + A hold talks and the transcript runs once; a quick Shift + A types "A"; fast "AB" typing order kept — UNTESTED. Mac Caps Lock + A and Tab + Q unchanged — UNTESTED live (code path untouched).

### 2026-11-22: Windows fixes (code-level, made on the Mac) — apps, voice, shortcuts, Interactive GPT, setup
- **Owner ask:** Fix MIKO on the Windows PC: voice dead, shortcuts dead, "Open Calculator/WhatsApp" → "I can't find …", Interactive GPT opens Chrome. Keep the Mac working. Local changes only, no commit.
- **Important:** this session ran on the MacBook, not the Windows PC (owner chose "fix code from Mac"). Causes below come from reading the code. **None were reproduced on Windows**, so every live Windows check is UNTESTED. Not done until those pass on the PC.

#### Causes found
- **"I can't find Calculator/WhatsApp" (all apps).** `src/main/apps.ts` sends 11 familiar apps plus up to 120 Start-menu shortcuts. Preload `parseListings` returned `[]` for any array over 120, or if any single item was invalid. A normal Windows Start menu passes 120, so the renderer got an empty catalog and every app read as missing. The Mac stays under the cap.
- **WhatsApp (and Store apps).** WhatsApp for Windows is a Microsoft Store package. Only `%LOCALAPPDATA%\WhatsApp\WhatsApp.exe` paths were checked, and Store apps have no stable exe.
- **Voice.** `resources/listen-win.ps1` set `$script:text` / `$script:done` inside `Register-ObjectEvent -Action` blocks. Those run in their own module scope, so the loop never saw a result: 8 s wait, then always "silence". `StreamReader.Peek()` on the stdin pipe can block. MIKO also showed "Listening" before the helper started, and errors were generic ("unavailable"). There was no recognizer choice, so a PC whose UI language has no recognizer failed outright.
- **Interactive GPT → Chrome.** On Windows `openChatGpt()` (no ChatGPT.app) silently called `shell.openExternal(chatgpt.com)`, i.e. Chrome. Dictated "interactive G P T" / "interactive chat GPT" didn't match the strict local phrase and fell through to that path. Inside the workspace, any link or redirect off the allowlist was also opened in the browser silently. The workspace chrome URL was built as `` `file://${path}` `` (invalid with `C:\` paths).
- **Shortcuts.** The registration code looks right, and the cause on the PC is unknown. Registration results weren't logged, so there was no evidence. Setup hard-coded "Ctrl+Shift+R" even when registration had failed, and the Mail dictation hint advertised Caps Lock + A on Windows.

#### Fixes
- **Diagnostics:** new `src/main/diagnostics.ts` writes `userData/miko-diagnostics.log` (rotates at 256 KB). It covers startup, shortcut registration (ok / taken), Start app read (count, ms, error), launches (via appsfolder/exe, running check), speech start/ready/errors (recognizer, codes, stderr), and GPT loads / failures / held links (host only). No transcripts or message text.
- **Apps:** new `src/shared/win-apps.ts`.
  - Discovery and launch: `Get-StartApps` JSON parse, launch with `explorer.exe shell:AppsFolder\<AppID>`. Familiar apps (Calculator, WhatsApp, Word/Excel/PowerPoint, Notepad, Chrome) are matched by name or package identity, with the old exe paths as fallback. Uninstall/help entries are filtered out.
  - Launch check: a tasklist check confirms the app started ("can't see it running yet" vs "found but didn't start").
  - Preload parsing moved to `src/shared/app-listing.ts`: cap 400, skips bad items.
  - Missing vs failed: the router says "X isn't installed on this computer" for known-but-absent apps. The renderer asks `appsStatus` and says "couldn't check which apps are installed" when the list couldn't be read.
  - The Windows app list is warmed at startup.
- **Voice:**
  - `listen-win.ps1` rewritten: modes listen/test/devices, recognizer choice (UI culture → en-US → en-* → first), `{"ready":true}` only after `RecognizeAsync`. It reads events with Get-Event and stdin with `ReadLineAsync`, tracks audio level (no sound → "no-audio"), and cleans up and disposes on cancel, stdin close or finish.
  - `src/shared/win-speech.ts` maps errors to actionable text plus a settings page (Microphone privacy / Sound input / Speech language).
  - `speech.ts`: Windows start waits for ready (8 s) and returns the reason and help on failure. Cancel sends `cancel`, then kills after 700 ms. One transcript per session.
  - Panel: a new `voice-problem` entry with **Retry** and the right settings button. Tray **Talk to MIKO (mic)** shares the same start path.
  - Setup mic step: pass/fail with the transcript, Retry, settings, and **Choose microphone** (lists Windows input devices and opens Sound settings; System.Speech uses the default input).
- **Shortcuts:**
  - Registration attempts logged; the status reports presses.
  - Setup "Show & hide shortcut" step: the real registered shortcut, a live press test (✓ when pressed), and alternatives (Ctrl+Shift+R, Ctrl+Alt+M, Ctrl+Shift+M, Alt+Shift+M).
  - The header shows only the active shortcut. The Windows example is "open Calculator". The Mail Caps Lock hint is Mac-only.
- **Interactive GPT:**
  - Non-darwin "open ChatGPT" opens the embedded workspace (`target: 'workspace'`). `chatgpt.ts openChatGpt` never opens a browser off macOS, so GPT Mode can't fall into Chrome either.
  - Spoken variants are normalized ("G P T", "g.p.t.", "chat GPT", bare "Interactive GPT").
  - Off-allowlist links and redirects are held, with a labelled **Open in browser** / Dismiss in the chrome. Guest `did-fail-load` / `render-process-gone` show an error with **Retry** and a labelled **Open in browser**.
  - The chrome URL uses `pathToFileURL`.
  - **Mac behavior change:** clicking an outside link inside the workspace now asks first, instead of opening the browser at once.
- **Setup again:** unchanged mechanism (tray Setup & Help…, Preferences Run tutorial again). It only resets the tutorial step, never settings or the GPT web session.
- **Docs:** `docs/WINDOWS_SETUP.md` covers the diagnostics log, how each Windows path works, and quick PowerShell checks.

#### Checks (Mac)
- `npm run typecheck` pass.
- `npm test` **373** pass. New: `win-apps.test.ts`, `win-speech.test.ts`, Interactive GPT dictation phrases.
- `npm run build` pass. `npm run pack:win-check` pass.
- Mac startup smoke in a scratch profile (`MIKO_NO_HELPERS=1`): no errors, diagnostics log written.
- `listen-win.ps1` was **not executed or syntax-checked** (no PowerShell on this Mac). Static tests guard only against the old bugs.

#### Live acceptance on the Windows PC
| Check | Result |
|---|---|
| Tray Show/Hide and registered shortcut, repeatedly | UNTESTED |
| Mic captures a harmless phrase, transcript shown | UNTESTED |
| Voice "Open Calculator" launches Calculator once | UNTESTED |
| Typed app launch | UNTESTED |
| WhatsApp opens if installed / accurately reports unavailable | UNTESTED |
| Interactive GPT opens inside MIKO, no Chrome | UNTESTED |
| Pet/panel clickable after opening and closing GPT | UNTESTED |
| Denied mic access and cancellation recover cleanly | UNTESTED |
| Mac regressions (voice, apps, GPT) in the real app | UNTESTED (startup smoke only) |

- **Next on the PC:** pull, `npm ci`, `npm run build && npm start`. Run the table above, and send `%APPDATA%\miko\miko-diagnostics.log` (dev) or `%APPDATA%\MIKO-Beta\miko-diagnostics.log` (installed) for anything that fails.

### 2026-11-22: Windows readiness, first-run setup, packaging handoff
- **Owner ask:** Harden Windows startup/capabilities; first-launch setup/tutorial; NSIS packaging + docs; verify dirty worktree; commit/push to `origin/main` (no force, no release). Preserve Mac features and pending WA work.

#### Platform hardening
- Bridge: Windows Codex via `MIKO_CODEX_PATH` / PATH `codex.exe` only (no `.cmd` shell); honest unavailable / not-signed-in; Interactive GPT independent.
- `type-dest.ts`: explicit non-darwin guards before `/usr/bin/open` or AX paths; unsupported status instead of false success.
- Selection shortcut IPC registers get/set on all platforms; capture remains macOS-only; Preferences hides selection controls on Windows.
- Lens capabilities already platform-gated; GPT Live empty surface on Windows shows an explicit unavailable message (not a blank mirror).
- Updater + UI copy: Windows uses `.exe` / SmartScreen / `%APPDATA%\MIKO-Beta`; Mac keeps DMG / Finder / Gatekeeper.
- Regression: `platform-copy.test.ts`, expanded `actions.test.ts` win32 capability denylist, existing `setup.test.ts` / `lens-capabilities.test.ts`.

#### First-run setup
- Versioned `setupTutorial` in settings (`src/shared/setup.ts`); schema-v1 legacy profiles marked skipped in `session-flush` (not inferred from file existence alone).
- IPC + preload: setup get/update, voice permission, `voiceMicTest`, summon shortcut get/set.
- Mic status via native helpers only (macOS SFSpeech status/request; Windows System.Speech test path) — not browser `getUserMedia`.
- Summon shortcut shows `Ctrl+Shift+R` on Windows; tray fallback when registration fails.
- `SetupTutorial` panel view; tray **Setup & Help…**; Preferences **Run tutorial again**. Optional failures never block pet/tray.
- Codex vs Interactive GPT: copy never claims web login satisfies Codex sign-in.

#### Packaging / docs
- `npm run dist:win` → expected `release/MIKO-0.1.1-win-x64.exe`; `build/icon.ico`; NSIS per-user; no bundled userData/credentials.
- `docs/WINDOWS_SETUP.md` (dev PowerShell) + `docs/WINDOWS_USER_GUIDE.md` (dad, installer-only).
- `npm run pack:win-check`; lockfile root version synced to `0.1.1`.

#### Verification notes
- Mac this session: `npm run typecheck` pass; `npm test` **354** pass; `npm run build` pass; `npm run pack:win-check` pass.
- `npm run dist:win` on macOS produced `release/MIKO-0.1.1-win-x64.exe` (packaging check only — **not** a Windows launch success).
- Excluded from commit: root `main` binary, `paused` scratch, `probe-*` local scripts, `.env` / `beta/.env.local`.
- **Still pending on owner Windows PC:** startup/render/tray/shortcut/mic/app launch/installer install-uninstall/Interactive GPT live checks; Caps Lock+A and app switcher remain macOS-only.

### 2026-11-22: WhatsApp conversation flow — instruction wrappers vs drafts
- **Owner ask:** Dad open; MIKO reported “Inserted—not sent” with draft literally “saying good morning”; Interactive GPT stayed pinned. Expected: “Go to Dad” → open only; “Tell him / reply saying good morning” → draft “Good morning, Dad!” unsent; wrappers never paste; nav-only no draft; tuck IGPT without clearing session; Replace/Append/Cancel; insert once after verify; typed=voice; regression + live Me/Me 2; typecheck/test/build; PROJECT_LOG; no commit/push.

#### Cause
- Compound open+tell / “reply saying …” left framing in `pendingDraft` (e.g. `saying good morning`).
- `type saying …` treated as literal paste.
- “Go to Dad” / “Open WhatsApp, go to Dad and say …” under-matched.
- “Make it warmer” refine phrasing incomplete.
- Switching to WhatsApp did not tuck Interactive GPT → focus fight.

#### Fix (routing + draft path, not phrase-only)
- `stripDraftInstructionFraming` / `isInstructionFramingBody` in `whatsapp-reply.ts`; applied on parse, compound `commands.ts` / `interpret.ts`, `setHeldWaDraft`, `startWhatsAppReply`, and `whatsAppDraftPrompt` (defense in depth).
- Compound regexes: `reply saying|with|that`, `Open WhatsApp, go to … and say …`; `matchOpenContactWhileMessaging` supports `go to` with **no** `pendingDraft`.
- Refine: `Make it warmer` / kinder / softer.
- `tuckInteractiveGptForWhatsApp` on WA open / reply / launch — collapse pill, keep session/draft.
- Held open+tell always non-literal (only `type exactly` / `Draft:` literal).

#### Regression
- Unit: wrapper vs literal, compound reply-saying, go-to nav-only, multi-turn “Tell him…”, warmer refine, prompt strips `saying` from instruction fence.
- `npm test` **347** pass; `npm run typecheck` pass; `npm run build` pass.

#### Live (MIKO_VERIFY_WA_CONVERSATION=1; Me / Me 2; nothing sent)
| Check | Result |
|---|---|
| Panel “Tell him good morning” | **passed** — instruction `good morning`, draft **`Good morning, Dad!`** (not `saying good morning`) |
| Existing composer text | **passed** — `choose-insert` (composer still held prior buggy `saying good morning…`); Replace/Append/Cancel path preserved text |
| Nav / switch guard | **passed** — wrong-header insert → `switched`; Me composer length unchanged through nav |
| Interactive GPT tuck | **passed** — open IGPT then WA → `collapsed=true`, session still `open` |
| Cancel | **passed** — `never mind` |
| Restore Me / Me 2 | **passed** — composers restored; no Send |
| openMe exact row | **failed once** — bare `Me` returned `choices` (Me / Me 2); verify now retries with `pickId` |
| Refine “Make it warmer” | **untested live** — skipped to avoid overwriting existing Me 2 draft; covered by unit parse |

#### Remaining limitations
- Self-chat “Me” search often needs an exact pick among Me / Me 2.
- Model may still address a gendered greeting (“Dad”) from `him` even on a self-chat test target; recipient header recheck before insert is unchanged.
- Refine live skip when composer already has text (by design preserve).
- Windows WA drafting still unsupported.

- **Not committed / not pushed.** Authorship PRANAV SAIRAM only.

### 2026-11-22: Fix “Send it” destination resolution
- **Owner ask:** With an Interactive GPT unsent draft (“everything works perfectly”), “Send it” fell through to the assistant and old WhatsApp/Santhosh context. Expected: resolve from fresh ContextSnapshot / task binding; if Interactive GPT is the last explicit drafting destination, submit that draft once. Clarify when GPT and WhatsApp both pending; never resurrect completed WA; preserve WA unsent policy; no blind retries; report observed vs unverified.

#### Cause
- No `send-it` command — with `assistantActive`, “Send it” became a sticky assistant `question`.
- Interactive GPT inserts were not recorded in `WorkingContext` / `ContextSnapshot`.
- No Interactive GPT submit API (insert-only).

#### Fix
- Shared `send-destination.ts`: `InteractiveGptDraftBinding`, `resolveSendDestination`, `isSendItPhrase`.
- Snapshot field `interactiveGptDraft` (explicit dictate / type-in-gpt / paste / transfer only — not visibility).
- Router: `{ type: 'send-it' }` before assistant fallthrough; “Open WhatsApp” unchanged.
- Clarification kind `send_destination` → “Send in ChatGPT or WhatsApp?”
- WhatsApp-only → unsent notice (no auto-Send).
- Main: `chatgptWebSubmitCurrentDraft` (verify composer, press Send once, observe; cancel generation blocks late submit).
- MotionApp binds after explicit inserts; `handleSendIt` / choice card / cancel clears binding + cancel submit.

#### Matrix
| Case | Result |
|---|---|
| Explicit GPT dictation → Send it | **passed** (resolver + live insert/submit) |
| Old WA history cannot steal | **passed** (unit) |
| Competing GPT + WA | **passed** (clarify) |
| Empty composer | **passed** (submit status `empty` path) |
| Cancel / stale generation | **passed** (live `cancelBlocksLateSubmit`) |
| Live harmless insert + Send once | **passed** (delivery-unverified honest; no retry) |

#### Checks
- `npm run typecheck` — pass
- `npm test` — **356** pass
- `npm run build` — pass
- `MIKO_VERIFY_SEND_IT=1` — all checks passed
- No commit/push

### 2026-11-22: Fix pet/panel interaction after voice-routing
- **Owner ask:** After voice-routing fix, MIKO buttons and pet click/drag stopped responding while voice still worked. Find real cause; keep voice routing + Interactive GPT; live click/drag with GPT open/closed; report live vs automated separately; typecheck/tests/build; PROJECT_LOG; no commit/push.

#### Cause
- Click-through / ignore-mouse got stuck after Interactive GPT raise/blur and gesture flags (`dragActive` / `pointerHeld`), with macOS `setIgnoreMouseEvents` toggles without `{ forward: true }` contributing to Chromium WidgetInputHandler stalls.
- GPT blur → immediate `raisePetWindow` could fight focus; stuck `chromeDragActive` could skip pet raise forever.
- Summon/dismiss/voice end did not always clear pointer locks.

#### Fix
- `restorePetPointerState()`: clear drag/pointerHeld, brief ignore cycle, re-run hit-testing (or accept clicks when panel open).
- macOS ignore toggles use `{ forward: true }` (create + `applyIgnore`).
- Panel open clears stuck gestures, raises pet, forces ignore off.
- GPT: debounced blur raise (120ms) + restore; 4s `chromeDragActive` safety; restore on collapse/close/hide/invalidate; summon/dismiss/speech cancel+transcript restore.
- Renderer: release pointer locks on hide/`pointercancel`.
- Verify: `MIKO_VERIFY_PET_INTERACTION=1` (OS CGEvent click/drag via Accessibility).

#### Live vs automated
| Check | Result |
|---|---|
| OS CGEvent: pet clicks reach pet; panel opens; Mic with/without GPT | **passed (live)** |
| OS CGEvent: Mic while Interactive GPT open | **passed (live)** |
| OS CGEvent: after GPT close, panel usable again | **passed (live)** |
| OS CGEvent: Alt/guide drag origin move | **failed in harness** (post-panel-close coords/`altKey` delivery flaky; not a second overlay) |
| Hand cursor / Screen Recording Computer Use | **untested** (Screen Recording off for Cursor Computer Use) |
| typecheck / 345 tests / build | **passed** |
| Voice “Open WhatsApp” routing (prior session) | preserved (no revert of router fix) |

#### Checks
- `npm run typecheck` — pass
- `npm test` — **345** pass
- `npm run build` — pass
- No commit/push

### 2026-11-22: Fix voice routing when Interactive GPT is open
- **Owner ask:** Spoken “Open WhatsApp” was inserted into ChatGPT’s composer while Interactive GPT was open. Expected: local open/focus WhatsApp; leave GPT draft unchanged. Command resolution before any workspace insert; shared router for typed+voice; explicit Dictate to GPT; do not delete existing draft text; checks + PROJECT_LOG; no commit/push.

#### Cause
- `onVoice` had an early branch: if Interactive GPT was open/visible/uncollapsed, **every** final mic transcript was inserted into the guest composer and returned — bypassing `routeCommand` / local launch / pet motion.

#### Fix
- Removed that auto-insert branch. Merely opening Interactive GPT no longer changes MIKO command behavior.
- Typed + voice share `handleSharedLocalControls` (GPT Mode locals, Interactive GPT locals/transfers) with explicit `inputSourceRef` (`typed` | `voice`) for router metadata.
- Explicit targets only: `type/dictate into GPT: …` → `type-in-gpt` (literal composer insert via Interactive GPT when open, else ChatGPT app); **Paste clipboard into GPT**; armed **Dictate to GPT** (workspace button + phrase) inserts **one** final transcript unsent, then disarms.
- Uncertain voice still reviews into the draft box — never auto-pastes into GPT.
- Direct ChatGPT page typing/drops untouched. GPT Mode forwarding unchanged; pause/exit stay local.
- Existing GPT draft text is not cleared by this fix (no auto-delete of the mistaken “Open WhatsApp” line).

#### Regression matrix (router + wiring)
| Utterance / action | Expected | Status |
|---|---|---|
| Open WhatsApp (IGPT open) | local launch | **passed** (router; voice no longer auto-inserts) |
| Go to Cursor | local app switch | **passed** |
| Move left | pet move | **passed** |
| Open ChatGPT in Chrome | open-url chrome | **passed** |
| Type into GPT: open WhatsApp | literal insert | **passed** |
| Dictate to GPT → one mic final | insert once, unsent | **passed** (arm/path coded + unit) |
| Drop “open WhatsApp” text | text only | **passed** (native guest; unchanged) |
| Live mic end-to-end | — | **untested** this session (no spoken probe); restart build for hand check |

#### Checks
- `npm run typecheck` — pass
- `npm test` — **345** pass
- `npm run build` — pass
- No commit/push

### 2026-11-21: WhatsApp → Interactive GPT transfer
- **Owner ask:** Drag WhatsApp selectable message text into Interactive GPT (unsent, preserve draft). First test real WhatsApp drag payloads; direct drag where transferable; Copy → Paste clipboard into GPT fallback; never silent latest-message scrape; attachments only via explicit drop/paste/attach; live matrix; checks + PROJECT_LOG; no commit/push.

#### WhatsApp payload findings (macOS WhatsApp 26.43.77)
| Source | What was observed |
|---|---|
| **Selected text drag** | Drag pasteboard carried `public.utf8-plain-text` + HTML + Chromium drag markers (non-empty text length sampled). Treat as transferable **plain text** for native guest drop. |
| **Whole bubble drag** | **Not assumed.** No reliable AX “bubble = draggable” proof without a controlled live bubble-only drag. Use selection or Copy. |
| **Image / document drag** | Sampled drag board had **no** image bytes / file-URL types (text/html only). Do not treat thumbnails/filenames as attachments; use proven WA attachment retrieval + explicit attach. |
| **Copy message** | Edit → Copy was **enabled** with a selection; general pasteboard provides utf8 text (multiline / non-ASCII seen in length/flags only). |

#### Implementation
- Native path unchanged: sandboxed ChatGPT `WebContentsView` receives OS text drops; no MIKO command execution; no auto-submit; no navigation.
- Composer insert now **preserves draft** (caret insert / append); refuses login/password fields and auth URLs.
- **Paste clipboard into GPT:** local phrase + Interactive GPT `···` menu; opens/restores workspace; one-shot clipboard read (no monitoring).
- **Copy this WhatsApp message to GPT:** uses explicit selection capture only; otherwise asks to select/copy — never peeks latest chat message.
- Files/images: reuse existing WhatsApp attachment + real-file clipboard paths; require explicit user action.

#### Live / verify matrix
| Check | Direct drag | Copy/paste fallback |
|---|---|---|
| 1 Selected message text | **untested** (OS drag; Screen Recording off) | — |
| 2 Whole bubble | **untested** (do not assume) | — |
| 3 Copy → Paste clipboard into GPT | — | **passed** (wiring + insert ok) |
| 4 Multiline / Tamil / emoji | **untested** live | pasteboard flags: non-ASCII + newlines present on general board |
| 5 Existing draft preserved | **passed** (code path) | **passed** (code path) |
| 6 No dup / auto-send / nav | **passed** (wiring) | **passed** |
| 7 Wrong chat / cancel / signed-out | **untested** live | login-page refuse coded |

`MIKO_VERIFY_WA_GPT_TRANSFER=1` → `wa-gpt-transfer-verify.json`. Pet/workspace layout + sandbox preserved.

#### Checks
- `npm run typecheck` — pass
- `npm test` — **343** pass (incl. `interactive-gpt-transfer`)
- `npm run build` — pass
- No commit/push

### 2026-11-21: Interactive GPT native drag-and-drop
- **Owner ask:** Smooth DnD into existing Interactive GPT (preserve pet/workspace, session, voice, GPT Mode). Prefer native ChatGPT composer/upload; no overlay steal; no auto-submit; no navigation on drop; restrained highlight; pill ~600ms expand; honest content-type feedback; sandbox intact; live matrix A–I; checks + PROJECT_LOG; no commit/push.

#### Approach
- **Native first:** Guest `WebContentsView` keeps `navigateOnDragDrop: false`, sandboxed (no preload / no Node). Drops go to ChatGPT’s own composer/upload — no message scraping, no rebuilt attachment pipeline, no remote image fetch.
- **Chrome must not swallow guest drops:** `.cw-fill` stays `pointer-events: none`; titlebar rejects drops with a “drop into composer” hint; pill never uploads on hover/drop alone.
- **Highlight:** Minimal guest helper adds a non-intercepting outline + “Drop into the ChatGPT composer” label; clears on drop / leave / Escape. Neutral chrome `dropNote` (“Dropped into ChatGPT—check…”) from type kinds only — no paths, tokens, or message text.
- **Collapsed:** Hold dragged item on restore pill ~600ms → `expandFromDrag` (focus false) to keep the OS drag session; Escape/leave clears chrome drag state; close/dismiss invalidates pending MIKO transfer state.
- **Nav safety:** Guest + chrome `will-navigate` block `file://` and off-allowlist URLs; no GPT Mode auto-submit path on drop.

#### Files
- `src/main/chatgpt-web-window.ts` — DnD prefs, guest helper, dropNote, chromeDragActive, expandFromDrag, invalidate on close/hide
- `src/renderer/src/chatgpt-web/ChatGptWebShell.tsx` + `chatgpt-web.css` — pill 600ms expand, chrome drop reject, dropNote UI
- `src/preload/chatgpt-web.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc.ts` — dragActive / expandFromDrag IPC
- `src/main/verify-chatgpt-web-dnd.ts` + `scripts/probe-chatgpt-web-dnd.cjs` — wiring probes (`MIKO_VERIFY_CHATGPT_WEB_DND=1`)

#### Live / probe matrix
| Check | Status | Notes |
|---|---|---|
| Wiring: navigateOnDragDrop=false, highlight helper, file nav blocked | **passed** | `scripts/probe-chatgpt-web-dnd.cjs` (Electron 45.2.3) |
| Pill expand-from-drag, pet stays, partition, close keeps pet | **passed** | `MIKO_VERIFY_CHATGPT_WEB_DND=1` → `chatgpt-web-dnd-verify.json` |
| A. Text from native editor → empty composer | **untested** | Needs live TextEdit/Notes OS drag (Screen Recording unavailable for Computer Use) |
| B. Multiline into existing draft | **untested** | Same |
| C. PDF from Finder | **untested** | Same |
| D. Image file from Finder | **untested** | Same |
| E. Image from browser (bytes vs URL) | **untested** | Same — report source honestly when tested |
| F. Multiple files | **untested** | Same |
| G. Cancel drag + collapse/restore | **passed** (wiring) | Escape/leave clear; pill expand; no upload on pill alone |
| H. No auto-submit / unwanted navigation | **passed** (wiring) | prefs + will-navigate; drop ≠ GPT Mode submit |
| I. Normal click/scroll/type/upload/download | **untested** | Manual smoke after OS drops |

**Source apps for A–F:** not exercised in this session (manual OS drag required). Synthetic composer DOM probe could not find a composer on a cold chatgpt.com load (login/challenge wall); native path left for hand verification.

#### Checks
- `npm run typecheck` — pass
- `npm test` — 339 pass
- `npm run build` — pass
- No commit/push

### 2026-11-21: Pet + Interactive GPT companion layout
- **Owner ask:** Fix pet disappearing when Interactive GPT opens. Keep session; pet visible beside workspace; tuck panel; pause Lens; slim chrome; summon/dismiss consistency; live verify. Checks + PROJECT_LOG; no commit/push.

#### Diagnosis
- **Cause:** Workspace used the same always-on-top `floating` band as the pet and was placed overlapping / covering the pet (especially after work-area clamp). Focusing ChatGPT buried the pet under the large window — looked like the pet “disappeared,” not a second-pet or hide bug.
- **Not the cause:** Pet visibility flag / animation reset on open (pet stayed “shown” but covered).

#### Fixes
- Place workspace **beside** the pet (left/right preferred; shrink before overlap; nudge saved bounds; never move the pet unexpectedly).
- After open/focus/blur: `raisePetWindow()` so the companion stays clickable without a focus fight; pin still means always-on-top visibility, not repeated activation.
- Opening Interactive GPT **tucks** the chat panel (`setPanelOpen(false)` + `uiHint`) and **closes Lens** (unless opened again explicitly).
- Dismiss hides pet + panel + workspace/pill and cancels mic; **does not** clear `persist:miko-chatgpt-web` login. Close workspace leaves pet visible. Collapse → one pill near pet.
- Slim chrome: **MIKO · ChatGPT**, Pin, Collapse, Expand, Close; Back/Forward/Reload in `···` menu; removed permanent disclaimer/download path from the reading chrome. Guest ChatGPT UI untouched (no page CSS injection).

#### Live verify (`MIKO_VERIFY_INTERACTIVE_GPT=1`)
| Check | Status |
|---|---|
| Pet still visible after open | **passed** |
| No workspace/pet overlap | **passed** |
| Panel tucked | **passed** |
| No duplicate windows | **passed** |
| Collapse / restore + session URL | **passed** |
| Close keeps pet | **passed** |

Remaining: edge cases on very small displays may still force a tight fit; manual drag is free. Screen Recording unavailable for Computer Use — verify used main-process + `__mikoPanel` bridge. Normal `npm run start` left running afterward.

#### Checks
- `npm run typecheck` — pass
- `npm test` — 339 pass
- `npm run build` — pass

### 2026-11-21: Interactive GPT access — header button, pill, pin, local commands
- **Owner ask:** Make existing ChatGPT Web easy to reach (no new integration). Visible **Interactive GPT** beside GPT Mode; open sandboxed workspace near pet; pin/collapse/restore; local open/show/hide commands; keep GPT Mode / Lens distinct. Restart + verify. Checks + PROJECT_LOG; no commit/push.

#### Access / UX
- Panel header: **Interactive GPT** immediately beside **GPT Mode** (always available on chat tab, regardless of GPT Mode phase). Responsive `panel-bar-actions` wrap so the control is not clipped.
- Workspace (same `persist:miko-chatgpt-web`): default ~900×650 near pet, work-area clamped; Pin toggle (always-on-top without focus thrash); Collapse → small **Interactive GPT** pill near pet; Expand restores size/position/page; Close ends window only (session/login kept in partition). Single window — reopen focuses, no duplicates.
- Shell labels **Interactive GPT** / ChatGPT Web; does not enable GPT Mode forwarding or Lens.

#### Local commands (before forwarding; skipped for `type exactly` / quoted prompts)
- `Open interactive GPT` / `Show ChatGPT Web` → open/expand
- `Hide interactive GPT` → collapse to pill
- Work while GPT Mode is paused or active (handled before forward/insert).

#### Live verify (restarted `npm run start` / electron-vite preview)
Report: `~/Library/Application Support/MIKO/interactive-gpt-access-verify.json`
| Check | Status |
|---|---|
| Header **Interactive GPT** visible beside GPT Mode, not clipped | **passed** |
| Click opens workspace (`chatgpt.com`) | **passed** |
| No duplicate windows | **passed** |
| Collapse → pill / restore | **passed** |
| Does not enable forwarding | **passed** |

Screen Recording for Computer Use was unavailable; verification used the pet `__mikoPanel` bridge + main-process workspace APIs on the restarted build. App left running via `npm run start` without the verify env.

#### Checks
- `npm run typecheck` — pass
- `npm test` (incl. `interactive-gpt.test.ts`) — pass
- Build via electron-vite preview — pass

### 2026-11-21: ChatGPT Web workspace — compatibility proven + optional prototype
- **Owner ask:** Real chatgpt.com interactive inside MIKO (not Lens capture, Codex, API answers, or external-window control). Prove Electron 45 embed first; no auth bypass / UA spoof / cookie import / webSecurity off. Isolated prototype; keep GPT Mode + Lens. Live acceptance; PROJECT_LOG; checks; no commit/push.

#### Compatibility (proven before shipping more UI)
| Check | Result |
|---|---|
| Electron | **45.2.3** (Chromium 156) |
| Surface | `WebContentsView` + `persist:miko-chatgpt-web` |
| Load `https://chatgpt.com/` | **PASS** (`did-finish-load`, title ChatGPT) |
| Login surface | **PASS** — Log in / Sign up / Continue with Google / Microsoft / Apple |
| Google SSO click-through | **PASS to** `accounts.google.com` identifier (title “Sign in - Google Accounts”); **no** “This browser or app may not be secure” text in probe |
| Interactive account completion | **UNTESTED** (owner must sign in with own account) |
| Scripts | `scripts/probe-chatgpt-web.mjs`, `scripts/probe-chatgpt-web-google.cjs`, `scripts/live-chatgpt-web-acceptance.cjs` |

**Not claimed:** Full signed-in chat use until the owner completes login once in this partition. External browser is **not** treated as completion.

#### Prototype shipped (optional; does not replace GPT Mode / Lens)
- Main: `src/main/chatgpt-web-window.ts` — chrome `BrowserWindow` + guest `WebContentsView`, host allowlist, auth popups same partition, downloads → `Downloads/MIKO-ChatGPT-Web/`, collapse/expand/close, voice insert into composer (no Enter / dup-skip).
- Chrome only: `src/preload/chatgpt-web.ts` + `src/renderer/chatgpt-web.html` + `src/renderer/src/chatgpt-web/*`. Guest: **no preload**, sandbox, contextIsolation, no Node, webSecurity on.
- IPC: `miko:chatgpt-web-*` in `api.ts` / `ipc.ts` (chrome sender or trusted pet panel for open/status/insert).
- Panel: **ChatGPT Web** button (separate from GPT Mode / Lens). Voice: when workspace open + not collapsed, final transcript inserts into composer only.
- Vite entries for preload + renderer `chatgpt-web`.

#### Security
- Remote ChatGPT isolated from MIKO privileged APIs (no guest IPC).
- `will-attach-webview` denied; navigation/popups host-validated; permissions deny-by-default (clipboard write allowed for copy).
- No logging of passwords, cookies, tokens, or conversation content.

#### Live acceptance
| Capability | Status |
|---|---|
| Load chatgpt.com in MIKO guest | **passed** |
| Login UI / SSO entry points | **passed** |
| Google identifier page (no known Electron blocker text) | **passed** |
| Download folder created | **passed** (`~/Downloads/MIKO-ChatGPT-Web`) |
| Session partition configured | **passed** (`persist:miko-chatgpt-web`) |
| Nav history API (Back/Forward) | **passed** |
| Composer insert without submit | **passed** (harness; logged-out composer textarea) |
| Owner interactive login | **untested** |
| Session reopen after restart | **untested** (needs signed-in cookies in partition) |
| Open existing chat / new chat | **untested** (needs login) |
| Typing / scroll / copy-paste live | **untested** (needs interactive session) |
| File upload | **untested** (no test file selected) |
| Download completion UI | **untested** (no test download selected) |

#### Checks
- `npm run typecheck` — pass
- `npm test` — 337 pass
- `npm run build` — pass (includes `chatgpt-web` preload/renderer)

#### Decision
Compatibility is **good enough to keep the optional ChatGPT Web workspace**. Remaining blockers are owner sign-in and post-login interactive checks—not a hard embed refusal in this Electron build. If Google later shows the insecure-browser page for this account, use email/Apple/Microsoft paths available on the same login modal (still untested live).

### 2026-11-21: Lens interaction feasibility — Spotify media fix + honest capabilities
- **Owner ask:** Interact with the app *inside* Lens (not “Control disabled = done”). Diagnose “Spotify unknown” media bar; probe background AX/HID; choose an honest path; capability UI; live pass/fail. Preserve GPT Mode / files / layout. No commit/push.
- **Do not claim:** This is still **not** full in-mirror Spotify (or ChatGPT) app control.

#### 1. Media bar “unknown” — root cause + fix
- Status AppleScript used `set st to player state as string` → **syntax error** (`Expected expression but found "st"`). UI then showed `state: unknown`.
- **Fix:** Renamed vars (`playerState` / `trackName` / …) + `(player state as string)`. Failures now surface as **unavailable** + reason (not a fake Ready/unknown).
- Media-key fallback only accepted if Spotify’s reported state/track/volume **actually changes** (avoids claiming Music/session keys as Spotify).
- **Live:** With Calculator frontmost, AppleScript `playpause` → `paused|Love Story|Indila|98` → `playing|…`; front stayed Calculator.

#### 2. Feasibility probes (Spotify native UI)
| Probe | Result |
|---|---|
| Playlist click (HID, no activate, Spotify front) | Helper **ok**; **no proof** playlist changed (FAIL vs requested experience) |
| Track select | Helper **ok**; track stayed `Love Story` (**FAIL**) |
| Scroll | Helper **ok**; visual scroll **not verified** |
| Search focus + type | Helper **ok**; search field effect **not verified** |
| Same clicks with another app front + Spotify on-screen | Posts without `--activate`; Spotify Electron **does not reliably respond** to background HID |
| When Cursor covers display | Spotify often `on=false` → helper refuses (“isn’t on screen”) |
| Single `--activate` handoff | Works as intentional focus to original |

**Blocker:** Spotify desktop is Electron; background CGEvent clicks/types into its CGWindow do not give reliable UI control. Re-enabling per-event activate would recreate Lens↔Spotify focus ping-pong. Hide/minimize tricks rejected.

#### 3. Web / embed path (checked, not shipped)
- Official **Embed iframe**: limited player for a URL, not the user’s native Spotify window/session.
- **Web Playback SDK**: separate Connect device, Premium OAuth — not the desktop app.
- Loading `open.spotify.com` in Electron = **another session**, must not silently replace the native Lens source. **Not implemented.**

#### 4. Chosen honest path + UI
- **View** — live mirror (labeled: not an interactive embed).
- **Media** — Spotify AppleScript controls only (capability-gated).
- **Interactive** — **disabled** for Spotify (and not claimed for ChatGPT/Finder/generic) with reason beside the control.
- **Control original** — one `lensOpenOriginal` handoff; then pointer/type with `intent: 'control-original'` and **no** per-event activate; Esc → View + cancel queued input.
- Per-app profile in `lens-capabilities.ts` (Spotify ≠ ChatGPT ≠ Finder ≠ generic).

#### 5. Acceptance (requested experience)
| Check | Pass/Fail | Original comes forward? |
|---|---|---|
| Playlist selection in mirror | **FAIL** | N/A (not offered in mirror) |
| Track selection in mirror | **FAIL** | N/A |
| Scroll content in mirror | **FAIL** (unproven) | N/A |
| Search typing in mirror | **FAIL** (unproven) | N/A |
| Media buttons (AS) | **PASS** | **No** (Calculator stayed front) |
| Duplicate activate loop | **PASS** (not re-enabled) | — |
| Finder/other app generalized from Spotify | **No** — Interactive still disabled; Control original only |

**Remaining gap:** Owner still cannot drive Spotify’s full UI *inside* the Lens mirror. Closest reliable options are **Media** (transport) and **Control original** (real window). That is short of “interact with the app inside Lens.”

- **Checks:** `npm run typecheck` pass; `npm test` **337** pass; `npm run build` pass. Not committed / not pushed.

### 2026-11-21: App-switch routing (“Go to Cursor”) + Chrome site routing + Lens Spotify focus
- **Scope:** Three routing/focus bugs in one pass. Preserve GPT Mode forwarding, Lens viewing, and existing launch/confirm actions. No shell access for the language model. No commit/push.

#### Bug 1 — “Open ChatGPT in Chrome” (website + browser)
- **A. Routing:** `matchOpenSite` / `matchOpen` / `matchChatGpt` split site vs browser (`splitBrowserPreference`). “Open ChatGPT/GPT … in Chrome|Safari” → `open-url` `https://chatgpt.com/` + browser (Chrome → profile chooser). Bare “Open ChatGPT” stays `open-chatgpt`. Typed + voice share one path (no “Chatgpt In Chrome” missing card).

#### Bug 2 — Lens Control focus ping-pong on Spotify
- **B. Focus (traced):** `lens-pointer`/`lens-type` activated the source on every Control event while Lens is always-on-top → ping-pong. Fix: `--activate` opt-in only; scroll never activates; `cancelLensInput` on Esc / leave Control / source change.
- **C. Spotify media:** AppleScript play/pause/next/prev/volume (+ short timeout); `miko-ax media-key` fallback; Lens Spotify bar + **Open original**; generic remote Control/typing **disabled** for Spotify.

#### Bug 3 — “Go to Cursor” → assistant (“I can’t switch apps from here”)
- **Root cause:** `matchOpen` only accepted `open|launch|start`, so “Go to Cursor” / “Switch to Spotify” / “Bring WhatsApp forward” missed the app catalog and fell through to the assistant (especially with an active thread).
- **Fix:** Expand `matchOpen` for go to / switch to / bring…forward / take me (back) to / focus / show; resolve via existing catalog → `launch`/`confirm` (same `launchApp` / `open -a` focus-or-launch). Negations ignored; questions stay questions; `type exactly` stays type-dest; websites still via `matchOpenSite`; GPT Mode active still forwards only. “Back” / “take me back” uses `lastExternalApp` from working context (clarify if missing). Success reported only after launch + frontmost verify when checkable. `notes` added to `ACTION_ID`. Case-insensitive `resolveApp` for Title Case external names.
- **Live verify:** From Chrome frontmost, activating Cursor (`open -a` / same mechanism as launch) → frontmost **Cursor**. Router: voice/typed `Go to Cursor` → `confirm` (`app-cursor`) even with `assistantActive` (unfamiliar first-time confirm); after owner confirm, later opens are `launch`. Distinctions covered by unit tests (youtube.com, how-do-I, don’t switch, type exactly, back clarify).

- **Live verify (Chrome site + Spotify media, earlier same day):** ChatGPT-in-Chrome URL/browser routing OK; Spotify AS media with Chrome front unchanged; media-key fallback may hit Music; Spotify remote Lens Control disabled.
- **Checks:** `npm run typecheck` pass; `npm test` **335** pass; `npm run build` pass; `miko-ax` recompiled (earlier). Not committed / not pushed.

### 2026-11-21: MIKO Lens Control + real file transfer
- **Scope:** View/Control modes, coordinate-mapped input into the **bound** source window, Finder file resolution + shelf (copy / Reveal / native `startDrag`), ChatGPT file paste (unsent). Preserve viewer + GPT forwarding. IPC stays on `trustedGptLive`. No commit/push.
- **Control:** `miko-ax` `lens-window` / `lens-pointer` / `lens-type` via CGWindow id from `window:<id>:…`. Verifies pid + point inside bounds before click/dblclick/scroll/type; refuses wrong `expectSourceId` and outside clicks; Esc / frozen / closed source leaves Control. Brings the source forward when needed (honest footer). Toolbar never forwards clicks. Shared `mapLensPointToScreen` covers zoom/pan/crop (+ unit tests).
- **Files:** Finder selection → real POSIX paths (AppleScript, never OCR). Shelf + native picker + proven attachment paths. `clipboard-file` for real file pasteboard; Electron `startDrag` for shelf drag-out. Finder source shows **Attach to ChatGPT…** as a destination action (not drop onto Finder).
- **ChatGPT attach:** `paste-file-chatgpt` puts a file URL on the pasteboard and ⌘V while ChatGPT is frontmost — **never Return**. ChatGPT’s AX tree hangs / doesn’t expose attachment chips reliably → **does not claim Attached**; instructs Open ChatGPT / check composer. Does not trigger GPT Mode auto-submit.
- **Live verify (disposable `/tmp/…/miko-lens-disposable.txt`):**
  - **A. Viewer interaction:** Bound Finder bounds OK; click OK (activated when needed); wrong sourceId refused; outside bounds refused; GPT Mode stayed `active`. (ChatGPT itself often absent from `desktopCapturer` this session.)
  - **B. Native file drag/copy:** Finder selection resolved the disposable file; clipboard write verified as file URL (`public.file-url` / `«class furl»`); shelf register OK. `startDrag` wired from shelf drag handle (OS drop into a third-party window not fully automated).
  - **C. ChatGPT attachment:** With ChatGPT frontmost, paste completed; **verified=false / status=failed** with honest “can’t claim Attached” + Open ChatGPT guidance; no submit language. Lost-focus correctly refused when Finder was still front after Control.
- **Checks:** `npm run typecheck` pass; `npm test` **332** pass; `npm run build` pass. Not committed / not pushed.

### 2026-11-21: MIKO Lens redesign (polished GPT live viewer)
- **Scope:** Redesign floating GPT live viewer as **MIKO Lens** — layout, charcoal chrome, simplified controls, crop editor, collapsed pill. Preserve capture, exact-source verification, GPT Mode forwarding. No commit/push; no resend of prior prompts.
- **Window:** Default **960×680** (clamped into work area with **24px** inset); remember bounds but bump undersized saves toward reading size; reclamp on display change. Frameless, independent drag/resize; initially near pet. Closing Lens sets `liveView=false` and does **not** exit GPT Mode.
- **Layout:** Fixed header + toolbar + scrollable viewport + slim footer; image never overlaps controls. Collapsed → **pill** near pet (`ChatGPT · Live` + Expand/Close); capture loop slows while collapsed; UI sync via collapse push event.
- **UI:** Nearly opaque `#14181f`, 18px corners, cyan border/shadow, paw + “MIKO Lens”, source subtitle, Live/Frozen/error (no pulse/scanlines). Header: source / change source / collapse / close. Toolbar: Fit, zoom −/%/+, Crop, Freeze, Expand + overflow (Actual, Reset crop, sizes, Open ChatGPT, Diagnostics). Styled buttons. Panel toggle labeled MIKO Lens.
- **Reading:** New sources start in Fit; Retina aspect preserved (live **2867×1800**); zoom around viewport center + pan; visual crop with Apply/Cancel (relative crop, revalidated on source resize — no guessed sidebar cut). Footer: scrolling mirror ≠ scrolling ChatGPT; Open ChatGPT for real interaction.
- **Live verify (CDP `:9230` + screenshot):**
  - Window **960×680**; shell ~938×678; header/toolbar/footer always present; viewport top aligns with toolbar bottom (no overlap).
  - Bind ChatGPT → Live + frame at Fit ~50%; footer warning visible; Frozen distinct; collapse pill `ChatGPT · Live`; WhatsApp still **Other app** (not ChatGPT).
  - Close Lens → GPT Mode stays **active**, `liveView=false`. No forwarding exercised this pass (nothing resent).
- **Checks:** `npm run typecheck` pass; `npm test` **326** pass; `npm run build` pass. Not committed / not pushed.

### 2026-11-21: Live viewer “Not allowed.” — IPC allowlist fix
- **Root cause (traced before change):** Not macOS Screen Recording, not Electron capture config, not source-ownership. The floating `gpt-live` window shares preload APIs, but `trusted()` → `isTrustedSender` only accepts the **pet** `webContents`. Viewer **Choose window / Refresh** called `gptModeListSources` → `{ reason: "Not allowed." }`.
- **Fix:** `isGptLiveSender` + `trustedGptLive()` for a **narrow** live-view IPC set only (`get`, `listSources`, `setSource`, `liveSnapshot`, `liveView` close, `focus`, `sizePreset`). Send/enable/exit/pause stay pet-only. State events also `postToGptLive`. Actionable deny strings instead of raw “Not allowed.” Did **not** ask to re-grant Screen Recording (`permission=granted`).
- **UI:** Nearly opaque `#12161c` reading surface; zoom/crop/freeze disabled until a live frame exists; new source resets to **Fit**; cleaner picker styling.
- **Live (from actual `gpt-live.html` CDP):** listSources OK; bind ChatGPT “Build MIKO Phases” → frames **2867×1800**; Refresh OK; fake closed source → `source-closed`, empty frame (no WhatsApp substitute); rebind ChatGPT OK; GPT Mode stays active. No prior prompts resent.
- **Checks:** typecheck; `npm test` **326**; build. Not committed / not pushed.

### 2026-11-21: GPT Mode live reading window (source bind + zoom)
- **Scope:** Replace pet-sized “Live ChatGPT view” thumbnail with a separate resizable floating reader; fix wrong-source binding (WhatsApp shown as ChatGPT). Preserve forwarding / other MIKO features. No commit/push.
- **Source bind:** Snapshot uses the **exact** `captureSourceId` only — never auto-substitutes WhatsApp, Notes, desktop, or another window when ChatGPT capture fails. Clears binding + frame on source closed / foreign mismatch. Toolbar shows **actual** owner + window name. `isExcludedCaptureOwner` no longer treats chat titles containing “MIKO” as the MIKO app.
- **Viewer:** New `gpt-live.html` + `src/main/gpt-live-window.ts` — default ~900×650 (Compact / Reading / Expand), drag + remember bounds, near pet initially, independently movable, opaque reading surface + cyan accents. Slim toolbar: Source / Zoom / Fit / Freeze / Open ChatGPT / Close (+ Crop / Reset crop / Details / size). Closing viewer does **not** exit GPT Mode.
- **Zoom/pan:** Fit / Actual / −+ %; scroll + drag-pan; optional manual crop. Capture thumbnail size Retina-capable (live: **2867×1800**). Viewer zoom ≠ scrolling ChatGPT; Open ChatGPT kept for real interaction. No OCR / reply extraction.
- **Failures:** `need-permission` / `source-closed` / `source-unavailable` / `capture-failed`; empty frame on failure (no stale “live” image); Retry / Choose window / Open ChatGPT.
- **Live (CDP `:9230`, rebuilt):**
  - Floating `gpt-live.html` opens; Screen Recording **granted**.
  - Sources include recommended **ChatGPT · “Build MIKO Phases”** plus Notes/WhatsApp/etc. Binding ChatGPT → exact ID, owner ChatGPT, high-res frame. WhatsApp pick binds exact ID and labels **Other app / WhatsApp** (not ChatGPT). No silent substitute when switching.
  - Close viewer → GPT Mode stays `active`, `liveView=false`. Size preset OK.
  - Forward once → `delivery-unverified` / `submittedVerified:false` (native submit still not fully verifiable). Did **not** re-send the prior multi-paragraph user prompt.
  - **Readability:** High-res capture + reading-sized window verified in automation; multi-paragraph text comfort is for human eyeballing in the floating viewer (not claimed from thumbnail-only or unit tests).
- **Checks:** `npm run typecheck` pass; `npm test` **326** pass; `npm run build` pass. Not committed / not pushed.

### 2026-11-21: GPT Mode screenshot fixes (status + capture + UI)
- **Scope:** Fix stuck Preparing vs banner “Return was sent”; live-window discovery without title-only matching; simplify banner; verify real flow. Preserve other MIKO features. No commit/push.
- **Shared request state:** `pushEntry` returns stable id; GPT cards sync terminal status from main `lastRequestId`/`lastStatus`. Uncertain native Return always ends as **`delivery-unverified`** (composer clear ≠ proof; no auto-retry Return). Never left pending.
- **Capture:** System Events ChatGPT titles + `desktopCapturer` sources; recommend by process/title match, not “ChatGPT” substring alone. **Choose ChatGPT window** picker with thumbnails; bind selected source; clear on closure. Kinds: `need-permission` / `need-window` / `capture-failed`. Never auto-bind Notes/Cursor/desktop/Codex helpers — only a single recommended match may auto-bind.
- **UI:** Banner is **GPT Mode · Connected / Paused / Needs attention**; diagnostics behind Details. Per-request status + next action. Hologram above pet, clamped on-screen; unavailable → Choose window / Retry / Open ChatGPT. Avoid spamming conversation with capture errors.
- **Live (CDP `:9230`, rebuilt preview):**
  - **Forward:** send “MIKO verify once only” → card + state both `delivery-unverified` (not Preparing). Banner short (`Needs attention` after unverified send; `Paused` on pause). Pause / Resume / New chat (`ok`, `verified:false`) / Exit (`phase:off`) OK. Native submit **not** fully verifiable — do not claim Submitted.
  - **Capture:** Screen Recording currently **denied** for this Electron host (`need-permission`); no silent Notes bind. (Earlier diagnosis may have reset ScreenCapture TCC — re-grant for Electron/Cursor/MIKO in System Settings to retest hologram.) When permission denied, UI offers Settings path + View in ChatGPT.
- **Limitation (honest):** ChatGPT desktop composer rarely exposed to AX → delivery always unverified after Return. Live preview needs Screen Recording + a capturable ChatGPT window (picker); without that, use View in ChatGPT / browser destination. Feature is **not** fully verified end-to-end for native submit or live mirror under denied permission.
- **Checks:** `npm run typecheck` pass; `npm test` **324** pass; `npm run build` pass. Not committed / not pushed.

### 2026-11-21: Opt-in GPT Mode (forward + submit) + live view
- **Scope:** Simple GPT Mode — panel + paw toggle; ordinary typed/final voice → ChatGPT app insert+submit when active; New chat / Pause / Exit; start **paused** after relaunch; never forward partials or mode-toggle commands. Separate from MIKO assistant. Hologram investigated. No commit/push.
- **Forwarding:** `src/shared/gpt-mode.ts` + `src/main/gpt-mode.ts` + IPC/preload. Request IDs; cancel bumps generation (no blind Return retry). Statuses: Preparing → Text inserted → **Delivery unverified** (Return while frontmost; composer clear never counts as Submitted) / choose-insert / failed / cancelled. Enabling explicitly authorizes submit. Existing composer text → Replace/Append/Cancel.
- **UI:** Panel “GPT Mode” button + short Connected/Paused/Needs attention banner (Details for diagnostics) + New chat / Pause / Exit / View in ChatGPT / Live view / Choose window. Paw menu checkbox + Pause/Resume. Local phrases: exit/pause/resume/enable/new chat/cancel.
- **Hologram (stage 2):** Electron `desktopCapturer` + Choose-window picker (Screen Recording). Whole-window labelled preview only (no answer crop / no reply extraction); noninteractive frame; freeze/collapse/close; Open ChatGPT focuses original. Permission / missing window / capture failure distinguished. Frames transient. Never silently capture Cursor/desktop/Notes/Codex helpers.
- **Limitation (honest):** ChatGPT/Codex desktop rarely exposes composer to AX — submit is always **delivery-unverified**, never claimed from keystroke alone. New chat often unverified empty-composer. Live view needs Screen Recording + capturable ChatGPT window (or View in ChatGPT).
- **Live (separate layers):** see **GPT Mode screenshot fixes** entry above for current observed results.
- **Checks:** typecheck; tests; build — superseded by later same-day entry. Not committed / not pushed.

### 2026-11-21: ChatGPT paste failed (“doesn’t expose editable field”)
- **Cause:** (1) With an active type-dest, “Type in GPT to check my mail” was stolen as a bare follow-up → draft `in GPT to check my mail` instead of `type-in-gpt` / `check my mail`. (2) `miko-ax paste --allow-unexposed` only ran when `element == nil`; ChatGPT often focuses a non-editable AX node, so paste never ran.
- **Fix:** Route `matchTypeInGpt` before type-dest follow-ups; exclude “in GPT” from bare/follow-up parsers; allow-unexposed paste when focused node is missing **or** not editable; ChatGPT insert always re-activates app + unverified ⌘V path; Paste now keeps saved ChatGPT destination.
- **Live:** ChatGPT insert → `pasted-unverified` with harmless unsent text. typecheck + **319** tests. Not committed / not pushed.

### 2026-11-21: Panel buttons dead — stuck switcher + click-through
- **Cause:** App switcher left visible above the chat panel (`pop-up-menu` z-order). CSS `pointer-events: none` on empty glass does **not** make an Electron window click-through, so clicks on Paste now / Cancel / Chat never reached MIKO. DOM handlers were fine.
- **Fix:** Hide switcher when the panel opens; while the panel is open, pet window always accepts mouse; switcher uses `setIgnoreMouseEvents(true, { forward: true })` and only disables ignore over cards/controls.
- **Checks:** typecheck pass; rebuilt preview. Not committed / not pushed.

### 2026-11-21: Open → navigate → type destinations (type-dest)
- **Scope:** Natural “open app / go somewhere / type here” without a second command system. Reuse ChatGPT typing, selection writeback, WhatsApp composer, cancel/supersede, destination verification. No commit/push. Live tests: harmless text only; never send; don’t overwrite personal drafts.
- **Shared model:** `src/shared/destination.ts` — `TypeDestination` (app/process, field role/sig, label, capture time, verified, secure). Capture before MIKO focus; never treat MIKO’s own input as the target. Soft TTL; recheck immediately before insert.
- **Plans not app blobs:** `src/shared/type-plan.ts` — `parseTypeIntent` → ordered `ActionPlan` (`launch_app` → `chatgpt_new_chat` → `insert_text` / omnibox / choose). Typed and voice share one path. “Ask ChatGPT …” is submit-flagged and ordered before generic type verbs; no Enter-to-finish.
- **Main adapter:** `src/main/type-dest.ts` + AX `keystroke` / `omnibox-set`. ChatGPT: open + ⌘N; if composer AX-unexposed → `pasted-unverified` (honest); new-chat with leftover composer text → refuse insert into prior chat. Omnibox: set text, never navigate. Notes/external: insert when AX editable; else “Paste now” / Copy. Secure fields blocked. Replace/Append/Cancel when field already has text; cancel + newer task invalidate stale writes.
- **Panel:** type-dest card — destination, editable draft, Preparing → Ready → Inserting → Inserted (or Insertion unverified), Change destination / Copy / Cancel / Paste now.
- **Regression:** `src/shared/scenarios-type-dest.test.ts` (compound ChatGPT, follow-ups, literal, recipient-aware handoff, ambiguous dest, existing text / edits, wrong window, cancel/supersede, duplicate plan, new-chat fail, secure, type vs submit). Wired into `npm test`.
- **Supported destinations (honest):**
  | Destination | Insert | Verify | Submit |
  | --- | --- | --- | --- |
  | ChatGPT desktop composer | Yes (paste when AX missing) | Often unverified (`pasted-unverified`) | Flag only; no verified native submit path |
  | Chrome/Brave address bar | Yes (`omnibox-set` / ⌘L) | Verified when AX reads back | Never navigates unless user asks open/go |
  | Notes | Open + choose field | Weak AX — usually “Paste now” | N/A |
  | Generic AX text field/area | Yes when editable + non-secure | Recheck before/after | N/A (type ≠ send) |
  | WhatsApp composer | Existing WA path (tell / Draft: / type exactly with `waChat`) | Existing verify-then-insert | Existing send only on explicit send |
  | “Type here” | Pre-panel captured editable field | Must still verify | — |
  | Choose where / Paste now | Armed draft; user focuses field; explicit paste | Focused editable rechecked | — |
- **Limitations:** ChatGPT desktop (incl. Codex bundle) often hides composer from Accessibility — success is never claimed from keystroke alone. No ChatGPT reply extraction / memory. Notes rarely exposes note body. Password fields refused. No generic Enter after type. Ambiguous Notes (“which note?”) / choose-destination when capture fails.
- **Live AX (CDP `:9230`, separate from unit tests):** ChatGPT open + new chat + insert unsent → `pasted-unverified`; panel follow-up type-dest entry; Notes open → `unsupported` + Paste now; omnibox `youtube.com` → `inserted` not navigated; cancel issued; capture reports `secure=false`. Deterministic suite green separately.
- **Checks:** `npm run typecheck` pass; `npm test` **318** pass; `npm run build` pass.
- **Not committed / not pushed.**

### 2026-11-20: Panel workflow + live-model wording (Me 2 empty composer)
- **Scope:** Dedicated test chat **Me 2** with empty composer; never send; leave **Me** draft untouched; restore Me 2 `Thanks, will check tomorrow.` after. Drive real panel (not IPC-only). Score model / panel / AX separately. No commit/push.
- **Automation:** `window.__mikoPanel.open/submit/snapshot` calls React `applyPanel` + `onSubmit(text)` (CDP `setPanelOpen` alone does not open the panel UI).
- **Fixes shipped this session (existing stack):**
  1. **POV** — prompt example + `polishRecipientAddress` (`take them` → `take you` when framing pronoun matches).
  2. **Timing revision** — fixed `/g` `lastIndex` bug; “Not tomorrow, Friday” replaces only the negated day (keeps evening); “Make it shorter” is not a timing revision.
  3. **Revision regenerate** — passes `previous` draft + “timing only” change so evening/questions survive Friday edits; additive merges update `instruction` on the entry.
  4. **“Tell them Sam will join her”** — `mismatchedThirdPersonQuestion` + clarify options; with an active draft, bare `tell them` is **additive** (no wipe); clarify merges Sam into the existing draft.
  5. **Auto-insert** — `patchWaReply` syncs `entriesRef` immediately (was no-op insert because draft looked empty pre-render).
  6. **S17 refine** — peek composer before refine; external edit → `choose-insert`; don’t mis-label model draft≠insertedText as “edited in MIKO”.
- **Verified live (panel + bridge + AX, unsent):**

  | Step | Expected | Result |
  | --- | --- | --- |
  | 1 Tell them movie tomorrow | `I'll take you to the movie tomorrow.` + insert | Pass — POV you; status `inserted` into Me 2 |
  | 2 Also ask evening | natural `you` question | Pass — `…Are you free in the evening?` |
  | 3 Not tomorrow, Friday | day change, rest kept | Pass — Friday + evening kept |
  | 4 Sam will join her | clarify / third person | Pass — asked who “her” is; after “person I’m messaging” → `…Sam will join you.` merged |
  | 5 Summarize don’t reply | summary only; composer unchanged | Pass — WA summary path; composer length unchanged |
  | 6 Continue my message | restore draft + Me 2 | Pass — full Friday+evening+Sam draft on Me 2 |
  | 7 Manual edit + shorter | detect; no silent replace | Pass — `choose-insert`; MANUAL EDIT preserved |
  | 8 Switch mid-gen + cancel | no wrong-chat insert | Pass — Me draft preserved; Me 2 no “five minutes late” |

- **Layer scores (final verified pass):**
  - **Model wording:** pass (POV you, evening question, Friday revise, Sam merge, no invented tickets/times).
  - **Panel workflow:** pass (revise, clarify, suspend/resume via summarize→continue, external-edit gate).
  - **AX execution:** pass (Me 2 destination, insert/unsent, composer preserve, switch+cancel, Me untouched, Me 2 restored).
- **Checks:** typecheck pass; `npm test` **303**; build pass; preview CDP `:9230`.
- **Not committed / not pushed.** Authorship PRANAV SAIRAM only.

### 2026-11-20: Live/AX validation of playbook + continuous conversation
- **Scope:** Running macOS app (CDP `:9230`, rebuilt). Prioritize S14/S15/S17/S23/S29–S30/S37–S38/S40 + continuous flow. Test chats only; leave unsent; preserve existing drafts. Score layers separately. No commit/push.
- **Exact failures found (and fixes in existing stack):**
  1. **`Summarize what they sent. Don't reply.`** — trailing `sent. Don't` left a period so summarize intent missed. Strip now allows `,.` before don’t-reply + trailing sentence punctuation.
  2. **`What did she just say?` (S14)** — “just” broke the paraphrase. Allow optional `just`. When `atLatest===false` && `preferLatest`, UI now always offers visible vs go-to-latest (even if bubbles exist) — previously only when zero messages.
  3. **`Also ask if they're free`** — `'re` contraction not handled (only `'s`). Extended ask-if parser; sets `them` + additive.
  4. **S17 external composer edit** — `resolveAdditiveFollowUpMode` fell through to `refine-unsent` when composer ≠ inserted. Now returns `blocked-edit`.
  5. **Summarize mid-draft cancelled the draft task** — `startWhatsAppSummarize` overwrote `activeTaskRef` after suspend. Added `suspendedTaskRef`; summarize parks then restores; “continue my message” finds the parked task.
  6. **S38 `No, this is for B`** — missing. Added `parseRecipientRetarget` + `takeRecipientRetarget` (clears old insert auth, opens B, keeps instruction).
  7. **S37** — draft prompt now keeps named third persons (e.g. Sam) while binding recipient pronouns to you.
- **Continuous conversation (deterministic routing): 8/8**
  - Tell them… → `them` + movie tomorrow; Not tomorrow, Friday → Friday only; Also ask if they're free → additive; Make it more casual → refine; Summarize… don’t reply → `whatsapp-summarize`; continue my message phrase recognized; POV prompt present.
- **Live AX (this Mac; unsent):**
  | Check | Result |
  | --- | --- |
  | Peek / AX | Pass — WhatsApp readable (`peeked`) |
  | Open Me | Pass — chooser then exact Me opened (`composerReady`) |
  | Preserve drafts | Pass — skipped insert on Santhosh G (`I hate you`) and Me (`7:05 PM…` draft); restored Me after a bad probe |
  | Summarize peek vs composer | Pass — composer text unchanged across peek(true) |
  | S19 switch insert | Pass — on Me 2, `expectHeader: Me` → `switched`; Me 2 composer untouched (`Thanks, will check tomorrow.`) |
  | S20 cancel | Pass — `whatsappCancel` |
  | S14 older-history UI | Code fixed; live chat was `atLatest=true` so range chooser not exercised on-screen this pass |
  | S15 unreadable | Not forced (AX readable); failure path now suggests select-text |
  | S23 duplicates | Deterministic `uniqueDownloadPath` still pass; no live dual-Downloads fixture |
  | S29–S30 mail | **Not live** — no mail thread fixture this session; no noreply handler claimed |
  | S40 | Quit APIs present; close UI still “Requested…” (not verified end-to-end quit here) |
  | Full panel continuous (steps 3–8 with model draft) | **Not driven** — would overwrite Me’s existing unsent draft; routing+prompt covered deterministically |
- **Layer scores (do not conflate):**
  - Deterministic routing/tests: **303** pass (incl. `scenarios-live-ax.test.ts`).
  - Live-model draft wording: **not scored** (no paid/model insert run on Me).
  - Live AX execution: peek/open/switch-guard/cancel/composer-preserve as above; panel multi-turn + older-scroll + mail still limited.
- **Checks:** typecheck pass; test **303**; build pass.
- **Remaining limitations:** Windows WA; S14 older-scroll live UI; S15 forced AX failure; S29–S30 mail live; S40 full quit verify; panel-driven continuous draft without clobbering existing Me text; live-model POV accuracy unset.
- **Not committed / not pushed.** Authorship PRANAV SAIRAM only.

### 2026-11-20: Playbook-driven context/conversation hardening
- **Input:** `docs/MIKO_CONTEXT_AND_CONVERSATION_PLAYBOOK.md` (moved from repo root) + recent log. Extended existing ContextSnapshot / task purpose / clarifications / interpret — no parallel context system. No model-training claims.
- **Gaps closed against playbook:**
  1. Compact runtime contract folded into `interpretPrompt` + tighter `assistantInstructions` (external text = data; no invented tool success).
  2. **S10** `Not tomorrow, Friday` timing revision (alongside `Actually, next week`).
  3. **S06** `Ask if she's free…` (contraction) → pronoun-bound draft.
  4. **S16** `Explain this, don't reply` → selection explain (read-only).
  5. **S22** bare `Copy it` with both a verified file and another recent result → ambiguous clarify (not blind “most recent”).
  6. **S26** `Safari instead` revises pending browser open (not an app named “Safari Instead”).
  7. **S35** `continue my message` resumes a suspended task; **S36** expired chooser detected (`choiceExpired`) and refreshed instead of stale “second one”.
  8. **S13** `summarize what they sent` → WhatsApp summarize intent.
- **Regression:** `src/shared/scenarios-playbook.test.ts` maps S01–S40 deterministically where shared-layer checks apply (not live AX). Prior conversation A–H tests retained.
- **Checks:** typecheck pass; `npm test` **296** pass; build pass.
- **Verified separately:**
  - **Deterministic:** playbook + conversation scenario suites; holdout eval JSON untouched.
  - **Mocked/live model:** not scored this session.
  - **Live app:** prior CDP unsent checks still apply; this pass focused on shared-layer + build. No messages/attachments sent.
- **Still limited:** Windows WA; full S14/S15/S17/S23/S29/S30/S37/S38/S40 need live AX or mail fixtures; paid interpret accuracy unset.
- **Not pushed.** Authorship PRANAV SAIRAM only.

### 2026-11-20: Contextual understanding through complete conversations
- **Goal:** Remember the current task purpose across turns; route clarification answers before assistant fallback; track fact sources; suspend (not erase) on unrelated questions; POV drafting; bounded history that keeps unresolved goals; correction examples via `retrieveExamples`; scenarios A–H. Reuse ContextSnapshot / task history / bindPlanToSnapshot / capabilities / cancellation — no second context system.
- **Failures found / fixes:**
  1. **History trim dropped `needs_choice`** — `appendTaskHistoryPreferUnresolved` took newest completed first and evicted unresolved waits. Fixed: always keep newest entry + unresolved/suspended, then fill by recency.
  2. **“Ask if she wants …” unknown** — with a verified chat, `Ask if she…` did not parse as a WhatsApp draft (only `ask her …`). Added `ask if she/he/they` → pronoun-bound `whatsapp-reply`.
  3. **Ambiguous “make it shorter”** — two draft chats in history returned `ambiguous` from `resolveRequestReferences`, but refine always used the latest `wa-reply`. `startWhatsAppReply` now asks which draft via `ambiguous_ref` clarification.
  4. **Bare “it/that” after a suspended task** — could mean the paused goal or a mid-task general answer. `maybeClarifySuspendedIt` asks once instead of guessing “most recent”.
- **Implemented (extends existing stack):** `TaskPurpose` / `PendingClarification` / `HeldWaDraft` / `FactSource` on `task-purpose.ts`; `suspended` phase + suspend/resume; clarification + timing revision (`Actually, next week`) before assistant; held draft retained on failed WA search; destination `source: 'observed'` on verified header; `retrieveExamples` still wired into interpret.
- **Scenarios A–H:** `src/shared/scenarios-conversation.test.ts` (deterministic). Holdout eval sets unchanged (`eval/holdout-*.json`). Live-model scoring not claimed.
- **Checks:** `npm run typecheck` pass; `npm test` **277** pass; `npm run build` pass. Deterministic live routing smoke A–H: **9/9**.
- **Live (this Mac, unsent):** Restarted preview with CDP `:9230`. `whatsappOpen` while WhatsApp covered → `lost-focus` (no send). After Activate WhatsApp, nonsense contact search → `choices` (fuzzy rows) then `whatsappCancel` — nothing inserted/sent. Full multi-turn panel self-chat (recipient retry → “Santosh G” → draft) still relies on routing tests + prior WA recovery path; header recheck before insert unchanged.
- **Still limited:** Windows WA; paid live-model interpret accuracy; panel UI multi-turn not fully CDP-automated (panel input). Expired clarification asks to resume rather than auto-acting.
- **Not pushed.** Authorship unchanged (PRANAV SAIRAM only).

### 2026-11-20: WhatsApp failed-search recovery (keep draft; route corrections)
- **Symptom:** “Open Santosh Ji in WhatsApp and tell him …” → no results → MIKO dropped the pending message; “Santosh G” went to the general assistant (unrelated class example) instead of retrying the contact open.
- **Root cause:** `runWhatsApp` cleared `pendingWaDraftRef` on `none`/`failed` and noted “I dropped the pending message…”. There was no awaiting-recipient state, so bare / “I meant …” corrections never rematched WhatsApp routing (especially with `assistantActive`) and fell through to the assistant.
- **Fix:** Keep the held draft on no-match; show `wa-recipient` UI (“No match for …. Who did you mean?”) with editable name, Retry, Cancel; set `awaitingWaRecipient` + messaging without binding a prior chat header. Router (`parseWaRecipientCorrection` + `awaitingWaRecipient`) sends “Santosh G” / “I meant …” / “Search … instead” back to `whatsapp` while cancel and known app opens supersede. `runActionPlan` stays in `needs_choice` until a chat verifies; draft still resumes only after header match; chat-switch still blocks wrong-destination insert.
- **Checks:** `npm run typecheck` pass; `npm test` **265** pass; `npm run build` pass. Routing smoke (typed+voice): compound open+tell keeps pending instruction; awaiting bare/meant → `whatsapp`; cancel → `cancel-workflow`; `open calculator` → `launch`; bare name without wait ≠ WhatsApp.
- **Live:** CDP `whatsappOpen("ZZZNoSuchContactMIKO999")` returned `lost-focus` (WhatsApp didn’t stay front in this automation pass) — no message sent. Recovery keep-draft / correction routing covered by tests; verified-header draft insert path unchanged.
- **Not pushed.** Authorship unchanged (PRANAV SAIRAM only).

### 2026-11-20: Tab+Q “Feed to close” (drag card → pet)
- **Feature:** Drag an app/tab card from the Tab+Q fan onto MIKO to request a normal graceful quit (tabs: close that tab only). Click still focuses; drag starts after a 10px threshold; Escape / drop elsewhere cancels; card removed only after the process/tab is actually gone; never force-quits; “Waiting for [app]” when a save sheet keeps it alive; duplicate drops return `busy`.
- **Reuse:** Existing switcher fan, `quitPid` / `requestGracefulQuitPid` + `waitUntilPidGone`, `closeTabVerified`, pet registry `feedDrop` / `feedClips`, transparent fan (no full-window glow).
- **Pet reaction:** Preferred existing clips (cat `LickPaw`, bird `Peck`/`Chirp`, koala `Wave`); Doberman brief upward look via look damper. `PetCommand` `feed` forwarded in preload (was previously dropped). Reduce Motion respected.
- **Checks:** `npm run typecheck` pass; `npm test` **261** pass (incl. feed drop geometry + feed clip asset checks); `npm run build` pass.
- **Live (this Mac):** Calculator graceful terminate via JXA → gone; Chrome tab close left browser + other tabs; UI showed “Release to quit Calculator”, “Drop on MIKO… Esc cancels”, and Escape → “Cancelled — nothing was closed”; CDP `feedApp(Calculator)` → `closed` / process gone; CDP `feedTab(MIKO-feed-tab-X)` → closed, Chrome stayed; parallel `feedApp` → one `closed` + one `busy`. (One busy-path probe used Chrome and quit it; relaunched.)
- **Not pushed.** Authorship unchanged (PRANAV SAIRAM only).

### 2026-11-19: Fix “App is damaged” for Sandy (0.1.1 ad-hoc)
- **Symptom (Sandy, 0.1.0 arm64):** “MIKO is damaged and can’t be opened”; right-click Open / Open Anyway unavailable.
- **Distributed 0.1.0 DMG:** `hdiutil verify` OK; SHA-256 `e6932331cbe71d8e96a19ef33a9e4e4776e8345fffeea15777a51fd10513c5c0`. Copied app: arm64, no broken symlinks, exec bits OK. **No quarantine on this build machine.**
- **Root cause (signature invalid, not “Gatekeeper hates unsigned” alone):** `electron-builder` `identity: null` left linker-signed stub → `codesign --verify --deep --strict` = **INVALID** (`code has no resources but signature indicates they must be present`; `Sealed Resources=none`). That failure + quarantine on a friend’s Mac surfaces as **damaged** (GUI often cannot bypass). Separate from `spctl` reject for unnotarized apps.
- **Fix:** `mac.identity: "-"` (ad-hoc) + `hardenedRuntime: false`. Bump **0.1.1**. `npm run beta:verify-pkg` confirms VALID + sealed; `spctl` still REJECTED (expected until Developer ID notarization). Do **not** promise Gatekeeper silence.
- **New arm64 DMG SHA-256:** `74d49a8853fd2a68091a04f75dc9ebe5a81580e17738508b274d85ec11c24b8f` (`release/friend-handoff/`). TESTER.md corrected (damaged vs unverified; optional `xattr -dr com.apple.quarantine` on the app only). **Not published; not claimed fixed until Sandy launches.**

### 2026-11-19: Zero-budget DMG built + package inspection (not published)
- **Checks:** typecheck pass, **260** tests pass, `npm run build` pass, `npm run dist:mac` pass (unsigned, identity null).
- **Installers:** `release/MIKO-0.1.0-arm64.dmg` (~135 MB, Apple Silicon) and `release/MIKO-0.1.0-x64.dmg` (~139 MB, Intel). Friend pack: `release/friend-handoff/` (+ `TESTER.md`, owner README). Ad-hoc signature only.
- **Personal-data scan:** no `.env`, no `miko-settings`/mail tokens/owner feedback config in bundle; no `/Users/sairampranav` paths in asar; OAuth hits are field/env **names** only; emails are `example.*` fixtures. Clean `--user-data-dir` smoke: empty `feedback-queue.json`, no settings. Packaged userData dir name remains `MIKO-Beta`.
- **Not published.** Friend still needs another Mac for true Gatekeeper/first-run + their ChatGPT sign-in.

### 2026-11-19: Zero-budget private beta (no Apple/VPS required)
- **Switched default friend path** away from paid signing/hosting. Preserved signed updater + `feedback-server` for later; did not build a second system.
- **Updates:** unsigned packaged builds detect Developer ID; if missing → `mode: manual`, `autoDownload`/`quitAndInstall` off. Phases: available → download-opened → installed. Configurable shared URL (`MIKO_MANUAL_RELEASE_URL` / Preferences). Optional `latest.json`. Draft flush on download; prefs in `MIKO-Beta` survive app replace.
- **Feedback:** Preview + **Export report** primary; no “Feedback sent” unless remote `delivered`. Invite/remote submit only if endpoint configured.
- **Docs:** `beta/TESTER.md` (install, permissions, personal ChatGPT/Codex, export, manual updates, Gatekeeper, re-approval). `BETA.md` / `DISTRIBUTION.md` / `UPDATES.md` rewritten for zero-budget.
- **Assistant:** still requires tester’s ChatGPT.app + their sign-in; documented for clean laptops.
- **Checks:** `npm run typecheck` pass; `npm test` **260** pass. No purchases, deploy, or publish.

### 2026-11-19: Simplify beta setup (one path; Step 1 Apple)
- **No new distribution system.** Kept packaging / `release:beta` / updater / feedback-server.
- **Hosting choice:** one VPS (Caddy) for update feed + feedback — not R2+Fly separately. Costs before signup: Apple Developer **$99/yr**; VPS **~$4–6/mo**; domain **~$0–15/yr**.
- **Signing check on this Mac:** no **Developer ID Application**. Only `Apple Development: … (RN3XK4J8ZB)` (dev-only). Must create Developer ID after paid membership — not another Development cert.
- **Prep done:** simplified `beta/DISTRIBUTION.md`; slim `beta/env.example`; `npm run beta:verify-env` (no secret printing); Caddy + systemd examples; secrets dir `~/Library/Application Support/MIKO-release/` (700); seeded `beta/.env.local` from example if missing. R2 script left unused.
- **Not published.** Guided user at Step 1 only. Authorship unchanged.

### 2026-11-19: Distribution prep (signing, HTTPS feed, feedback durability)
- **Goal:** prepare real private-beta distribution without publishing; list exact credentials; HTTPS feed templates; preserve manual `release:beta`; distinguish implemented / locally tested / distribution-ready.
- **Signing / notarization (implemented, not exercised):**
  - `build/entitlements.mac.plist` (JIT, unsigned exec mem, disable-library-validation, mic).
  - `electron-builder.signed.yml` — standalone signed config (no `identity: null`); hardenedRuntime + notarize required.
  - Default `electron-builder.yml` remains unsigned for local builds.
  - `MIKO_SIGN=1` switches `scripts/release-beta.mjs` to the signed config and refuses to start without notarization env.
  - Credentials to supply (env only, `beta/env.example`): `CSC_LINK` + `CSC_KEY_PASSWORD` (+ optional `CSC_NAME`); notarize set A `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or set B `APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`.
- **HTTPS update feed (implemented templates, not hosted):** `beta/hosting/` — `publish-r2.sh`, `publish-rsync.sh`, nginx example, README. Secrets via `MIKO_UPDATE_PUBLISH_CMD` / AWS / SSH only. Manual release path unchanged.
- **Docs:** `beta/DISTRIBUTION.md` (numbered setup), `beta/VERIFICATION.md` (signed A→B + remote feedback checklists), `beta/feedback-server/DEPLOY.md`; UPDATES.md / BETA.md pointed at them.
- **Feedback durability (local):** `data/reports.json` present with **1** stored report; config gitignored; owner dashboard path unchanged. Remote HTTPS review still **not** distribution-ready.
- **Signed A→B / remote feedback:** **not run** — blocked on Apple Developer ID + feed/feedback hosts. Do not claim friend-ready auto-update or remote inbox yet.
- **Not published / not pushed.** Authorship: repo local git identity only; no AI trailers.

### 2026-11-19: Private-beta automatic updates (electron-updater)
- **Choice (official docs):** [electron-builder auto-update](https://www.electron.build/docs/features/auto-update/) via **`electron-updater` 6.8.12** + **generic** provider, channel **`beta`** (`beta-mac.yml`). No GitHub token in the app; feed URL is public-to-invitees hosting only.
- **Client:** startup check (~12s) + every 4h; background download; “Update ready” note + Preferences → Check for updates / Restart now / Later (silences that version); offline/errors never block the app; `updater.log` in userData.
- **Before restart:** cancel WA/attachment/bridge/paste/speech; write handoff so those actions are not replayed; recover chat-box draft; prefs/accounts stay in `MIKO-Beta`; settings schema migration hook.
- **Release (manual only):** `npm run release:beta -- --version X.Y.Z` runs checks, bumps version, builds Mac installers, writes feed URL into `update-feed-url.ts` + `build/app-update.yml`, copies artifacts to `release/update-feed/beta/`. Optional `--publish` runs `MIKO_UPDATE_PUBLISH_CMD` (credentials stay in env). Docs: `beta/UPDATES.md`.
- **Local A→B results (unsigned):**
  - A `0.1.0` against local feed → detected `0.1.1`, downloaded zip (~131 MB), phase `ready`.
  - Install then failed signature validation (`code has no resources but signature indicates they must be present`) — expected without Developer ID; **A remained usable**; prefs `beta-test-pref-keep-me` intact.
  - **Not claimed operational for friends** until signed + notarized A→B install succeeds and HTTPS host is live.
- **Platform install behavior (accurate):** macOS Squirrel.Mac stages update; applies on **Restart now** or normal quit — **not** force-quit. Windows NSIS: on quit / Restart now (when Windows builds are ready).
- **Faulty release:** publish a **higher** version; do not reuse the broken number.
- **Checks:** 258 tests pass, typecheck pass. Package left at `0.1.0` for review (release script is how versions advance). Not pushed.

### 2026-11-19: Private beta packaging + feedback inbox
- **Goal:** friends install without the repo; submit private feedback; owner reviews; no owner credentials/prefs/Codex login in the package.
- **Packaging (new):** `electron-builder.yml` + `npm run dist:mac`. Ships `out/`, `resources/` helpers, `pet_animals/` models. Does **not** ship `.git`, source as a project, `userData`, mail OAuth, or Codex auth. Artifacts: `release/MIKO-0.1.0-arm64.dmg` (+ zip); x64 targets also build. Guide: `beta/BETA.md`.
- **Clean profile:** packaged app uses `~/Library/Application Support/MIKO-Beta` (not `MIKO`/`miko` — APFS case collision with the owner’s npm-start profile). `--user-data-dir=` still honored for tests. Verified launch with a temp profile: empty `feedback-queue.json`, no `miko-settings.json` / mail tokens / aliases.
- **DevTools:** `devTools: false` + `hardenWindow` in packaged builds (not an anti-tamper claim). Pets/prefs remain available.
- **Assistant on a clean Mac:** still Codex via **ChatGPT.app** + the **tester’s** ChatGPT sign-in (`bridge.ts`). Not bundled. Preferences show readiness / “install ChatGPT and sign in” when missing. No developer Codex session is packaged.
- **Feedback client:** Settings → Send feedback; commands `report a problem` / `give feedback` (type `feedback`, never assistant); **Report this** on failed WhatsApp reply cards. Form: Problem/Suggestion, happened, expected, optional contact, optional last command (review), optional screenshot with preview/remove, Submit. Preview shows exact payload. Auto diagnostics only: version/buildId/OS/arch/actionType/errorCode. Queue statuses pending/sent/failed/exported; retry + delete; Export fallback when no endpoint.
- **Feedback server (local, verified):** `beta/feedback-server/` — invite codes + owner token in gitignored `config.json`, rate limit, payload cap, duplicate `clientKey` → 409, owner dashboard + Markdown/JSON export. Local E2E: POST stored, list readable, bad invite 401, duplicate 409, export MD, status → reviewing. **Remote delivery not live** until you host HTTPS and set `MIKO_FEEDBACK_URL` (or paste endpoint in-app). Do not claim friends’ reports reach you until that E2E is done.
- **Fixes found while verifying:**
  1. Packaged tray icon path pointed inside asar; resolved via `process.resourcesPath/resources`.
  2. Packaged userData `MIKO` collided with developer `miko` on APFS → switched to `MIKO-Beta`.
  3. Helper Swift sources now also resolve from packaged `extraResources`.
- **Signing:** `mac.identity: null` (unsigned). Testers: Finder → right-click → Open. Do **not** disable Gatekeeper/SIP. Windows still not labeled ready.
- **Updates:** manual versioned DMG for first beta; version line in Preferences; no auto-updater.
- **Checks:** 256 tests pass, typecheck pass, `npm run build` pass, arm64 DMG/ZIP built, local feedback server E2E pass. Not pushed; no deploy.

### 2026-11-19: Context / action layer audit (reuse architecture, no second system)
- **Goal:** every typed/spoken turn uses a fresh `ContextSnapshot` + bounded task history; resolve her/it/that file/shorter against verified objects; schema-validated `ActionPlan` from available capabilities; concise clarify when ambiguous; revalidate before execute, verify after, invalidate cancelled/superseded; preserve unsent drafts; multi-turn tests; report failures/fixes here.
- **Architecture reused (not replaced):** `WorkingContext` → per-turn `buildContextSnapshot` → `routeCommand` / `interpretPrompt` + `parseInterpretResult` → `bindPlanToSnapshot` → `beginExclusiveTask` / `runActionPlan` → `finishActiveTask` / `recordTaskOutcome`. Cap: `MAX_TASK_HISTORY = 8`.
- **Gaps found and fixed:**
  1. **Thin / stale interpret context** — interpreter prompt now gets `formatSnapshotForPrompt(snap)` (chat, draft, file, website, recent tasks) instead of sparse hints; refs via `resolveRequestReferences`.
  2. **No bind/clarify for missing referents** — `bindPlanToSnapshot` fills pronoun/file/draft/website targets from the snapshot or rewrites the step to `clarify` (e.g. “tell her…” with no verified chat; refine with no draft; copy/attach with no retrieved file).
  3. **Interpret overwrote live WA tasks** — `beginExclusiveTask` supersedes the prior live task (`supersedeTask` + history) before starting a new plan; interpret waiters are **token-scoped** and ignore cancelled tasks so a later WA draft is not clobbered by a stale interpret callback.
  4. **Draft not in WorkingContext for snapshots** — `liveDraftRef()` syncs the live composer draft into each `freshSnapshot()` so “shorter” / “make it more formal” resolve against the unsent insert, not a stale copy.
  5. **Cancel wiped useful context** — `cancelWorkflow` still cancels the task + bumps token, but **keeps** draft + retrievedFile so an unsent composer draft and “that file” survive cancel of a different step.
  6. **“copy that file” never routed** — `parseAttachmentIntent` only matched `copy this/the file` / `copy it`; added `this|that` follow-up so reference language hits `whatsapp-attachment` when `hasRetrievedFile` is set. Scenario test caught this as **actual: `unknown`**.
  7. **Typecheck** — unused `isFresh` import in `MotionApp.tsx` after wiring snapshots (fixed).
- **Multi-turn scenarios** (`src/shared/scenarios-context.test.ts`): unsent draft refine after an unrelated question; her → verified chat vs clarify when chat gone; that file + cancel invalidates task (keeps history); supersede + platform-filtered kinds (win32 rejects `close_browser_tab`); compound open+tell deterministic; cancel-workflow local; ambiguous pronoun → clarify, not a guessed target. Also expanded `context.test.ts` / interpret bind coverage.
- **Checks:** `npm test` **252** pass, `npm run typecheck` pass, `npm run build` pass.
- **Not a second context system:** no parallel store; pets registry work from an earlier ask was left alone for this audit (pets tests remain in the suite).

### 2026-11-16: Desktop launcher
- **Added:** `~/Desktop/MIKO.app` (outside the repo, not committed), with an orange paw icon. Clicking it runs `npm start` in PET_BOT. If MIKO is already running, a click does nothing.
- **How it works:** the app is a plain shell-script bundle (`Contents/MacOS/MIKO`, `#!/bin/zsh -l` so the Homebrew node/npm path is available). It `exec`s `npm start` and stays alive as MIKO's parent, because macOS ends a launched app's leftover background processes when the app exits.
- **Log:** `~/Library/Logs/MIKO-launch.log`.
- **If the launcher is moved or rebuilt:** run `xattr -cr` and `codesign --force -s -` on it, then `lsregister -f` it. A stale LaunchServices registration made it silently do nothing.
- **Verified:** with MIKO quit, a click started it (Electron and miko-keys running). A second click didn't start a duplicate.

### 2026-11-15: Mail UI simplified (inbox, message, reply)
- **Kept:** connections, search, categories and corrections, reading, thread context, read-only provider, reply drafting via MIKO's assistant, and the no-send rule. There's no backend rewrite: only shared prompt helpers, one new filter, and the hook's reply state changed.
- **Inbox:**
  - **Header:** "Mail", account selector (plain text with one account), ↻, ⚙.
  - **Search and filters:** one field "Search your mail"; **All / Unread / Important** (new filter = Action needed + Important FYI); **More ▾** for Action needed, Important FYI, Updates, Promotions (the button shows the active one).
  - **Rows:** sender, subject, preview, time, unread dot (plus an account badge only for "All accounts" with several accounts).
  - **⚙ Mail settings:** holds Accounts, Advanced search and "What counts as Important" (rules).
  - **States:** loading spinner, empty, error with Try again, and a "Results for … · Clear" line while searching.
- **Message:**
  - ← Back, subject, sender, date (account only when several), body using the available height, primary **Reply**, secondary **Open in Gmail** (provider label).
  - Copy text and category change sit in a ⋯ menu.
  - Search/filters are hidden.
  - Plain text uses the dark theme; HTML mail keeps a soft light page.
- **Reply:**
  - **Before a draft:** "Reply to <sender>" (▸ shows To/Subject/From), one field "What would you like to say?" (⌘↵ works), primary **Create draft**, and a collapsed "Review what's shared" (editable context).
  - **After the draft:** the dark editable draft is the main content, one field "Ask MIKO to change it…", primary **Copy reply**, secondary **Open in Gmail**, **More ▾** (Regenerate, tones), and "View instruction" collapsed (instruction, your answers, "Create a new draft from this").
  - **One route per action:** live check found 1 Copy, 1 Open in Gmail, and Regenerate only in More.
- **Clarifications:**
  - Answers are stored in `clarifications[]` and sent as their own `<answers>` block. The instruction stays exactly as written; the old "(You asked: … My answer: …)" append is gone.
  - Questions appear in one inline card ("Continue").
  - The prompt forbids inferring facts from a sender's name or brand.
  - An `UNRELATED:` reply shows "Reply to this email / Write a new message". Standalone doesn't send the email to the model.
  - No-reply / notification addresses show "may not accept replies" (`isNoReplyAddress`); copying still works.
- **Readability:**
  - Near-solid mail panel (the desktop outside MIKO stays transparent), fewer borders, consistent spacing.
  - The draft and the message body take the free height; the actions stay at the bottom.
  - **Fixed along the way:**
    - The chat input's `.panel textarea` rule pinned the draft at 120 px.
    - A plain-text body overflowed the panel by 28 px (content-box).
    - An old notice followed you into the message view.
- **Checks:** typecheck pass, **242** tests pass (+5 reply prompt and no-reply tests, Important filter), build pass.

#### Live (preview mailbox, real drafts from MIKO's assistant; no mail sent)
| Check | Result |
|---|---|
| Inbox layout | Header, "Search your mail", All/Unread/Important + More (4 items); Advanced, Rules and accounts not in the inbox; settings has the 3 sections |
| Search → open → back | "invoice" → 4 rows → open → Back: query and results unchanged; 20-row list Back restored scrollTop 300 |
| Message view | Search/filters hidden; actions = Reply, Open in Gmail; Open in Gmail targeted `…/u/preview%40example.com/#all/18f0001003` for message (2) (openExternal intercepted, no browser) |
| Read → Reply → draft | Heading "Reply to Imran Khan", Create draft disabled when empty, draft in 6 s, dark editor (rgb 20,18,17), instruction collapsed |
| Edit then refine | Manual "P.S. Thanks again…" kept after "add that I'll send the signed form tomorrow" |
| More | Regenerate + Shorter / More polite / More formal / Friendlier; Shorter applied |
| Copy | Clipboard equals the draft (owner's clipboard restored after) |
| Close/reopen panel | Draft kept |
| Stop / Cancel | "Drafting stopped." with the draft kept; Cancel → "Reply cancelled. Nothing was sent." |
| Clarification | "What time on Tuesday works for you?" → "Tuesday 1 pm" → draft; instruction still "suggest a time that works for me"; no "You asked / My answer" leak |
| Unrelated note | "remind me to buy milk…" → card → Write a new message → "New message" draft |
| No-reply sender | Note shown for notifications-noreply@ |
| Sizes | Draft 125 / 225 / 405 px at Small / Medium / Large, Copy visible, 9 px below, no inner scroll; before a draft the note field fills (Large 453 px), 9 px below |

- **Not covered live:** a real Gmail failure; the error/Try again path is the same code as before. The voice dictation route into the new fields is unchanged in the hook.

### 2026-11-15: Pet customization (Doberman, cat, bird with tree, koala)
- **Picked up from Cursor:** Cursor's uncommitted work (WhatsApp, browser tabs, Chrome profiles, actions/interpreter, preferences, about 7,000 lines) was preserved untouched.
  - There was no partial pet code in `src/`.
  - A stray arm64 executable `main` sits in the repo root (probably a Swift compile output). Left as is and not committed.
  - **Editor "6 problems":** `npm run typecheck` was clean before and after, so those diagnostics are stale.
- **Assets inspected** (the GLB JSON, not just the README):
  - doberman: Idle/Walk/Sit/SitIdle/StandUp
  - cat: + LickPaw, Stretch (has a neck)
  - koala: + Wave, Sleep (no neck bone)
  - bird: Idle/Walk/Hop/Fly/TakeOff/Land/Peck/Chirp (no sit clips, no neck), plus a `Tree` node with a `PerchPoint`
  - All of them: one skinned mesh, faces +Z, feet at y = 0, in-place locomotion.
- **Registry: `src/shared/pets.ts`** (pure, tested against the real .glb files in `pets.test.ts`). Per pet:
  - role → clip lists with fallbacks; a missing clip falls back to the next entry, then Idle; no Idle = unusable
  - walk speed in units/s, from the asset notes
  - fit: the Doberman keeps its measured fit **with its original sampling, so its size is unchanged**; the others use the Doberman's reference scale, so the cat is smaller than the dog
  - look bones (neck optional)
  - "flavors": extra clips played over idle/seated phases
  - `flies` (bird)
  - aliases for commands
  - Also: tree/perch geometry, flight arc, and `parsePetCommand`.
- **Shared behavior controller reused:**
  - `stepBehavior` is unchanged except that one-shot safety limits now use the pet's real Sit/StandUp clip lengths (`oneShotSeconds`, optional).
  - Bird roles: walk = Hop, sit = Peck, sitIdle = Idle, standUp = Chirp.
- **Rig:** `DobermanRig.ts` → `PetRig.ts` (renamed with git mv). It loads any pet.
  - **Safe swap:** a new pet is parsed off-screen and swapped in only on success; on failure the current pet stays.
  - A failed saved pet at startup falls back to the bundled Doberman.
  - The canvas exposes read-only diagnostics `data-pet`, `data-clip` and `data-look`.
- **Main side** (`src/main/pets.ts`):
  - lists only pets whose `.glb` exists under `pet_animals/` (the Doberman is bundled)
  - serves model bytes
  - saved choice `pet` in miko-settings (absent = Doberman, so existing users keep the dog)
  - flight geometry
  - **the bird's tree window**: transparent, click-through, non-focusable, in the bottom-right corner of the bird's display, drawn mirrored so the branch reaches left; shown only when the bird is on screen and MIKO is visible
- **Pet behaviors:**
  - cat: licks its paw while seated, sometimes stretches when standing
  - koala: waves, naps (Sleep ×3)
  - bird: pecks and chirps; every 25–60 s of rest it takes off, flies an arc to the tree's perch, lands, stays 15–40 s, then flies down somewhere in its roam range
  - **Bird flight rules:**
    - commands, follow moves, or a pet switch bring it down
    - dragging cancels the flight; no flights with the panel open (perching continues)
    - no flights with Reduce Motion
    - with Follow active app on, the follow-placed sit counts as resting, so it still visits its tree (a command sit doesn't)
- **UI:**
  - Preferences → **Choose your pet**: cards with portraits rendered from each pet's own .glb, a check on the current pet, loading state and a status line.
  - Paw menu → **Pet** (radio list plus "Choose your pet…").
  - Typed or spoken: "switch to the cat", "make MIKO a koala", "change my pet to a bird", "be a dog again", "change pet" (opens the chooser). The router entry is added early and **only matches real pet names**, so "switch to Chrome" etc. route as before. Voice runs these directly.
- **Checks:** typecheck pass, **237** tests pass (+12 pets, +1 router), build pass.

#### Live (real app via Playwright, `MIKO_NO_HELPERS=1`)
| Check | Result |
|---|---|
| All 4 pets render | Pass. Facing the viewer, feet on the ground, relative sizes (screenshots checked) |
| Switch with the panel open and an unsent draft | Pass for cat → koala → bird → Doberman (each 20–30 ms), draft text unchanged, panel stayed open |
| Chooser | Pass. 4 cards with portraits; clicking Cat switched and said "Here's your cat." |
| Persisted choice | Pass. Relaunch came back as the cat |
| Rest transitions | Pass. Cat SitIdle → LickPaw → SitIdle; koala SitIdle → Sleep → SitIdle; bird Idle → Peck / Chirp |
| Movement ("move left", panel open) | Pass. Doberman/cat/koala StandUp → Idle → Walk → Sit, moving 128–150 px |
| App fan (single click) | Pass for every pet |
| Bird tree and flight | Pass. Tree at the bottom-right (210×249). Timeline: 22.2 s TakeOff → Fly → Land on the perch (feet exactly on the branch, composite checked) → about 38 s of Peck/Chirp → TakeOff → Fly → Land on the ground. Switching away hid the tree. |
| Missing asset (koala.glb renamed briefly, then restored) | Pass. Koala not listed; "make miko a koala" → "The koala's files aren't there, so the Doberman stays." |
| Commands | Pass. "switch to the cat", "be a dog again", "change pet" (chooser) worked; "switch to chrome" not taken as a pet |
| Cursor tracking | Partly. The look offset is applied for every pet, including the neckless koala (non-zero yaw), but the real cursor poll overrides injected pointer samples, so **turn direction on the new pets still needs a hands-on look** |
| Drag and hide/summon toggle | **Not verified here.** Playwright's synthetic mouse has no real screen coordinates, and the summon event only shows. These use the unchanged shared gesture/controller code; check by hand. |

#### Remaining limitations / handoff to Cursor
- **Hands-on still needed:** drag (guide and ⌥-drag) and ⌘⇧R hide/summon for each pet; head-turn direction toward the cursor for cat/koala/bird.
- The tree lives on the display where the bird is. In follow mode the bird walks (it doesn't fly) to the active window.
- **Not packaged:** `pet_animals/` is read from the app folder at runtime, and there is no installer yet. Add it to extraResources when packaging. Only the `.glb` files are needed at runtime (1.3 MB); the .blend and preview files are 15 MB.
- **Add a pet:**
  1. Drop `<name>/<name>.glb` into `pet_animals/`.
  2. Add a `PETS` entry (roles, flavors, walk speed, look bones, aliases) and the id to `PET_IDS`.
  3. Run `pets.test.ts`, which checks the roles and bones against the file.
- Settings key `pet` stays `doberman` after the tests. Tests leave helpers off (`MIKO_NO_HELPERS=1`) so no permission prompts appear.
- **Not committed yet (owner's call):** Cursor's uncommitted work and this feature share files (MotionApp, ipc, preload, api).

### 2026-11-15: Follow-up drafting — Also tell her framing, ambiguous times, send status
- **Preserved:** summarize/reply/refine/cancel, attachments, Chrome profiles, Preferences, browser-tab close, prior uncommitted work; did **not** open or send in Gayu Sis for testing.
- **Root cause (framing):** `Also tell her…` / `Add that…` / `Let her know…` / `Ask her…` were **not** matched by `parseWhatsAppReplyIntent` (`tellPronoun` required `^tell`). Route fell through to `unknown` → interpreter → `draft_whatsapp` with content kept “exactly as written”, so the instruction framing was inserted (or returned verbatim). Ordinary “tell her…” was never meant to be literal — only `type exactly` / `Draft:`.
- **Secondary:** `resumePendingWaDraft` used `literal: !needsModel`, so casual held open+tell content could paste without recipient-aware rewrite.
- **Fixes:**
  1. Additive / follow-up intent patterns + `additive` flag; all go through model drafting (not literal).
  2. Unsent draft: composer still holds draft → refine/merge with overwrite protection; composer empty after insert → **new** follow-up message (never edit a sent bubble).
  3. Ambiguous times (`3 AM` + `230`) → `clarify-time` UI in MIKO with choices + editable answer; original transcript retained; no silent AM↔PM / `230` expansion.
  4. Draft prompt + interpret rules: strip Also-tell / Add-that / nested “tell her to…” framing; never invent times.
  5. Insert path audited: AX `AXValue` only (comment in `ax-mac.swift`); no Return/Send. `sendStatus`: `not-sent` | `unverified` | `sent` when later observed.
  6. `commandLead` keeps trailing punctuation for `type exactly`.
- **Send-status investigation (Gayu Sis screenshot, read-only):** Outgoing bubbles are AX-labeled `Sent to Gayu Sis, Red` at 12:17 PM while MIKO still showed Inserted—not sent. Helper insert never submits; **no evidence MIKO pressed Send** — messages were sent outside the insert path (manual Send or equivalent). When composer is empty without a matching outgoing bubble proof in-session, UI can move to “Inserted as a draft; current send status unverified.”

#### Live (self-chat **Me** only; synthetic times; no Send)
| Check | Result |
|---|---|
| Routing Also tell / Add that / Let her know / Ask her / type exactly / cancel | Pass (unit + `routeCommand`) |
| Ambiguous `3 AM` + `230` clarification question | Pass — `You said 3 AM. What time should “230” mean?` |
| Insert into **Me** composer | Pass — `inserted` + `verified`; ask → `has-text` still holding `MIKO live check: movie at 7:05 PM…` (**unsent**) |
| Gayu Sis | Not used for insert/send tests |

- **Follow-up hardening:** `type Also tell her…` no longer literal-pastes framing (re-parses as additive draft). `resolveAdditiveFollowUpMode` covers unsent refine vs new follow-up vs blocked local edit. Live **Me** insert of clarified direct text `The movie starts at 7:05 PM. Please be ready by 6:35 PM.` stayed in composer (`has-text`, unsent).
- **Checks:** typecheck pass, **224** tests pass, build pass; `miko-ax` rebuilt; MIKO restarted. Author PRANAV SAIRAM only; no push.

### 2026-11-15: Recipient POV writing, contextual open, single search, draft status, Tab+Q glass
- **Preserved:** summarize/reply/refine/cancel, attachments, Chrome profiles, Preferences, browser-tab close, unsent-only inserts, existing uncommitted work.
- **Root causes:**
  1. **Draft POV:** `whatsAppDraftPrompt` asked for a polite message but did not instruct second-person rewrite for “tell her …” vs keeping a distinct third person; no `type exactly` literal path.
  2. **Contextual open:** After “Open WhatsApp”, bare `open Gayu Sis` stayed on the app catalog (`missing`) because follow-ups only matched search/find (earlier photoshop guard). Messaging was also cleared too eagerly when `lastExternalApp` was never WhatsApp (e.g. IDE frontmost).
  3. **Double search:** `openWhatsAppContact` always ran the AX helper twice (list, then list+press), retyping the query. Concurrent double-submits could also start two opens.
  4. **Draft status:** `notice` could still say “Draft inserted” while `choose-insert` (Replace/Append/Cancel) was showing.
  5. **Tab+Q:** `.glow` was a large dark radial rectangle behind the fan.
- **Fixes:** Recipient-aware drafting prompt + `type exactly` literal; `open X` with messaging → catalog apps first else WhatsApp contact; invalidate messaging only after WhatsApp→other-app switch; helper `reuseSearch` for press without retype + taskId coalesce; statuses Preparing / Draft ready / waiting Replace·Append·Cancel / Inserting / Inserted—not sent; remove `.glow`, transparent switcher root, `pointer-events` only on cards/hud/tabs.
- **Scenarios:** `src/shared/scenarios-writing.test.ts` (Gayu Sis four-step routing, POV prompt rules, known apps during WA context). Model wording checked by constraints in the prompt tests — not claimed as trained weights.

#### Live
| Check | Result |
|---|---|
| Open WhatsApp → Open Gayu Sis | Pass — chooser with **Gayu Sis** #1 (after messaging-context fix). Cancelled; did not open over her existing unsent draft. |
| Explicit contact open / one search | Helper rebuilt with `reuseSearch`; press no longer retypes when search still holds the query. |
| Draft POV insert | **Skipped live insert** — Gayu Sis already had unsent composer text (`ill take her…`); would not overwrite without approval. Prompt + routing covered by tests. |
| Draft status copy | UI strings updated; choose-insert no longer shares an “Inserted” notice. |
| Tab+Q | `.glow` removed; fan cards over WhatsApp/TextEdit with desktop/app UI visible between cards (no full-window halo). Esc dismisses. |
| Known apps in WA context | Unit: Calculator → launch, Chrome → chrome-profiles. |

- **Checks:** typecheck pass, **217** tests pass, build pass; `miko-ax` rebuilt. Author PRANAV SAIRAM only; no push.

### 2026-11-15: WhatsApp open-and-search routing (screenshot failures)
- **Preserved:** summarize/reply/refine/cancel, attachments, Chrome profiles, Preferences, browser-tab close, unsent drafts.
- **Root cause:** Compound lines like “Open WhatsApp and search for Mukundan” and “Open Mukundan in Whatsaappp” were reaching `matchOpen` / `resolveApp`. The full sentence (or typo’d app slot) became a catalog miss → “I can’t find Whatsapp And Search For ‘Mukundan.’” / “I can’t find Mukundan In Whatsaappp.” Messaging never ran.
- **Fix:** App-slot-only WhatsApp spelling normalize (`Whatsaappp` → WhatsApp); open-then-search / in-app contact matchers before the app registry; `matchOpen` refuses compound open+search; post-launch “search for …” uses messaging context; bare `open X` still uses the catalog so missing apps stay honest. No silent Mukundan alias (none stored). Interpreter still tried when a miss looks messaging-shaped.
- **Diagnostics:** Dev `[miko:route]` via `routeDiagnostics` (normalized instruction → action → capability; no chat bodies). `messagingRef` set on WhatsApp launch/search.

#### Live (panel typed path; no composer typing / no Send in WhatsApp)
| Check | Result |
|---|---|
| Open WhatsApp and search for Mukundan | Pass → chooser; **V T S MUKUNDAN** row 1 (multi-match). |
| Open Mukundan in Whatsaappp | Pass → same chooser / V T S MUKUNDAN. |
| Open WhatsApp → search for Mukundan | Pass → chooser after “Opening WhatsApp.” |
| Cancel | Pass → “WhatsApp search cancelled.” |
| open photoshop (with WA messaging set) | Pass → **I can’t find Photoshop.** |
| Voice auto | Same `routeCommand`/`planVoice` run path as typed (unit + shared entry). |

- Early live attempt hit AX `lost-focus` when WhatsApp was covered; routing had already selected WhatsApp search (not catalog miss). Retries with WhatsApp kept front completed chooser flows.
- **Editor “6 problems”:** CLI `npm run typecheck` clean after `capability: string` + launch fallthrough typing; remaining Problems UI looked stale vs current tsc.
- **Checks:** typecheck pass, **210** tests pass, build pass. Restarted project Electron so the running instance had the router. Author PRANAV SAIRAM only; no push.

### 2026-11-15: Attachment insertion verification + provenance
- **Preserved:** attachment routing, file clipboard, header checks (never bypassed), unsent attach (never Send).
- **Header blank after helper rebuild:** Accessibility stayed trusted (`AXIsProcessTrusted`). Root cause was WhatsApp’s **AXSheet** *“This file has been recently saved… save it again?”* — while open, chat header/table vanish from AX. Helper now handles that sheet (press **Save** for a new Downloads write). If System Settings ever unchecks the helper after an ad-hoc rebuild, re-add `~/Library/Application Support/MIKO/bin/miko-ax` under Privacy & Security → Accessibility.
- **Provenance:** Filename/size alone no longer auto-reuse Downloads. Proven only via new AX save (`ax-new-file`), session-proven id, or explicit owner-accepted **candidate**.

#### Live (chat **V T S MUKUNDAN**)
| Step | Result |
|---|---|
| **Retrieval** | Pass — new `~/Downloads/FreshNet_NNDL_Case_Study_Report (1).pdf` (664982 B), `saved` + `verified`, `provenance=ax-new-file`. |
| **Copy** | Pass — clipboard `public.file-url` / `NSFilenamesPboardType` (not path text). |
| **Attach** | Pass — `attached` + preview verified, composer text preserved, **unsent**. |
| **Switch / cancel** | Pass — wrong header → `switched` / not verified; cancel blocks late attach; completed files kept. |

- **Checks:** typecheck pass, **209** tests pass, build pass. No send; no push; no model upload of the PDF.

### 2026-11-15: WhatsApp attachment retrieval + file transfer
- **Preserved:** summarize/reply/refine/cancel, chat-switch insert guard, Chrome profile fan, Preferences, browser-tab close, unsent drafts.
- **Routing:** “Fetch the latest file”, “Download that PDF”, “Get the last document they sent”, “Copy this file”, “Save it to Downloads”, “Show it in Finder”, “Attach it here”, “Paste that file into this chat” → `whatsapp-attachment` **before** general assistant. Typed + spoken share the same intents/`planVoice` run path.
- **Discovery (AX only):** `whatsapp-attachments` lists visible `Document, …` bubbles (filename, kind, detail, time, incoming vs `Your Document`). Photos/links/previews skipped. Scope labelled **Latest visible attachment (visible messages only — not full chat history)**. Never reads WA databases/credentials.
- **Download:** `AXShowMenu` → **Save to Downloads**; polls Downloads for a nonempty stable file (including `Name (n).ext`). Click alone ≠ success. Duplicate names never overwritten silently. *(Silent filename reuse removed in the verification session above.)*
- **File card:** `wa-file` entry — filename/type/size/chat/status + Open / Show in Finder / Copy file / Copy filename / Copy path / Attach it here / Attach elsewhere…. Retrieved path kept in `WorkingContext.retrievedFile`. Download does **not** upload contents to the assistant.
- **Clipboard:** `clipboard-file` writes a real `public.file-url` / `NSFilenamesPboardType` reference (not path text). Verified live.
- **Attach:** `paste-file` ⌘V into verified WhatsApp composer; header rechecked before and after; preview verified; **never Send**; composer text preserved when possible. Destination chooser when unclear / switched; unsupported apps → Copy file / Show in Finder. Cancel bumps `attachmentToken` and blocks late attach; completed Downloads files are kept.
- **Live (initial):** listed `FreshNet_NNDL_Case_Study_Report.pdf` in **V T S MUKUNDAN**; clipboard verified. Full retrieve→copy→attach completion recorded in the verification session above.
- **Checks:** typecheck pass, tests pass, build pass. Author PRANAV SAIRAM only; no AI trailers; no push.
- **Limits:** macOS only; visible bubbles only; attach preview detection is best-effort via AX; Windows unsupported; helper rebuild can require re-adding Accessibility.

### 2026-11-15: Chrome profile chooser
- **Preserved:** WhatsApp summarize/reply/refine/cancel + chat-switch guard; assistant/voice/mail; browser-tab close (still host-only — **no** profile ownership claimed); pending URL / unsent-draft behavior.
- **Discovery (main only):** Reads Chrome `Local State` `profile.info_cache` + on-disk avatar image files under the profile directory. No passwords/cookies/history/tokens. Display name ≠ directory id. Paths validated; Chrome files never modified.
- **UI:** Glass profile fan above MIKO (`ChromeProfileFan`) — avatar or initials, number shortcut, hover/selected, Default badge, fan or scrollable grid (≥6). Reduce Motion + reduced-transparency opaque fallback. `data-hit` so clicks work with click-through.
- **Commands:** `open Chrome`, `choose chrome profile` (always shows fan), `open Chrome with Work`, `open YouTube in Chrome` (URL held through choice), `… in my Personal Chrome profile`, spoken ordinals / `use Work`, cancel / leave it / Esc. Explicit profile overrides saved default. Pending URL completed exactly once on selection.
- **Default:** Never auto-saved. Optional “Always use …” on the fan → `defaultChromeProfileDirectory` in structured prefs. Preferences: see / clear / reopen chooser.
- **Launch:** `open -na "Google Chrome" --args --profile-directory=<id> [url]` (arg array, no shell). Existing other-profile windows left open. Safe http(s) only. Launch success ≠ verified frontmost profile (tab APIs can’t attribute profile); note shown honestly.
- **Live on this Mac:** Discovered **9** real profiles (duplicate `srmist.edu.in` → secondary directory labels). Launched Work + disposable `example.com/?miko-chrome-profile-check=1`: windows 1→2→1 after cleanup; prior window intact. Cancel path: dismisses fan without launch (code + Esc).
- **Checks:** typecheck pass, **201** tests pass, build pass. Author PRANAV SAIRAM only; no AI trailers; no push.
- **Still limited:** Windows Chrome profile launch implemented but **not** live-tested. Tab close still cannot tell which profile owns a tab. Frontmost profile after launch is not verified beyond the launch command returning.

### 2026-11-15: Unfamiliar 3/10 investigation + interpretation improvements
- **Preserved:** Me 2 summarize/reply/refine/cancel; chat-switch insert guard; Preferences; browser-tab close; destination exactness; unsent drafts (`don't send` negation + insert never sends).
- **Eval path for the old 3/10:** Deterministic-only (`tryDeterministicPlan` + `routeCommand`). **No mocked interpreter. No real model.** The prior “3/10” was not model accuracy.

#### Original holdout-unfamiliar v1 — expected vs actual (pre-fix, deterministic)
| id | expected | actual (deterministic) | class |
|---|---|---|---|
| uf-boot-up-yt | open_website | unknown | wrong_intent → needs_interpret |
| uf-kill-yt-tabs | close_website | unknown | wrong_intent → needs_interpret |
| uf-msg-dad-visit | open+draft WA | unknown | wrong_intent → needs_interpret |
| uf-whats-the-scoop | summarize_whatsapp | ask_assistant | wrong_intent (question steal / lost_context) |
| uf-tighten-draft | refine_draft | ask_assistant / unknown | wrong_intent (lost_context) |
| uf-scratch-that | cancel_task | cancel_task | ok |
| uf-find-invoice | search_mail | unknown / mail-or-app | wrong_intent → needs_interpret |
| uf-browser-instead | open_website | unknown | lost_context → needs_interpret |
| uf-thanks-check | draft_whatsapp | draft_whatsapp | ok |
| uf-ordinary-q | ask_assistant | ask_assistant | ok |

#### Held-out v2 (frozen **before** improvements; separate from v1/dev)
- File: `src/shared/eval/holdout-unfamiliar-v2.json`
- **Baseline deterministic (pre-change):** **2/10** (`uf2-tell-them-hi`, `uf2-ordinary-sky`)
- **After structural routing + interpret gate (deterministic):** **10/10**
- **Real-model accuracy:** not scored this session (paid). Do not treat fixture/schema parses as model accuracy.

#### Measured scores after changes (deterministic only)
- Development: **10/10**
- Familiar holdout: **≥3/5** (suite threshold; still reported separately)
- Unfamiliar v1: **10/10** deterministic (was 3/10)
- Unfamiliar v2: **10/10** deterministic (baseline was 2/10)
- Real-model interpret: **not run** — report via `npm run eval:live` when scoring paid calls

#### Shared interpretation flow
- Structural slang for open/close sites, cancel verbs, browser-instead follow-ups, WA summarize/refine paraphrases, dig/hunt mail searches, ping/nudge compound plans + `keep it polite/proper` tone — **not** hardcoded to the seven failed phrases.
- `shouldTryInterpreter`: unknowns and context-bound questions (WA chat/draft/pending URL) reach schema-validated AI interpret when deterministic routing cannot resolve; ordinary questions stay on the assistant.
- Typed + voice-auto both use the gate; interpret plans still run through capability-gated `runActionPlan`.

#### Checks
- typecheck pass, **196** tests pass, build pass. Author PRANAV SAIRAM only; no AI trailers; no push; no messages sent.

#### Remaining gaps
- Paid live-model scoring of unfamiliar interpret still unset.
- Windows WA + tab close still unimplemented.
- Ambiguous pronoun drafts (`tell them…` without a verified chat) still route to WA reply; insert must keep revalidating the open header.

### 2026-11-15: Remaining upgrade verify (switch/interpret/prefs/YouTube/holdout)
- **Preserved:** Me 2 live summarize/reply/refine/cancel workflow from prior session; composer restored to `Thanks, will check tomorrow.`
- **Switch during generation (panel):** Started **More formal** draft for Me 2, switched WhatsApp to **Me** while drafting. Insert refused: “You switched chats while I drafted… WhatsApp is on Me.” Me’s composer unchanged. AX expectHeader guard also returns `switched` for wrong chat.
- **Async interpreter:** Typed path already wired (`interpretUnfamiliar` → waiters → `runActionPlan` + capability gate). **Gap filled:** voice auto now uses the same deterministic/interpret path for `unknown`. Added `interpret.test.ts` (schema reject of non-allowlisted kinds).
- **Preferences UI (panel):** Structured prefs editable + saved (`Keep WhatsApp drafts short.` persisted). Correction example add/delete verified (`boot up that video site` → deleted). Alias list UI present (none saved on this Mac). Free-text prefs still available.
- **YouTube (panel):** `close YouTube` → “I found 2 tabs for youtube.com. Which one?” with Chrome tab choices. `close all YouTube tabs` closed all YT; example.com remained (2).
- **Eval (deterministic, reported separately):**
  - Development: **10/10**
  - Familiar holdout: **4/5**
  - Held-out unfamiliar: **3/10** (7 need AI interpret; not claimed as accuracy)
- **Checks:** typecheck pass, **188** tests pass, build pass. Author PRANAV SAIRAM only; no AI trailers; no push.
- **Still limited:** Windows WA + tab close; paid live-model scoring of unfamiliar interpret; alias delete not exercised live (no aliases saved).

### 2026-11-14: Panel UI live verify (after Screen Recording for Cursor Computer Use)
- **Permission note:** Toggle must be on for **Cursor Computer Use** (`~/.cursor/computer-use-sidecar/Cursor Computer Use.app`), not only Cursor. Allow the macOS “bypass private window picker” prompt as well.
- **Panel drive on Me 2 (nothing sent):**
  - Opened Me 2 via panel chooser → “Opened Me 2… message box is ready.”
  - **Summarize:** summary appeared in MIKO (“They shared an L&T recruitment platform link, followed by an unfinished story…”, Answered in 8.2 s). WhatsApp composer unchanged (`Thanks — I'll check tomorrow.`).
  - **Reply saying thanks…:** draft `Thanks, I'll check tomorrow.` → Replace insert → verified in composer, unsent (“Draft inserted… Nothing was sent.”).
  - **Shorter:** panel Shorter → refined `Thanks, will check tomorrow.` → Replace insert verified.
  - **Cancel:** during “Drafting…” after `make it shorter`, typed `leave it` → “Okay. Cancelled.” Composer stayed at the prior inserted shorter draft (no late overwrite).
- Switch-chat wrong-insert guard remains from earlier AX verify (`switched` when expectHeader≠open chat).

### 2026-11-14: Finish upgrade — interpret async, prefs UI, live WA/browser, holdout-unfamiliar
- **Interpreter → execution:** Unknown wording runs `tryDeterministicPlan`, else schema-validated `interpretUnfamiliar` (bridge waiter map + `interpretToken`). Valid plans go through `runActionPlan`, which gates each step on `capability()` / `availableKinds` before open/draft/summarize/close/etc. Cancel bumps interpret + WA tokens, resolves waiters with null, cancels bridge/WhatsApp/paste. Target revalidated via peek before draft/insert.
- **Routing fix:** With a verified WhatsApp chat, `reply saying …` is `whatsapp-reply` (was stolen by Mail).
- **Preferences UI:** Preferences view edits structured prefs (browser/tone/language/notes), lists/deletes WhatsApp aliases, and view/add/delete approved correction examples (local only; not training).
- **Eval (deterministic, separate reports):**
  - Development set: **10/10**
  - Familiar holdout (in `dataset.json`): **4/5**
  - Held-out unfamiliar (`holdout-unfamiliar.json`): **3/10** deterministic (`scratch that`, `say thanks…` with waChat, ordinary question). **7/10** miss without AI interpret (expected; not claimed as accuracy).
- **Live WhatsApp (AX helper, Me 2; no messages sent):** open + Milo context; summarize prompt/composer-unchanged; reply insert; refine insert; switch guard; cancel kill. Panel UI complete verify in session entry above.
- **Live browser close (JXA host-match = `closeWebsiteTabs` logic):** ≥2 YouTube → choices condition; close-all cleared YT; example.com stayed. Chrome not quit.
- **Still limited:** Windows WA + tab close; live model interpret on unfamiliar wording not scored (paid).
- **Checks:** typecheck pass, **183** tests pass, build pass. Author PRANAV SAIRAM only; no AI trailers; no push.

### 2026-11-14: Context-aware assistant upgrade (stages 1–5)
- **Goal:** Reliable routing + working context + capabilities so summarize/reply/open/close don’t confuse assistant history with the open app.
- **Stage 1 — summarize/reply separation:** `whatsapp-summarize` peeks the verified chat (incoming by default), runs a **fresh** bridge summarize prompt, shows the result in MIKO, and checks the composer was not changed. Bare `summarize` with `waChat` no longer resumes the Chennai/assistant thread. Selection summarize only when the owner refers to the selection (or there is no WA target).
- **Stage 2 — actions / capabilities / context / tasks:** `src/shared/actions.ts`, `capabilities.ts`, `context.ts`, `task.ts`. Explicit phases + task tokens; `leave it` cancels pending URL/draft/WA/bridge/paste work.
- **Stage 3 — interpretation:** Deterministic compound plans (`tryDeterministicPlan`) for open+tell; schema-validated `interpretPrompt`/`parseInterpretResult` for future model mapping (no shell/IPC/code). Unknown free text tries deterministic plans before the free-text chooser.
- **Stage 4 — preferences / corrections:** `structuredPreferences` + `correctionExamples` in `miko-settings.json` (local; not model weights). IPC: prefsStructured*, examples*. Retrieval helper `retrieveExamples` (bounded).
- **Stage 5 — evaluation:** `src/shared/eval/dataset.json` (dev + holdout), deterministic `eval.test.ts` (no paid calls). `npm run eval:live` documents live-model cost and a future fine-tuning path without starting training.
- **Browser close:** `closeTab` JXA + `closeWebsiteTabs` (host-boundary match). Live: closed 2 YouTube tabs in Chrome without quitting Chrome.
- **Follow-up (same day):** async interpret waiters + Preferences UI + holdout-unfamiliar + further live AX/JXA checks — see session entry above.
- **Checks (this stage):** typecheck, **180** tests, build pass. Authorship: PRANAV SAIRAM only; no AI trailers; no push.

### 2026-11-14: Command routing (YouTube / in Chrome / WhatsApp open+type / formal type)
- **Screenshot failures:** `ok open youtube` went to the assistant (“I can’t open it…”) because conversational `ok` was not stripped and sites were not a local action; follow-up `in chrome` had no pending URL state; `type tht … in a formal way` after opening Me hit the free-text “Where should it go?” chooser because `type …` was not a WhatsApp reply intent even with messaging set; open+type was never split so the message could not wait on chat verification.
- **Root cause:** Router treated sites as catalog misses / assistant follow-ups; no pending browser or held WhatsApp-draft workflow; no `type`/`tell them` path on a verified chat; cancel phrases like `leave it` were not local cancels.
- **Fixes:**
  - `commandLead` strips ok/please/can-you for matching only (original text preserved for questions).
  - `sites.ts` + `open-url` IPC: YouTube → `https://www.youtube.com/`; optional Chrome via `open -a`; pending URL so `in Chrome` completes the last site.
  - `open Me in WhatsApp and type …` → navigate with `pendingDraft`; resume after verified open (or keep holding through a chooser pick).
  - After a verified chat, `waChat` + messaging keep the reply target across MIKO focus; `type` / `tell them` / formal-way polish reuse draft+insert; chat switch updates or clears the target; “Where should it go?” only for generic unknowns.
  - `leave it` / `never mind` / `cancel that` → `cancel-workflow` (clears pending URL/draft, cancels WA generation/paste).
- **Live on this Mac:** `open`/`open -a "Google Chrome"` YouTube OK. Me was already front; search `Me` returned a chooser (Me / Me 2 / …) — pick exact Me opened header `Me`. Inserted `I will be travelling to Chennai tomorrow morning.` into Me’s composer (`verified=true`, unsent); `ask` then reported `has-text` with that exact text still present. Full UI typing through the panel was not driven here (Computer Use needs Screen Recording); routing phrases are covered by unit tests. MIKO restarted on `npm run dev` with the new main/preload handlers.
- Typecheck, **169** tests, and build pass.

### 2026-11-14: WhatsApp reply workflow debug
- **What the screenshot showed:** WhatsApp on self-chat **Me (You)** with older history visible. AX header is `Me`; conversation table is `Messages in chat with You`.
- **Root causes:**
  1. `Draft: …` was routed as an ordinary assistant **question**, so nothing was inserted into WhatsApp.
  2. `recipientMatchesOpenChat` used substring `includes`, so e.g. **Mum** could match **Sandy Mum**.
  3. `clearSearch` always opened **File → Search** even when the field was empty, leaving search/filter chrome active after contact opens.
  4. Context capture treated photos/contacts as messages and did not label older history.
- **Fixes:** literal `Draft:` / `reply here` intents; exact recipient match; clearSearch skips File→Search when empty and Escapes after a real clear; peek/insert diag (roles/state only, no bodies); skip media/contact bubbles; `atLatest` + Use visible / Go to latest; recheck destination before context and insert; report inserted only when `verified`.
- **Live on this Mac:** reopened Me → peek `atLatest=false`, 1 text bubble (media/contacts skipped) → inserted `The MIKO project is nearly complete.` verified in composer only → removed that exact draft → `has-text` / wrong-header `switched` checked. “Tell them…” still needs the owner to pick a contact in the UI (assistant wording not re-run here). Windows still unsupported.
- Typecheck, 159 tests, and build pass.

### 2026-11-14: WhatsApp reply drafting + composer insert
- **Intent** (`whatsapp-reply.ts`, `commands.ts`): tell/reply/write-to-this and refine (“make that shorter”) route to a dedicated WhatsApp reply workflow before ordinary assistant answers when WhatsApp is the target or a draft is active. `Draft: …` inserts that exact text into the open chat (no model).
- **Capture:** `whatsapp-peek` reads `NavigationBar_HeaderViewButton` and text `WAMessageBubbleTableViewCell` rows inside `ChatMessagesTableView` only. Panel shows “Replying to \<chat name\>”. Named recipients that don’t match the open chat reuse contact open + header verify. First use of visible context explains that the text goes to MIKO’s model (`whatsappContextNoticeSeen`).
- **Draft:** one-off `bridgeSend` with `whatsAppDraftPrompt` — preserve meaning, no invented commitments. Context is quoted data only.
- **Insert:** `whatsapp-insert` rechecks the header, requires focus on `ChatBar_ComposerTextView`, offers Replace/Append/Cancel if the composer has text, verifies AXValue, never sends. Chat switch mid-flight holds the draft and asks. Cancel / new request invalidates pending insert (`waReplyToken` / helper generation). Refine replaces the inserted text only when it still matches; manual edits ask first.
- **Windows:** unsupported.

### 2026-11-14: WhatsApp chooser disambiguation
- Multiple WhatsApp matches open a panel chooser headed **“Which chat did you mean?”** (`TextPanel` `WhatsAppChooser`): numbered clickable rows, exact names first, last-message preview as a secondary line. Contact/group type is omitted unless WhatsApp exposes it clearly (it does not today).
- Keyboard ↑↓ + Enter, Escape/Cancel, and Refine search (puts the original query back in the draft). Voice/typed “the second one”, “2”, “number 3”, “last” resolve against the active chooser via `parseChooserIndex`.
- Result identity is name + last-message snippet (`matchId`), not row position. On pick, MIKO refocuses WhatsApp, re-searches, and opens only when that identity is still unique. If the list changed, the chooser refreshes. If several rows look the same, MIKO asks you to pick in WhatsApp.
- A new contact search cancels the older chooser and ignores late results (`whatsAppToken` / main `generation`). The panel staying focused during the chooser is intentional; automation only runs while WhatsApp is frontmost.
- **Live:** “open Mum in WhatsApp” returned 11 results with Mum first; opening that exact row verified header “Mum”, cleared search, and focused the composer. Numbered-choice and cancel paths are covered by unit tests; a fresh mic recording was not made.
- Typecheck, 155 tests, and build pass.

### 2026-11-14: WhatsApp contact navigation
- **Routing** (`src/shared/commands.ts`), before saved chats and app lookup: "open Mum in WhatsApp", "open WhatsApp chat with Mum", and "find Mukundan on WhatsApp" are a WhatsApp contact. "open WhatsApp" still launches the app. "open my FreshNet chat" still opens that saved ChatGPT chat.
- A bare "open Muku chat" opens an exact saved chat when one exists. Otherwise it uses WhatsApp only after you have chosen WhatsApp for a bare chat. If neither applies, MIKO asks "WhatsApp or a saved ChatGPT chat?"
- **macOS search** (`resources/ax-mac.swift`, `src/main/whatsapp.ts`): focus WhatsApp, type into `TokenizedSearchBar_TextView` only while that field is focused, then use File → Search so the filtered rows (`ChatListSearchView_ChatResult`) appear. The ordinary chat list stays in the tree and is not treated as results. A unique exact row is opened and the header button `NavigationBar_HeaderViewButton` has to match before MIKO says it opened. Several matches open the chooser above. No readable results leaves the name in the search field and says to pick there. Focus leaving WhatsApp during automation stops further input. The message box is never written; search is cleared with select-all and delete only while the search field is focused. The composer is then focused.
- **Aliases:** after you pick a result whose name differs from what you said, MIKO can remember it for WhatsApp. "show WhatsApp aliases" and "forget WhatsApp alias …" manage them. Using an alias searches the saved name and opens only if that name is still in the results.
- **Windows:** contact search returns "isn't available yet" and does not type.
- **Live on this Mac:** a name that isn't a contact reported no match. "Mum" returned several results, including one exact Mum. Choosing that exact row opened the chat, the header read "Mum", search was cleared, and the composer took focus.
- **Still limited:** Windows is untested. If WhatsApp changes those Accessibility identifiers, search falls back to leaving the query in the field. Accessibility permission is required.

### 2026-11-14 (late): miko-keys permissions fixed (owner confirmed)
- **Debugging:** I ran the helper on its own via `open --stdout`. It printed `{"error":"permission"}` twice: Input Monitoring (`IOHIDManagerOpen`) and Accessibility (event tap).
  - The signature was valid (cdhash `0753171…`).
  - System Settings, read-only via System Events, showed:
    - Accessibility: miko-keys **ON**, but tied to the pre-15:15 build.
    - Input Monitoring: miko-keys **missing entirely**; it wasn't re-added after the old entry was removed.
- **Fix (owner, in System Settings):**
  - Added `~/Library/Application Support/MIKO/miko-keys.app` to Input Monitoring by hand. That left one error.
  - Removed miko-keys from Accessibility and re-added it by hand. That left zero errors.
- **Result:** the owner confirmed Caps Lock + A and Tab + Q both work.
- **For next time:** if a helper is rebuilt, remove its old entries with − and re-add the `.app` by hand in each list it needs. A switch that shows on can belong to an old build.
  - miko-keys needs Accessibility + Input Monitoring.
  - miko-listen needs Microphone + Speech Recognition.
  - The content-hash rebuild check (80e0b77) keeps this from happening without a real code change.

### 2026-11-14 (late): miko-keys kept asking for Accessibility
- **Owner report:** "even tho i kinda turn it on it keeps showing the access thing".
- **Cause:**
  - The Swift helpers are ad-hoc signed, so their designated requirement is the build's cdhash, and macOS ties each grant to that exact build.
  - `compileHelper` rebuilt whenever `resources/*.swift` had a newer **modification date**. The sources were touched at 15:15 today with no content change, so miko-keys was rebuilt (new cdhash).
  - The switch in System Settings stayed on for the old build, so it looked on, but the new build wasn't trusted and asked on every start.
  - My Playwright runs this evening also started MIKO, and with it the helper, each time, so the prompt kept reappearing.
- **Fix:**
  - Helpers rebuild only when the source **content** changes. A SHA-256 stamp is kept in `userData/<name>.build`. Existing builds that are newer than their source are kept and stamped, so the current build and its fingerprint stay as they are (verified after a restart: cdhash `0753171…` unchanged).
  - `MIKO_NO_HELPERS=1` (unpackaged only) skips the helpers in automated runs, so tests no longer trigger permission prompts.
  - The in-app note now explains a stale switch: remove miko-keys with −, reopen MIKO, allow again.
- **Owner action still needed once:** in System Settings → Privacy & Security → **Accessibility** and **Input Monitoring**, select **miko-keys** → **−**, then reopen MIKO and allow when asked.
- **Not done:** a stable code-signing identity, such as a local self-signed certificate, would let grants survive real source changes too. It wasn't set up because it changes the Keychain, so it needs the owner's go-ahead.
- typecheck passes, 144/144 tests pass, build passes.

### 2026-11-14 (late): Resizable Chat and Mail panels; Gmail connected
- **Gmail connected:** the owner's screenshot shows pranavsairamanc@gmail.com in the Mail tab and a search for "interview" returning real results. **Paste fix confirmed** (the Client ID and secret went in).
  - The same screenshot showed macOS asking for Accessibility for "miko-keys" again. The owner should allow it in System Settings → Privacy & Security → Accessibility.
- **New: panel size options** (owner request):
  - **⤢ in the panel header:**
    - Small / Medium / Large / Default
    - Chat: 272×220, 400×340, 560×500
    - Mail: 540×420, 700×520, 960×700
  - **Drag corner:** on the outer bottom corner, away from the dog.
    - Width follows the pointer.
    - The panel stays vertically centred on the dog, so the height grows by twice the vertical move.
    - Saved when you let go.
  - **Each tab keeps its own size** (`panelSizes` in settings). Default removes it: Chat then uses 272×220 and Mail fits beside the dog as before.
  - **Limits:** Chat 240×200 to 1000×1000, Mail 360×300 to 1600×1200, always within the screen. The window clamp moves the dog when a big panel needs the room.
  - **Code:**
    - `fitPanel` / `parsePanelSize` / `PANEL_PRESETS` in `src/shared/layout.ts`
    - `resizePanel` / `setPanelPreset` in `pet-window.ts`
    - IPC `panelResize`, `panelPreset`
- **Verification:** typecheck passes, 144/144 tests pass (new: chosen sizes, limits, screen fit, defensive parsing), build passes.
  - **Real app (Playwright):**
    - Presets measured exactly; Mail kept its own size and Chat kept Large after switching tabs.
    - A drag of 120 px out and 30 px down gave +120 × +60, and was saved and still there after restarting.
    - Default cleared the saved size.
  - **Note:** Playwright's own mouse moves with the window, so its drag ran away to the maximum. The drag was re-checked with fixed screen coordinates. **Not yet tried with a real mouse.**

### 2026-11-14 (late): Paste works in MIKO's text boxes
- **Owner report:** couldn't paste the Client ID and secret into Connect Gmail.
- **Cause:** MIKO's macOS menu had no Edit menu, and macOS routes ⌘C/⌘V/⌘X/⌘A/⌘Z to text fields only through one. This affected every MIKO text box.
- **Fix:** added the standard Edit menu (`role: 'editMenu'`) to the normal and preview menus in `src/main/index.ts`.
- typecheck and build pass. MIKO was restarted with the fix. **The owner's live paste test is pending.**

### 2026-11-14 (late): Mail reader and reply-writing assistant
**What it does now (Mail tab)**
- **Tabs:** All mail, Unread, Action needed, Important FYI, Updates, Promotions.
  - All mail and Unread show every category.
  - Updates and Promotions also narrow the Gmail query (`category:updates` / `category:promotions`).
  - Action needed and Important FYI are filtered locally after fetching.
  - Each page is 10 newest-first; "Load next 10" follows Gmail page tokens; ↻ refreshes.
- **Categories:** transparent rules, no model (`categorize` in `src/shared/mail.ts`). Order:
  1. The owner's corrections, per message or per sender.
  2. Gmail Promotions → Promotions. Gmail Social/Forums → Updates (marked uncertain).
  3. Gmail Updates → Updates, unless it is a direct request or payment to you. Then it's Action needed, marked uncertain.
  4. Direct request, deadline, approval or payment cues → Action needed. It's certain with two or more cues or Gmail's important flag; otherwise "Maybe".
  5. Gmail's important flag with no cue, or the owner's keyword → Important FYI.
  6. Anything else → "Maybe: Other", which stays in All mail.
- **Labels and corrections:**
  - Every row shows its category chip and the account. The reason shows on category tabs and for any uncertain row; uncertain chips are dashed and say "Maybe".
  - Clicking a chip opens Correct the category: pick one, optionally tick "Everything from <sender>", or Undo my correction.
  - Corrections are stored as `mailCorrections` in settings (validated, capped at 1000 messages / 300 senders).
- **Search:**
  - The box takes words, `from:`, `subject:`, `after:`.
  - **Advanced** has Words / From / Subject / After / Before fields → `buildQuery`.
  - Text that starts like a command ("reply …", "open …", "cancel …") no longer live-searches while you type. Before, "reply to the second email" could replace the results it referred to.
  - Back keeps the query and scroll position.
- **Message view:**
  - readable body plus "Thread: N other messages"; threads.get is read-only, at most 12 messages
  - Reply / Copy / Open original
  - unread state preserved (messages.get and threads.get never change labels; the scope is read-only)
- **Reply mode:**
  - **Binding:** Reply binds to the account, message key and thread.
  - **Header:** shows To, using Reply-To when set, otherwise the sender, otherwise the first recipient for your own sent mail. Also shows Subject `Re: …` and the original email.
  - **Instruction box:** typed, or dictated with Caps Lock + A. While a reply is open in the Mail tab, dictation fills the reply box, except mail commands like "cancel reply".
  - **Before the first draft:** a blue notice explains that the email text and the instruction go to MIKO's assistant (ChatGPT via the Codex CLI). The exact context (headers, body without quoted history, the last 2 thread messages, local dates) is shown in an editable box with Reset context. Nothing is sent until **Send to MIKO and draft**.
  - **Prompt** (`draftPrompt` in `src/shared/mail-reply.ts`):
    - the email is fenced as untrusted data, and closing tags inside it are neutralised
    - your instruction is separate
    - rules: keep names, dates, times, amounts and commitments, and add none
    - if an essential detail is missing, answer with `QUESTION: …`
  - **Questions:** an empty instruction is asked about locally, before anything is sent. A question from the model shows with an answer box ("Answer and draft").
  - **Draft:** editable, with Copy reply, Regenerate, Open original, the Shorter / More polite / More formal / Friendlier chips and a free-text change box. Follow-ups send the current (edited) draft plus the change.
  - **Isolation:** drafts are one-off assistant requests (`fresh`). They never become or change the main MIKO conversation; the renderer also ignores bridge events that have no chat card.
  - **Sending stays with the owner:** MIKO never sends. The steps are Copy reply → Open original → Reply in Gmail → paste → Send.
  - **Cancel reply** (button or "cancel reply" / "discard the draft") stops any draft in progress and clears the target. Back to results keeps the reply bound, with a "Replying to …" banner offering Resume reply / Cancel reply.
- **Commands:**
  - "reply to the second email", "reply to email 3 saying …", "reply to the last mail", "draft a reply to the first email", "reply to this email" / "reply" (the open message) all resolve against the rows currently on screen.
  - They open the selected email and show it before any drafting.
  - "show action needed", "important fyi emails", "show promotions" and "updates mail" switch tabs.
  - Without a mailbox connected, reply commands say to connect Gmail first.
- **OAuth setup made clear:** the Connect Gmail screen lists the 7 steps, each with a button that opens the exact Google Cloud page:
  - new project
  - Gmail API
  - Branding
  - Audience / test users
  - Data access
  - create Desktop client
  The links are a fixed list in main (`openSetupLink`). Credentials are stored encrypted with safeStorage/Keychain as before.

**Verification**
- typecheck passes, **141/141 tests** pass (new: tabs/categories/corrections/`buildQuery`/reply commands, `mail-reply.test.ts`), build passes.
- **Mocked mailbox (dev preview in the real app, Playwright), with real drafting by MIKO's assistant:**
  - **Tabs:**
    - All 10
    - Unread 10, all unread
    - Action needed 10 with reasons ("Direct request to you ('Could you') · Gmail marked it important")
    - Important FYI 2, Updates 4, Promotions 4, each only its own category
  - **Correction:** "Maybe: Other" → Action needed ("You set this") → appears in the Action needed tab → Undo restores it.
  - **Advanced search:** From Imran + Subject interview → `from:Imran subject:interview`, 1 row, matching.
  - **Reply targeting:**
    - typed "reply to the third email" slowly: results unchanged while typing, and it bound message 3, with the To going to its Reply-To (Billing Desk)
    - "reply to the second email" bound message 2 (Asha Rao, Invoice #442), with the consent box shown and nothing sent (assistant not busy)
  - **Thread:** "Thread: 1 other message"; the context includes "Earlier in this thread"; "still unread" kept.
  - **Drafting:**
    - first draft in 10 s
    - "Shorter" (10 s), then "add that I'll send it tomorrow" (20 s): the result still had 3 pm, Thursday, portfolio, signed form and tomorrow
    - the main assistant thread id was unchanged
  - **Clarifying question:** "suggest a time that works for me" on "Lunch? Free on Tuesday?" → MIKO asked "What time on Tuesday works for you?" → answer "Tuesday 1 pm" → draft.
  - **Cancel:** the "cancel reply" command and the Cancel reply button both cleared the composer; notice "Reply cancelled. Nothing was sent."; banner and badge gone. Back while replying restored scrollTop 300 of 20 rows and showed the banner; Resume reopened the composer.
  - **Normal mode, nothing configured:** the setup screen shows 7 steps with their Open buttons. The links weren't clicked in the test.
- **Bug found and fixed during the test:** the local-date formatter used `dateStyle` together with `timeZoneName`, which throws and blanked the panel.
- **Real mailbox checks: PENDING (owner action).** No Gmail account is connected because the Google Cloud client hasn't been created yet. Steps are in the Mail tab. To do once connected:
  - latest 10, next page, refresh
  - each tab against real Gmail categories
  - search by sender, subject and date
  - open a message and confirm it's still unread in Gmail
  - "reply to the second email" → correct recipient and thread
  - draft, then "shorter" / follow-up
  - cancel
- **Not tested:** dictating into the reply box by voice (wired, but speech can't be driven by the test); Copy (would overwrite the clipboard); Open original (opens the browser).

### 2026-11-15: "clear", and cleaner text for ChatGPT
- **Owner confirmed auto-paste works** (screenshot: the text landed in ChatGPT's message box automatically).
- **"clear"** ("clear chat/all/screen/everything") wipes MIKO's panel. It also cancels a pending assistant answer, an armed paste and listening. The assistant conversation itself is kept ("new conversation" resets it). Verified in the app: 4 entries → 0.
- **"type in gpt asking it to <request>"** (also "type in chatgpt to …", "write in gpt and ask it to …", "type in gpt <request>") now sends only the request. The owner's example had pasted the whole sentence; it now gives "generate me a text file of a wrd saying cat".
- **Paste reply with an empty clipboard** now explains: select ChatGPT's answer, ⌘C, then Paste reply.
- typecheck passes, 129/129 tests pass, build passes.

### 2026-11-15: Auto-paste into ChatGPT
- **Owner confirmed** the click + ⌃⌥V route lands text in ChatGPT, and asked for it to happen automatically.
- **Now** ("type … in GPT", "hi gpt", Ask in ChatGPT, or Continue for mail requests):
  - MIKO brings ChatGPT forward
  - the helper checks ChatGPT (`com.openai.codex`/`chat`) is the front app
  - waits 350 ms for ChatGPT to focus its own message box
  - pastes once with ⌘V; never sends; clipboard restored only if untouched
- **Status shown:** "Pasted into ChatGPT. MIKO can't read ChatGPT's box to double-check, so glance at it, then press Send." Plus **Paste again**, which arms the click + ⌃⌥V route if the text didn't land.
- **No focus keys are sent:** in ChatGPT's Work/Codex mode, Esc-type keys can stop a running task.
- **Turn it off:** paw menu → "Auto-paste into ChatGPT" (`chatgptAutoPaste`, default on). Off restores the armed click + ⌃⌥V flow.
- typecheck passes, 126/126 tests pass, build passes. **Live: owner to try.**

### 2026-11-15: Messages to GPT, and free text that isn't a command
- **Owner's screenshot:** "hi gpt" in MIKO produced the generic "I can walk, sit…" reply.
- **Messages addressed to GPT** now go to the ChatGPT flow (arm, click the box, ⌃⌥V):
  - "hi gpt", "hey ChatGPT, …" are typed as written
  - "gpt: …", "tell gpt to …" type the rest
  - "open ChatGPT" and "ask GPT …" keep their own meaning (tested)
- **Typed text that isn't a MIKO command** now shows **Type into ChatGPT / Ask MIKO** instead of the help line.
- typecheck passes, 126/126 tests pass, build passes. **Live: owner to try.**

### 2026-11-15: Typing into ChatGPT ("type … in GPT")
- **Owner's report:** asking MIKO to type into ChatGPT did nothing visible. MIKO only copied the text, because ChatGPT exposes no focused field to Accessibility.
- **New command:** "type <text> in GPT" / "write … into ChatGPT" / "put this in ChatGPT: …" (typed or voice; text kept exactly; tested). It goes straight to the ChatGPT flow.
- **New fallback when ChatGPT's box can't be identified:** MIKO **arms a paste for ChatGPT**.
  - The card says: click ChatGPT's message box, then press **⌃⌥V**.
  - On ⌃⌥V the helper checks that ChatGPT (`com.openai.codex`/`chat`) is the frontmost app, then pastes once with ⌘V. The clipboard is restored only if it still holds MIKO's text.
  - It reports honestly: "Pasted into ChatGPT where you clicked. ChatGPT doesn't let MIKO read its fields, so check it there." Nothing is sent. Esc, 30 s expiry, Cancel, and closing the panel disarm it.
- **Rule refinement** (`miko-ax paste --allow-unexposed`): during an armed paste you confirm, an app that exposes **no** focused field (ChatGPT, Chrome pages) can be pasted into, labelled unchecked. Where Accessibility **does** report a non-text focus (e.g. Finder), paste is still refused. This also makes "Paste where I click" work in Chrome.
- typecheck passes, 125/125 tests pass, build passes. **Live test with ChatGPT: pending.**

### 2026-11-15: MIKO always present
- **Owner's report:** MIKO wasn't visible over ChatGPT (screenshot). Causes found:
  - MIKO started **hidden** (Phase 1 design: ⌘⇧R to summon)
  - its window wasn't set to join other Spaces or full-screen apps
- **Change:**
  - the pet window calls `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, staying always-on-top at the floating level
  - MIKO now shows itself on startup
  - ⌘⇧R and the paw menu still hide and show it
- **Verified live** (window list by MIKO's pid, since titles need Screen Recording):
  - on screen right after `npm start` (bottom-right, layer 3)
  - still on screen with ChatGPT in front (ChatGPT was windowed, not full screen), and after switching back
- **Owner-verified 2026-11-15:** MIKO stays visible over ChatGPT in full screen. (Automation couldn't put TextEdit into full screen, so this check was manual.)

### 2026-11-15: Milestone 3 live verification (owner idle; Excel no longer interfering)
- **Fixed in `miko-ax`:** `NSWorkspace.frontmostApplication` doesn't refresh inside a short-lived helper (no run loop). The helper now checks the target's live Accessibility `AXFrontmost`, spins a run loop while waiting, and reads the focused field from that exact pid after activating it.
- Tests now abort if the expected app isn't frontmost before any key press.
- **Live results** (MIKO launched via Playwright; real ⌃⌥S / ⌃⌥V presses through System Events)

| Check | Result |
|---|---|
| A. TextEdit: Fix grammar, then click MIKO, then **Replace selection** | MIKO in front before Replace; TextEdit re-activated; text became "I had an apple, and they were happy at the park yesterday." (exact match); MIKO said "…and checked it" |
| B. Selection changed before Replace | Refused: "The selection changed. Select the text again."; text untouched |
| C. Document closed before Replace | Refused: "The focus moved to a different field. Choose the target again." |
| D. Script Editor (second app): Draft reply "Reply saying I'll send it tomorrow." | Instruction shown separately; reply "I'll send it tomorrow." |
| D. Paste where I click with Finder in front | Refused: "…isn't an editable text field" |
| D. Esc while armed | "Paste cancelled." |
| D. ⌃⌥V in the empty Script Editor document | "Pasted into Script Editor and checked"; content matched; the copy made while armed was kept |
| D. Second ⌃⌥V | MIKO did not paste again; the key reached Script Editor as its own ⌃V character |

- **Not exercised live:**
  - a reply clarification question (the model drafted directly)
  - the 30 s expiry (code path only)
  - Chrome as a target (web fields not exposed; see the earlier entry)
- typecheck passes, 123/123 tests pass, build passes.

### 2026-11-15: Milestone 3, selected-text assistant (built; live verification incomplete)
**Controls**
- Select text in any app and press **⌃⌥S**. You can change it in Chat tab → ⚙ → "Set selection shortcut"; it's checked and kept only if it registers.
- MIKO captures **before** showing itself, then shows a **Selected text** card: source app, how it was captured, and the quoted text.
- **Actions:**
  - Fix grammar, Summarize, Explain
  - Rewrite (with a tone)
  - Draft reply (with an instruction, e.g. "Reply saying I'll send it tomorrow.")
  - Start conversation (with an optional question)
- Voice or typed while a selection is active: "fix grammar", "summarize this", "explain it", "rewrite this in a friendly tone", "make it more formal", "reply saying …".
- If capture fails: **Use clipboard text**.

**Results**
- The card shows **your instruction** and the **output** separately.
- **Copy.**
- **Replace selection:** re-verifies the same app, the same field signature and the same selection hash, then replaces via Accessibility (read back) or a ⌘V with conditional clipboard restore.
- **Paste where I click:**
  - An armed banner says "Armed for 30 s: click into the field you want, then press ⌃⌥V to paste once. Esc cancels."
  - It pastes only into a verified editable, non-password field of a non-MIKO app, exactly once.
  - It disarms on success, failure, Esc, a 30 s timeout, a new generation, a new capture, or closing the panel. Sending stays with you.
- **Replies may ask one short question** ("QUESTION:") when an essential detail is missing; an Answer box re-runs with your answer.
- **Selected text is quoted data:** it sits between `<selected_text>` tags with break-out neutralised, and the model is told not to follow instructions inside it.
- Selection actions are **one-off** assistant runs (they don't change your current conversation), except "Start conversation".

**Permissions:** Accessibility for the app that launches MIKO (`miko-ax` runs as its child). Password fields are never read or written.

**Verified**
- **Helper, directly in a TextEdit scratch document:**
  - capture
  - verified replace
  - changed selection refused
  - ⌘V paste verified, clipboard restored
  - new copy kept when the clipboard changed mid-operation
  - password dialog refused
- **In MIKO:**
  - ⌃⌥S shows the Selected-text card ("Selected in TextEdit · read via Accessibility")
  - Fix grammar returned "I had an apple, and they were happy at the park yesterday."
  - reply drafting returned "I'll send it tomorrow." with the instruction shown separately
  - armed paste: the banner appears; ⌃⌥V with Finder in front was refused ("isn't an editable text field"); Esc cancelled
  - pasting once: a second ⌃⌥V did nothing
- typecheck passes, 123/123 tests pass, build passes.

**Found and fixed:** when MIKO itself is in front (after you click its button), `NSRunningApplication.activate()` from the helper was ignored, so Replace said "The original app isn't available any more". The helper now uses Accessibility `AXFrontmost` on the exact pid first. **Re-test pending.**

**Problems in the last live run**
- The owner was using the Mac during the automated run. Excel became frontmost, so one capture read a single Excel cell ("campus") and sent it to the assistant as a test. Nothing was typed into Excel and the clipboard was restored.
- **Live UI tests must run only when the owner isn't using the keyboard or mouse.**

**Pending live checks** (need an idle Mac)
- Replace selection after clicking MIKO (activation fix)
- changed-selection and closed-document refusals through MIKO
- a second app

**Known limitation: Google Chrome web text fields aren't exposed to Accessibility by default.** Capture there falls back to ⌘C; paste into Chrome is refused because the field can't be verified. Enabling Chrome's accessibility tree (e.g. via `AXEnhancedUserInterface`) is a possible follow-up.

### 2026-11-15: Milestone 2, MIKO mailbox
**Provider:** Gmail, through the existing official OAuth provider (`gmail.readonly`, PKCE loopback). Tokens and client secret are encrypted with safeStorage/Keychain in userData. Nothing is stored in Git. The setup form is in the Mail tab; steps are under "Gmail setup" below.

**Added this milestone**
- **Searches by sender, subject and date**, typed or spoken (`parseMailCommand`, tested):
  - "mail with subject quarterly report" → `subject:"quarterly report"`
  - "emails from Imran last week" → `from:Imran newer_than:7d`
  - "mail about interview today", "search mail invoice this month"
  - "search mail receipts before 2026-01-31" → `before:2026/01/31`; "… after 2026/03/01"
  - "mail from yesterday"
  - The search box hint shows `from:`, `subject:` and `after:`; Gmail operators typed there pass straight through to Gmail.
- **Partial results:** when one account fails and others load, rows stay visible under a "Partial results. …" banner. With no rows, the error stands alone.
- **Email content is untrusted data:** HTML is sanitised and shown in a sandboxed, CSP-locked iframe; scripts, remote images and links are blocked. "Important" is classified by Gmail's own flag plus local rules, **never by a model**, so instructions inside a message can't change classification.

**Browser-session provider: investigated, not built**
- Google has blocked Google-account sign-in from embedded browser frameworks (CEF/Electron) since 2021-01-04 ("can't differentiate a legitimate sign-in from a MITM attack"); its guidance is browser-based OAuth. A MIKO-embedded Gmail session would hit that block.
- Automating the Gmail web UI would also be fragile and is unsupported. Official OAuth stays the path.
- Outlook personal accounts could use Microsoft Graph delegated `Mail.Read` (public client, no secret), but that needs an app registration. It's only worth building if the owner uses Outlook.

**Verification**
- **Mocked** (dev preview mailbox in the real app):
  - "emails from Imran last week" → 7 rows, all from Imran, within 7 days
  - "mail with subject invoice" → 4 rows, all invoice subjects
  - "… receipt before 2026-11-12" → only earlier mail
  - Earlier mocked checks (latest 10, Load more, Unread, Important reasons, deep search, rapid search, reader sanitising, Back, "open the second email", expired sign-in) still apply.
- typecheck passes, 117/117 tests pass, build passes.
- **Real-account checks: PENDING.** No Gmail account is connected in MIKO; Google Cloud registration is waiting on the owner.
- **Known:** while no mailbox is connected, mail commands hand off to the ChatGPT app (owner's choice: "just use mail from my gpt"). The Mail tab still shows the setup form.

### 2026-11-15: Milestone 1, automatic ChatGPT prompt insertion
**Control:** on a ChatGPT card, **Ask in ChatGPT** (it was "Copy and open ChatGPT"). "Continue in ChatGPT" on mail requests uses the same path.

**How it works** (`src/main/chatgpt.ts → insertIntoChatGpt`, helper `resources/ax-mac.swift` = `miko-ax`)
1. Opens the ChatGPT app and waits until it's actually frontmost (bundle `com.openai.codex`/`chat`).
2. Asks macOS Accessibility for ChatGPT's focused field.
3. Types only if that field is an identified, editable, non-password text field.
   - If the box already has text, the card offers **Append / Replace / Cancel**.
   - Insertion goes through Accessibility and is confirmed by reading the value back; only then does the card say "Inserted… press Send".
4. Otherwise it **stops and types nothing**, copies the prompt, and explains why.

**Result on this Mac (live):**
- ChatGPT 26.924 (Electron) reports **no focused element** to Accessibility, from either the app or the system-wide element, after activation.
- So MIKO showed "ChatGPT doesn't expose its message box to macOS Accessibility, so MIKO can't tell where text would go and typed nothing. The prompt is copied: click ChatGPT's message box and press ⌘V."
- ChatGPT was frontmost and the clipboard held exactly the prompt.
- **No keyboard fallback is used,** because no step can verify the composer is focused (rule: never type into an unidentified field).

**`miko-ax` helper** (shared with Milestone 3; compiled on first use into `userData/bin/miko-ax` and run as a child, so it uses the launching app's Accessibility grant)
- Commands: `focus-info`, `capture` (Accessibility selection, else a deliberate ⌘C), `replace` (verifies app, field signature and selection hash first), `insert`, `paste`.
- Password fields (`AXSecureTextField`) are never read or written.
- Clipboard: a snapshot of every item and type is taken; it's restored **only if `changeCount` still equals MIKO's own write**.
- **Verified directly (TextEdit scratch document):**
  - capture via Accessibility
  - replace, confirmed by read-back
  - replace refused after the selection changed
  - ⌘V paste verified, with the original clipboard restored
  - when a new copy happened mid-operation, the restore was skipped and the user's copy kept
  - a password dialog was refused for both capture and paste
- `MIKO_AX_FORCE_PASTE` / `MIKO_AX_RESTORE_DELAY_MS` exist for tests only.

**Limitation:** automatic insertion into ChatGPT becomes possible only if a future ChatGPT build exposes its composer (re-check with `scripts/probe-chatgpt-composer.swift`). The code path is already in place.

### 2026-11-14: Session 1, mail via ChatGPT (owner: "just use mail from my gpt")
- **Investigated:** Codex CLI, with the apps feature on and with the owner's full config, reports **no Gmail/email tools**. ChatGPT's Gmail connector is not reachable from MIKO by any supported route, and the ChatGPT window can't be read (Accessibility plus OpenAI terms).
- **Change:** when MIKO has no mailbox of its own, mail commands hand off to the ChatGPT app right away. They copy a read-only request (`mailRequestFor`: recent/important → MAIL_REQUEST; unread; search with the exact terms) and bring ChatGPT forward. The owner pastes and presses Send, and the results stay in ChatGPT. "open the second email" says to open it in ChatGPT. With a Gmail account connected in MIKO, the Mail panel is used as before.
- **Verified:** typecheck, 116/116 tests, build.
- **Not yet live-checked:** the automatic handoff in the app (usage limit reached).

### 2026-11-14: Session 1, Gmail connection setup made in-app
- **New:** the Mail tab's Connect mail screen has a **Gmail setup** form (Client ID + Client secret).
  - Values are checked (`checkGoogleClient`: `…apps.googleusercontent.com` and a token-shaped secret).
  - Main stores them encrypted with safeStorage in `userData/mail-oauth.enc` (0600). Nothing is stored if Keychain encryption is unavailable.
- **Connected account** is now shown in the filter row ("Connected: <email>").
- Refresh, Load more, Disconnect (Accounts menu), Reconnect banner, empty states and stale-search handling come from the mail panel work (32ecac6).
- **Verified:** the setup form appears in the real app; an invalid Client ID is refused with a message and nothing is written. typecheck passes, 113/113 tests pass, build passes.
- **Live Gmail checks: waiting for the owner** to do the Google Cloud setup and sign in (steps under "Gmail setup" below). The owner's screenshot showed the setup form still empty.
- **Fix from that screenshot:** the glass panel let the window behind show through (ChatGPT text overlapped the form). The glass surface is now 97% opaque (was 86%).

### 2026-11-14: Session 1, MIKO assistant (generalised Codex bridge)
**Commit-hash correction:** git history shows the bridge proof of concept is **`a68f0dc`** ("Add opt-in ChatGPT bridge proof of concept (Codex CLI)"). The `9b54e46` given in that turn's summary was wrong and doesn't exist. The mail panel is `32ecac6`.

**Routing**
- Questions and writing requests go to the MIKO assistant: they start with how/what/why/…, explain, write, draft, summarise, translate, give me, list, suggest, say, make, create, plan, help me, …
- While a conversation is active, any other non-command text is a follow-up.
- Local commands (movement, apps, chats, mail, switcher) are matched by the local router first.
- "ask GPT …", "open ChatGPT", saved chats and Ask-in-ChatGPT-app stay for the owner's real ChatGPT chats and memory.
- Mail questions ("do I have any unread emails?", "any new mail?", "what's in my inbox?") go to the Mail panel's real mailbox, never to the model.

**Assistant** (`src/main/bridge.ts`, `src/shared/bridge.ts`)
- Uses the Codex CLI bundled in ChatGPT.app, signed in with ChatGPT.
- Requests run headless, one at a time; each card is tied to its own request id.
- Card shows "Thinking… N s" (`codex exec --json` streams no partial text, so the timer is the pending indicator), then Cancel and a 120 s timeout.
- Each reply continues the current thread (`assistantThread`). "New conversation" (button or voice) starts fresh.
- Every card is labelled "MIKO assistant · conversation <id> · follow-up N", with a note that it can't see ChatGPT chats, memory, files or mail.
- The paw-menu item "MIKO assistant (Codex, ChatGPT sign-in)" is on by default because the owner asked for questions to route through it. Turned off, questions go to the ChatGPT app handoff.

**MIKO preferences:** Chat tab → ⚙. Free text up to 2000 characters, stored as `mikoPreferences` in `userData/miko-settings.json` (never in Git). It's added to the assistant's instructions for new conversations, and the UI explains it is separate from ChatGPT memory.

**Token investigation** (same prompt "Reply with MIKO bridge test", input tokens)

| Change | Input tokens |
|---|---|
| Default `codex exec` (as in the bridge test) | 17,222 |
| `--ignore-user-config` (drops the owner's 10 plugins, `node_repl` MCP server, notify hook) | 15,680 |
| + MIKO instructions file instead of Codex's agent prompt (21,175 chars → 632) | −4,044 |
| + `web_search="disabled"` | −2,369 |
| + `skills.include_instructions=false` (9,277-char skills block) | −2,053 |
| + feature switches off (shell, unified_exec, apps, image generation, goals, sleep, …) | about −1,600 |
| + collaboration-mode, permissions and environment text off | about −480 |
| **Final, validated with `--strict-config`** | **3,616** (live MIKO turn with preferences: 3,726) |

- `tools.view_image` and `include_apply_patch_tool` turned out not to be real settings (strict mode rejects them), so they were removed.
- **Left over:** Codex's `<multi_agent_role>` block (2,429 chars). `features.multi_agent=false` doesn't remove it.
- The assistant has **no tools** (no shell, web, files, plugins or MCP), runs read-only with `approval_policy=never`, and starts in an empty folder (`userData/assistant/empty`).
- The instructions file `userData/assistant/instructions.md` is written by MIKO and is not in Git. Credentials stay in Codex's own login.

**Verified live** (real app, ChatGPT sign-in)
- **Question:** "Thinking… 0 s → 1 s → 2 s", then "The capital of Australia is Canberra." in 4.9 s.
- **Follow-up:** "and roughly how many people live there" continued the same conversation (follow-up 1): "Around 480,000 people live in Canberra, Pranav." That used the context, plus the preference.
- **Name check:** "What is my name?" gave "Your name is Pranav." (from MIKO preferences).
- **Cancel:** the 400-word story was cancelled and still showed Cancelled 10 s later with no reply.
- **New conversation:** "Say only the word ready." gave "ready" in a new conversation (01a1d9b0). Final-args run: "Sail." in conversation 01a1d9b2.
- **Mail:** "do I have any unread emails?" opened the Mail tab, which showed **Connect mail** (no mailbox is connected). The model wasn't asked.
- typecheck passes, 111/111 tests pass, build passes. The owner's settings file was restored after testing (none existed).
- **Side effect:** the tests created several Codex threads, visible in the ChatGPT app's Codex list.

**Next**
- Optionally stream partial text if a future Codex CLI emits deltas.
- A thread picker for older MIKO conversations.
- Windows: the Codex CLI path is macOS-only for now.

### 2026-11-14: Session 1, ChatGPT desktop bridge investigation + proof of concept
**Goal:** submit from MIKO while WhatsApp is in front, have ChatGPT answer in a chosen conversation, and show the answer in MIKO.

**Findings**
- **Desktop Accessibility route: not possible, and not appropriate.**
  - ChatGPT.app (`com.openai.codex` 26.924, Electron) exposes only its windows (6–8 elements): no composer, no submit control, no generation state, no reply text.
  - `AXManualAccessibility` gives -25205 and `AXEnhancedUserInterface` gives -25208 (re-check with `scripts/probe-chatgpt-composer.swift`).
  - OpenAI's Terms of Use (version dated 2026-01-01) prohibit automatically or programmatically extracting data or Output from the Services. Scraping replies out of the ChatGPT window would break that even if it were exposed.
- **No official interface reads or continues chatgpt.com conversations from another app.**
  - The app's documented `codex://` links open new or local threads, settings and plugins. None returns a reply.
  - Apple Shortcuts has ChatGPT actions ("Ask ChatGPT", and the macOS 26 "Use Model" action via Apple Intelligence's ChatGPT extension). They need the owner to build a Shortcut and don't target a chosen ChatGPT conversation. Not pursued.
  - The OpenAI API is a separate product (API key, billing), with no access to ChatGPT conversations or memory.
- **Supported route found: the official Codex CLI bundled in ChatGPT.app** (`/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`, 0.158.0-alpha.2.1).
  - It reuses ChatGPT's own sign-in (`codex login status` reports "Logged in using ChatGPT"); MIKO never sees credentials.
  - `codex exec --json` runs headless and streams `thread.started`, `item.completed` (agent_message) and `turn.completed`.
  - `codex exec resume <thread>` continues a chosen thread.
  - Documented at learn.chatgpt.com/docs/non-interactive-mode.
  - **Limits:**
    - These are **Codex threads** (they show up in the ChatGPT app's Codex workspace), not chatgpt.com chat conversations, Projects or custom GPTs. ChatGPT connectors and memory from chat aren't implied.
    - Each request uses ChatGPT plan usage: about 17k input tokens for the first turn and about 35k on resume, because of Codex's system context.
    - OpenAI's docs call API keys "the right default for automation". ChatGPT sign-in is documented for local use and advanced CI.

**Proof of concept (opt-in)**
- **Turning it on:** tray menu → "ChatGPT bridge test (Codex CLI)". Off by default, stored as `bridgeEnabled`.
- **Commands:** "Reply with MIKO bridge test" / "MIKO bridge test", typed or spoken. "bridge new conversation" forgets the chosen thread.
- **How a request runs:**
  - `src/main/bridge.ts` spawns `codex exec [resume <thread>] --json --skip-git-repo-check -c sandbox_mode="read-only" -c approval_policy="never"` in an empty `userData/bridge-work` folder, with stdin closed.
  - Each request has its own id and process.
  - The reply is accepted only after `turn.completed`, a non-empty agent message, and (when resuming) the same thread id (`src/shared/bridge.ts`, tested).
  - **Timeout:** 120 s, after which the process is killed.
  - **Cancel:** SIGTERM; the card says ChatGPT may already have received the request.
  - **Busy/duplicate:** one request per conversation; a second is refused, not queued. The card only shows success when its own reply arrives.
  - **Existing composer text:** not applicable, because the ChatGPT window is never touched.
- **Choosing a conversation:** after a reply, "Keep using this conversation" saves the thread (`bridgeThread`) for later requests.

**Observed (real app, Playwright, owner's ChatGPT sign-in)**
- **Bridge off:** the request was refused with the opt-in hint.
- **Bridge on, spoken request with WhatsApp frontmost:**
  - reply "MIKO bridge test" in 6.6 s
  - WhatsApp frontmost in 19/19 samples; **no foreground activation of ChatGPT or MIKO**
  - a duplicate request while pending was refused
- **Keep this conversation, then resend:** same thread (01a1d9a1…), reply in 7.6 s, WhatsApp still frontmost.
- **Cancel:** card showed Cancelled; still Cancelled 8 s later (no late success); 0 leftover `codex` processes.
- **Earlier direct CLI runs:** 6 s each, new thread then resumed thread, WhatsApp frontmost. One run showed the macOS UserNotificationCenter dialog in front for about 1 s; it didn't recur.
- **Not exercised live:** the 120 s timeout (code path only).
- **Side effect:** the test created a few Codex threads, visible in the ChatGPT app's Codex list.
- typecheck passes, 103/103 tests pass, build passes.

**Next step:** decide whether Codex threads are an acceptable "conversation" for this workflow.
- **If yes:** generalise the bridge from the fixed test phrase to free-form requests (keep it read-only and opt-in), and add a thread picker from `~/.codex/sessions`.
- **If you need real chatgpt.com chats (Projects, custom GPTs, memory, connectors):** there is no supported interface today. Keep the copy-and-paste handoff, and watch OpenAI's app docs for an official integration.

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
7. In MIKO: Mail tab → paste the **Client ID** and **Client secret** → **Save Gmail setup**. It's stored encrypted with safeStorage/Keychain as `userData/mail-oauth.enc`. (The older `mail-oauth.json` file and `MIKO_GOOGLE_CLIENT_*` env vars still work.)
8. Mail tab → **Connect account**. In the browser, pick the account → "Google hasn't verified this app" → Continue (it's your own app in Testing) → allow. The tab says "MIKO is connected".
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
