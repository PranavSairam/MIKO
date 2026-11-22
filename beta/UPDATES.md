# MIKO private-beta updates

## Zero-budget (current default)

Unsigned packaged builds **never auto-install**.

1. Preferences → optional shared release URL → **Check for updates** (if `latest.json` URL is set).
2. Status **update available** when a newer version is listed.
3. **Download latest version** → status **download opened** (browser/folder). Draft is saved; in-flight actions cancelled and not replayed.
4. Quit MIKO, replace `MIKO.app` from the new DMG, reopen → status **update installed**.
5. Settings remain in `~/Library/Application Support/MIKO-Beta`.

Do **not** tell testers to disable Gatekeeper. Use Finder → right-click → Open.

Release helper still works without signing:

```bash
MIKO_MANUAL_RELEASE_URL='https://…' npm run release:beta -- --version 0.1.1
```

## Signed auto-update (preserved for later)

When the running app is **Developer ID Application–signed**, electron-updater + generic HTTPS `beta` channel activates (`electron-builder.signed.yml`, `MIKO_SIGN=1`). See older notes in `beta/hosting/` and `beta/DISTRIBUTION.md` (Later section).

Local unsigned A→B detect/download against `update:server` remains useful for feed plumbing tests; install still fails without Developer ID — expected.
