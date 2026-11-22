# MIKO on Windows — developer setup

For cloning, building, and producing the NSIS installer on a Windows PC (PowerShell). Dad-facing install-from-`.exe` steps are in [WINDOWS_USER_GUIDE.md](./WINDOWS_USER_GUIDE.md).

## Prerequisites (PowerShell)

1. **Git for Windows** — https://git-scm.com/download/win  
2. **Node.js 22.12+** (LTS) — https://nodejs.org/  
   Confirm:

```powershell
node -v
npm -v
git --version
```

## Clone / pull

```powershell
git clone https://github.com/PranavSairam/MIKO.git
cd MIKO
git pull
```

## Install dependencies

```powershell
npm ci
```

Use `npm ci` so the lockfile stays authoritative. Do not commit `node_modules`.

## Dev / start

```powershell
npm run typecheck
npm test
npm run build
npm run start
```

For a live Electron session during development:

```powershell
npm run dev
```

## Checks

```powershell
npm run typecheck
npm test
npm run build
npm run pack:win-check
```

## Windows installer build

```powershell
npm run build
npm run dist:win
```

Expected artifact (version-derived):

`release\MIKO-0.1.1-win-x64.exe`

(Replace `0.1.1` with the `version` in `package.json` if it changes.)

The installer is **per-user NSIS**, unsigned. It does **not** embed `userData`, ChatGPT/Codex login, or `miko-settings.json`.

Packaging on macOS with `npm run dist:win` may produce an `.exe` as a packaging check only — that is **not** a successful Windows launch verification.

## Logs and local data

After install / first run, MIKO stores beta data under:

`%APPDATA%\MIKO-Beta\`

Useful files:

- `miko-settings.json` — preferences / setup state  
- `miko-diagnostics.log` — what MIKO tried and why it failed: shortcut registration, app list (Get-StartApps) and launches, speech helper start/errors, Interactive GPT loads. Hosts and short reasons only — no transcripts, messages or full URLs. **Read this first when something doesn't work.**  
- `updater.log` — update attempts  
- feedback export JSON — when no feedback endpoint is configured, reports stay local/exportable  

A build-time feedback environment variable is **not** assumed to be embedded in the installer unless the release process explicitly sets it.

## Feedback export

In the pet panel → Preferences → Feedback → export a report. If no endpoint is configured, the report stays on disk under `%APPDATA%\MIKO-Beta\` for you to send manually.

## Windows limitations (honest)

These remain macOS-only unless a real Windows hook is implemented later:

- Caps Lock+A hold-to-talk (Windows uses **Shift+A** instead — see below)  
- Selected-text shortcut / Accessibility replace  
- WhatsApp native AX automation  
- Lens window control / browser-tab automation  
- Notes / ChatGPT.app AX typing destinations  

Button-driven `System.Speech` mic, transparent click-through, tray behavior, Store-installed app discovery, and Interactive GPT floating behavior need **live Windows verification** on the owner PC.

## How the Windows paths work (2026-11-22 fixes)

- **Apps:** MIKO reads `Get-StartApps` (desktop + Microsoft Store apps, with their AppUserModelIDs) and launches with `explorer.exe shell:AppsFolder\<AppID>`. Calculator and WhatsApp (Store) are found this way. If the list can't be read, MIKO says so instead of "isn't installed".
- **Voice:** `resources/listen-win.ps1` picks an installed recognizer (UI language, then en-US / any English). MIKO shows "Listening" only after the helper reports it started. Failures name the fix: Microphone privacy ("Let desktop apps access your microphone"), Sound → Input (default device — System.Speech always uses it), or Speech language (no recognizer installed). Panel failures have **Retry**. Tray → **Talk to MIKO (mic)** works without any shortcut.
- **Shortcut:** default Ctrl+Shift+R. If another app owns it, Setup & Help → shortcut step offers Ctrl+Alt+M, Ctrl+Shift+M or Alt+Shift+M and a live press test. Tray Show / Hide always works.
- **ChatGPT:** "open ChatGPT" and the Interactive GPT button open MIKO's embedded workspace. Load errors show **Retry** and a labelled **Open in browser**; links that leave chatgpt.com are held with an explicit **Open in browser** button — nothing opens Chrome silently.

- **Keys (`resources/keys-win.ps1`):** a low-level keyboard hook in a background PowerShell process (C# compiled at start, no admin).
  - **Hold Shift + A** to talk, let go to stop. A quick Shift + A tap still types "A" (held back ~0.35 s, then replayed). Holding Shift + A to auto-repeat "AAAA" now talks instead.
  - **Tab + Q** opens the app switcher. Tab still works normally; only the Q is swallowed.
  - The switcher lists visible app windows (Store apps included), switches with a click/Enter, and "quit" sends a normal close (apps still ask to save). Browser tab lists are Mac-only.
  - Keys typed into an **administrator** window can't be replayed by a normal-user MIKO (Windows UIPI), and focus switching follows Windows' foreground rules.

### Quick manual check (PowerShell)

```powershell
Get-StartApps | Where-Object Name -match 'Calculator|WhatsApp'
Add-Type -AssemblyName System.Speech; [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name }
powershell -NoProfile -ExecutionPolicy Bypass -File .\resources\listen-win.ps1 -Mode test
```
