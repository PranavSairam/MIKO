# MIKO private beta

Friends install a packaged build — not this repository. Feedback is private; in the free beta they **export a report** and send it to you.

## What is supported

| Platform | Status |
| --- | --- |
| macOS (Apple Silicon + Intel) | Primary. Unsigned DMG/ZIP via `npm run dist:mac` / `release:beta`. |
| Windows | Code exists; **not** labeled ready. |

## Zero-budget flow (current)

See **`beta/TESTER.md`** (send this to friends) and **`beta/DISTRIBUTION.md`**.

- Package without owner credentials / sessions / `MIKO-Beta` userData.
- Install with normal Gatekeeper (right-click → Open). Never tell testers to disable Gatekeeper.
- Automatic update **install** is off on unsigned builds; Preferences → **Download latest version**.
- Feedback: Preview + Export report (no false “sent”).
- Settings survive replacing the app (`~/Library/Application Support/MIKO-Beta`).

## Assistant on a clean laptop

The MIKO assistant uses **ChatGPT.app’s bundled Codex CLI** and the **tester’s own ChatGPT sign-in**. Nothing from the developer’s Codex/ChatGPT session is packaged.

On a fresh Mac:

1. Install [ChatGPT for Mac](https://openai.com/chatgpt/download/).
2. Sign in inside ChatGPT.
3. Open MIKO; Preferences shows assistant readiness.
4. If ChatGPT/Codex is missing, assistant features explain that and stay disabled. Other features still work.

Mail needs the tester’s own Google OAuth client. WhatsApp aliases start empty.

## Build a tester package (macOS)

```bash
npm install
npm run build
MIKO_BUILD_ID="$(date -u +%Y%m%dT%H%M%SZ)" \
MIKO_MANUAL_RELEASE_URL="https://YOUR_SHARED_FOLDER_OR_DMG" \
  npm run dist:mac
```

Or versioned: `npm run release:beta -- --version 0.1.0` (bumps version; see script).

Artifacts: `release/`. Does **not** include `.git`, your userData, mail tokens, or Codex login.

### Signing

Default is **ad-hoc** signing (`mac.identity: "-"`). Do **not** use `identity: null` (that caused “App is damaged” on 0.1.0). Friends may see “Apple could not verify” → right-click Open / Open Anyway. Signed+notarized path is preserved for later (`MIKO_SIGN=1`).

## Feedback

In-app form → Preview → **Export report** → tester shares the file with you.  
Remote `beta/feedback-server` is optional later; until an HTTPS endpoint is configured, MIKO must not claim delivery succeeded.

## Updates

| Mode | When |
| --- | --- |
| Manual download link | Unsigned builds (current) |
| electron-updater auto | Only when the running app is Developer ID–signed |

Statuses to expect (manual): **update available** → **download opened** → **update installed** (after replace + relaunch).

## Security notes (honest)

- DevTools off in packaged builds ≠ anti-tamper.
- Unsigned helpers may need re-approval after each app replace.
- Packaged apps cannot stop a determined reverse engineer.
