# MIKO automation audit (2026-11-22)

What MIKO's existing actions really do today, per platform. Built from the capability registry
(`src/shared/capabilities.ts`), the action layer (`src/shared/actions.ts`), the router
(`src/shared/commands.ts`) and the handlers in `src/main/` and `MotionApp.tsx`, plus the live
results recorded in `PROJECT_LOG.md`.

MIKO has no "do anything" executor. Every action is a typed kind in the registry. It runs only
through its own handler and is gated by platform and permission. Unfamiliar wording goes through
the schema-checked interpreter, which can only produce registered kinds.

**Status key.** *Live* means checked by hand on that platform. *Code* means implemented and unit
tested but not yet run there. *No* means not available on that platform. For Windows, the only
live evidence is the owner's report that **pet movement and typed text capture work**. Everything
else on Windows is *Code*.

**R / M / S** means the action Reads, Modifies, or Sends. No MIKO action sends a message
(WhatsApp, mail or ChatGPT) unless the owner explicitly asked it to. The one exception is GPT Mode,
which submits by design and is opt-in.

## 1. Apps, sites and the desktop

| Action (kind) | Inputs / context | Mac | Win | Permissions | R/M/S | Success is observed by | Cancel / recovery |
|---|---|---|---|---|---|---|---|
| Open / focus app (`open_application`) | App name → catalog match; unfamiliar apps confirm first | Live | Code (fixes untested) | None | M | Launch/activate call returns ok; "Opened X" only after that | One-shot. Missing app gives "can't find"; ambiguous names show a chooser |
| Quit app (`close_application`) | Running app name; force quit asks first | Live | Code | None | M | Process exited | Normal quit lets the app ask to save. "Force quit" needs a yes |
| Open website (`open_website`) | Site name or URL; optional browser | Live | Code | None | M | Browser open returned ok | Pending site waits for "in Chrome"; Cancel drops it |
| Web search (open-url + `search`) | Query, browser, optional Chrome profile | Code | Code | None | M (opens a tab) | "Opened search in Chrome" only after launch ok; results are never read | Chooser token: Cancel or a newer request makes late launches no-ops |
| Chrome profile chooser | Real `Local State` profiles; saved default only by explicit choice | Live | Code | None | R + M | `--profile-directory` launch ok | Esc / Cancel; stale choices are disabled |
| List / close browser tabs (`list_browser_tabs`, `close_browser_tab`, `close_website`) | Host or title match | Live | No | Automation | R / M | Tab no longer listed | Ambiguous matches ask; the browser is never quit |
| App switcher (Tab + Q) | Visible windows | Live | Code | Mac: Accessibility + Input Monitoring. Win: none (UIPI blocks admin windows) | R / M | Focused window changes | Esc closes. Quit asks the app politely |
| Pet movement, follow, sit/stay | Command or drag; work area | Live | **Live (owner)** | Follow: Mac Accessibility | M (pet only) | Pet arrives (controller settles) | Any new order replaces the old one; drag takes over |
| Casual play (Fetch / Feed / Pet) | Casual mode; user-started | Code (2026-11-22) | Code | None | M (pet only) | State machine reaches reaction → idle/ready | Esc, Done, Dismiss, any command or opening the panel stops it at once |

## 2. Text, selection and ChatGPT

| Action | Inputs / context | Mac | Win | Permissions | R/M/S | Success is observed by | Cancel / recovery |
|---|---|---|---|---|---|---|---|
| Typed / voice command capture | Panel text or transcript | Live | **Live (owner, typed)**; voice intermittent, see §4 | Mic + speech (voice) | R | Router decision shown in panel | Voice: one result per session id; Cancel releases the mic |
| Read selected text (`read_selected_text`) | Fresh explicit capture | Live | No (clipboard only) | Accessibility | R | Capture id + text | Stale captures are refused |
| Replace selected text (`replace_selected_text`) | Reviewed result, same field | Live | No | Accessibility | M | Field read back matches (else "couldn't check") | Copy / Paste-where-I-click fallback |
| Summarize / rewrite (`summarize_text`, `rewrite_text`) | Source text; assistant on | Live | Code (needs Codex CLI) | MIKO assistant sign-in | R | Reply in panel | Bridge request id cancel |
| Ask assistant (`ask_assistant`) | Question | Live | Code | Codex sign-in | R | Reply in panel | `bridgeCancel(requestId)` |
| Interactive GPT open / show / hide | None | Live | Code | ChatGPT web sign-in (owner) | R | WebContentsView visible | Hide keeps the session |
| Paste clipboard / explicit selection into Interactive GPT | Explicit clipboard or selection | Live | Code (clipboard path) | None | M (composer, unsent) | Composer contains text; never submitted | Login page refused; nothing is sent |
| Type destinations (`chatgpt_new_chat`, `insert_text`, `focus_omnibox`, `choose_type_destination`) | Verified editable, non-secure field | Live | No | Accessibility | M (unsent) | Field value read back | Held draft expires; secure fields refused |
| GPT Mode (ChatGPT app, opt-in) | Messages while active | Live | No | Accessibility | **S** (submits by design) | Delivery status card | Pause/exit; `cancelBlocksLateSubmit`; never retried |

## 3. WhatsApp and Mail

| Action | Inputs / context | Mac | Win | Permissions | R/M/S | Success is observed by | Cancel / recovery |
|---|---|---|---|---|---|---|---|
| Search contacts (`search_whatsapp_contacts`) | Name; aliases only if saved | Live | Code (UI Automation helper, never run) | Mac: Accessibility. Win: UI Automation | R | Result rows read | Generation bump on Cancel; no match keeps the task |
| Open chat (`open_whatsapp_chat`) | Exactly one match | Live | Code | as above | M (navigation) | Chat header equals the name | Several matches give a chooser; one stale retry |
| Read / summarize messages | Verified chat | Live | No | Accessibility + assistant | R | Messages from the chat table only | Stale chat refused |
| Draft / refine reply | Verified chat + instruction | Live | Code (draft shown in MIKO only) | Assistant | R | Draft text in panel | Cancel / "leave it" |
| Insert draft (`insert_whatsapp_draft`) | Reviewed draft, same header | Live | No | Accessibility | M (unsent) | Composer value matches; nothing sent | Existing text asks Replace/Append/Cancel |
| Attachments (list / fetch / copy / attach) | Visible document bubbles | Live | No | Accessibility | R / M (unsent) | Local file exists and is complete | Never overwrites silently |
| Mail search / read / reply draft | Connected Gmail | Live | Code | Gmail OAuth | R | Results / body / draft in Mail tab | Reply is drafted only, never sent |

## 4. Voice (Stage 1 of this session)

- **Mac:** SFSpeechRecognizer on the device, live-checked. The microphone test now has its own
  result path, so the words are never run as a command.
- **Windows:** System.Speech via `listen-win.ps1`. The owner reports it is intermittent, and the
  cause is not proven yet. This session added per-session ids, stage timings
  (`speech-loaded` / `recognizer` / `input` / `recognizing`), ready / heard / end times, error
  codes, the default device name and the installed recognizers. All of it goes to
  `miko-diagnostics.log` (no audio, no words).
- **Code paths fixed:** a click while starting joins that start instead of reporting
  "Listening" early; the mic test blocks other listening; the safety timeout gives a reason;
  late callbacks are logged as stale.
- **Device choice:** System.Speech records only from the Windows default input. MIKO shows that
  device and opens Sound settings to change it. It does not pretend to pick a device itself.

## 5. Three practical next workflows

These are built only from pieces that already work (live on the Mac, code on Windows), so
each is mostly new wiring, not new automation.

1. **Open a site and search it.** "Search YouTube for lo-fi", "Find Chennai on Google Maps".
   - Extend `web-search.ts` with an allowlist of per-site search URL templates (YouTube, Maps,
     Amazon, Wikipedia), always built with `URLSearchParams`.
   - Reuse the Chrome profile chooser and the chooser token. Success means the launch call
     returned ok. Read-only, works on both platforms, never reads results.
2. **Explicit selection → Interactive GPT.** "Ask GPT about this" after selecting text.
   - Mac uses the existing selection capture; Windows uses the clipboard ("copy, then say
     'paste into GPT'").
   - Lands in the Interactive GPT composer unsent, using the existing transfer path.
   - Needs: a router phrase and a short preview card ("Put this in GPT? Not sent").
3. **Find a WhatsApp contact, then prepare a reply.**
   - Mac: the full flow already works (open → draft → insert unsent).
   - Windows: chain the new contact search → open chat with the assistant draft, shown in MIKO
     with Copy. No composer typing on Windows until UI Automation insert is built and
     live-verified.
   - Needs: the Windows live check of `whatsapp-win.ps1` first.

**Not recommended yet:** anything that sends, anything outside the registry, and anything that
types into Windows apps through UI Automation before the contact-search helper has passed its
live check.
