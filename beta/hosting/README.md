# One VPS for updates + feedback

This is the supported hosting path (`beta/DISTRIBUTION.md`).  
`publish-rsync.sh` uploads the update feed. Caddy serves it and proxies feedback.

Optional `publish-r2.sh` is unused in the guided setup — leave it alone.

## Server layout

```
/var/www/miko/beta/     ← rsync target (zip, yml, blockmap)
/opt/miko-feedback/     ← feedback-server + config.json + data/
```

URLs (same host):

- Updates: `https://miko.example.com/miko/beta/`
- Feedback API: `https://miko.example.com/v1/reports`
- Owner dashboard: `https://miko.example.com/`
