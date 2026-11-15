# MIKO (PET_BOT): project log

This is the running record of the project. Read it first when you pick the project up on a new machine or in a new chat. New entries go at the top of **Session log**.

---

## Snapshot (as of 2026-11-14)

**What it is:** MIKO is a desktop companion built with Electron, React, TypeScript, and three.js. A 3D Doberman sits on top of your other windows. You talk to it in a chat panel, by typing or by push-to-talk. It can walk, sit, follow the active window, open and close apps, search WhatsApp contacts on macOS, draft and insert WhatsApp replies (macOS), read Gmail, and answer through the MIKO assistant (Codex, using your ChatGPT sign-in in a separate thread) or hand a prompt to the ChatGPT app.

**Platforms:** Developed on macOS. The code targets Windows too, but the Windows smoke test in README.md has not been run. WhatsApp contact search returns a clear unsupported state on Windows. There is no installer. Git history is on `main`.

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
- **Chrome profiles (macOS live-checked):** “open Chrome” / “choose chrome profile” / “open … in Chrome” → glass fan of real Local State profiles (avatar/initials, directory id separate from name). Optional saved default; never auto-saved. Launch by `--profile-directory` without closing other profile windows.
- **WhatsApp attachments (macOS):** “fetch/download the latest file/PDF”, “copy this file”, “save to Downloads”, “show in Finder”, “attach it here” → attachment actions (not the general assistant). Visible document bubbles only; Save to Downloads + verified local file; file card; real file pasteboard; attach unsent with header recheck.
- **Questions** (ending in `?`, or starting with how/what/why/explain/write/…) go to the MIKO assistant when that setting is on, and to the ChatGPT app handoff when it is off.

### Known loose ends

- The Windows smoke test is still pending. WhatsApp contact search and reply drafting/insertion are unimplemented there on purpose.
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
