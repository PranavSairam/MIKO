# MIKO private beta — distribution

## Current path: zero-budget (default)

No Apple enrollment, VPS, domain, or paid host required for the initial friend beta.

| Piece | How it works |
| --- | --- |
| Package | `npm run dist:mac` or `npm run release:beta` — **ad-hoc** sign (`identity: "-"`). Never `identity: null` (broken signature → “App is damaged”). Does **not** include your userData, mail tokens, or Codex login. |
| Install | Friend uses Finder → right-click → Open. **Never** disable Gatekeeper. |
| Updates | Manual: configurable **Download latest version** link (+ optional `latest.json`). Auto-install is **disabled** while unsigned. |
| Feedback | In-app Preview + **Export report**; tester sends the file to you. No “Feedback sent” without a real remote inbox. |
| Tester guide | `beta/TESTER.md` |

### Owner: ship a free build

1. `npm run typecheck && npm test && npm run build`
2. Optional shared folder URL:
   ```bash
   MIKO_MANUAL_RELEASE_URL='https://…your-shared-folder-or-dmg…' \
     npm run release:beta -- --version 0.1.0
   ```
   Or leave blank and paste the link later in a friend’s Preferences via the owner telling them the URL (or set `manual-release.json` in their userData only if you must — prefer baking at release).
3. Put `MIKO-*.dmg` (and optional `latest.json` — see `beta/latest.json.example`) in iCloud/Drive/Dropbox/AirDrop.
4. Send `beta/TESTER.md` + the DMG. Do **not** publish from this chat as a formal release pipeline unless you choose to.

Verify env helpers for the **later** paid path still exist (`npm run beta:verify-env`) but are not required now.

---

## Later (preserved, not required now)

Signed electron-updater + `beta/feedback-server` HTTPS remain in the repo for when you want them:

- `electron-builder.signed.yml` + `MIKO_SIGN=1`
- Generic HTTPS feed + rsync/Caddy templates under `beta/hosting/`
- Feedback server deploy notes in `beta/feedback-server/DEPLOY.md`

Costs if you opt in later: Apple Developer **~$99/yr**, one VPS **~$4–6/mo**, domain optional.

Until a build is **Developer ID–signed**, the app stays on the manual update path automatically.
