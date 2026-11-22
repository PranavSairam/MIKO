# Deploy the private feedback inbox

Local E2E is verified. Remote friends’ reports are **not** durable for you until this host is live.

## What “durable private storage” means here

- Reports append to `data/reports.json` on the server (mode `0600`).
- `config.json` (invite codes + owner token) stays on the server — gitignored; never packaged into MIKO.
- Owner reviews via dashboard (`GET /`) or `GET /v1/export` with the owner token.
- Treat report bodies as untrusted text. Never execute them.

## Steps

1. Copy `beta/feedback-server/` to a private host (VPS, Fly, Railway, etc.). Do **not** put it in a public git tree with real `config.json`.
2. On the host: `node init-config.mjs` (or copy your local config carefully). Note invites + owner token offline.
3. Bind beyond localhost for production: set `"host": "0.0.0.0"` in `config.json` and put **HTTPS** in front (Caddy/nginx/Fly TLS). Prefer terminating TLS at the reverse proxy and proxying to `127.0.0.1:8787`.
4. Persist `data/` across restarts (volume / disk). Back up `data/reports.json` if you care about history.
5. Firewall: only 443 public; do not expose owner token in URLs or logs.
6. Point packaged apps at `https://YOUR_HOST/v1/reports`:
   - Build with `MIKO_FEEDBACK_URL=…`, **or**
   - Testers paste endpoint + invite once in Preferences (stored in their `MIKO-Beta` userData only).
7. Verify:
   - Tester submit → `201` / status `sent`
   - Owner dashboard lists the report
   - Export Markdown/JSON works
   - Bad invite → `401`
8. Revoke a tester: remove their invite from `config.json`, restart the process.

## Local re-check (this machine)

```bash
npm run feedback:init    # no-op if config exists
npm run feedback:server  # http://127.0.0.1:8787
# Submit from MIKO → confirm beta/feedback-server/data/reports.json grew
# Open http://127.0.0.1:8787 → paste ownerToken → Load
```
