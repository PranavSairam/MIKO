# Verification checklists (do not skip)

## 1. Unsigned local A→B (already done 2026-11-19)

- [x] Detect newer version from local feed
- [x] Download zip; phase `ready`
- [x] Install blocked without Developer ID (expected)
- [x] Prefs survived failed install attempt

## 2. Signed A→B over HTTPS (blocked until credentials + host)

Run only after `MIKO_SIGN=1` builds succeed and the feed is HTTPS.

1. Release A (`0.1.x`) signed+notarized; install from DMG outside the repo.
2. In A: set a unique Preferences value; type a chat-box draft; optionally start a WhatsApp open/draft then cancel or leave mid-flight.
3. Release B (higher version) with same feed URL; `--publish` to HTTPS.
4. In A: Preferences → Check for updates → wait for download → **Restart now** (not force-quit).
5. Pass criteria:
   - App version shows B
   - Preference value still present (`MIKO-Beta` userData)
   - Chat draft recovered (or clearly offered); no silent WhatsApp send
   - Interrupted external actions **not** replayed (`update-handoff` / session flush)
   - Gatekeeper accepts launch without right-click bypass
   - `updater.log` has no signature failure
6. Mark **distribution-ready** for auto-updates only after this passes.

## 3. Feedback durability + owner review

### Local (already done)

- [x] POST with invite stores in `data/reports.json`
- [x] Owner token lists / exports / status updates
- [x] Bad invite 401; duplicate `clientKey` 409

### Remote (blocked until HTTPS host)

1. Deploy per `feedback-server/DEPLOY.md`.
2. Submit from a packaged build against `https://…/v1/reports`.
3. Confirm file on server and dashboard review.
4. Mark remote feedback **distribution-ready** only after that E2E.
