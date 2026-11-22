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
- `updater.log` — update attempts  
- feedback export JSON — when no feedback endpoint is configured, reports stay local/exportable  

A build-time feedback environment variable is **not** assumed to be embedded in the installer unless the release process explicitly sets it.

## Feedback export

In the pet panel → Preferences → Feedback → export a report. If no endpoint is configured, the report stays on disk under `%APPDATA%\MIKO-Beta\` for you to send manually.

## Windows limitations (honest)

These remain macOS-only unless a real Windows hook is implemented later:

- Caps Lock+A hold-to-talk  
- App switcher (MIKO Keys helper)  
- Selected-text shortcut / Accessibility replace  
- WhatsApp native AX automation  
- Lens window control / browser-tab automation  
- Notes / ChatGPT.app AX typing destinations  

Button-driven `System.Speech` mic, transparent click-through, tray behavior, Store-installed app discovery, and Interactive GPT floating behavior need **live Windows verification** on the owner PC.
