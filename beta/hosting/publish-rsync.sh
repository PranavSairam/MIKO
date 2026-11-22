#!/usr/bin/env bash
# Upload the local beta feed folder over rsync/SSH.
# Secrets (SSH keys, host) stay in your shell / agent — never commit them.
#
# Required:
#   MIKO_UPDATE_FEED_DIR   (set by release-beta.mjs)
#   MIKO_RSYNC_DEST         e.g. user@host:/var/www/miko/beta/
#
# Usage:
#   MIKO_UPDATE_PUBLISH_CMD='bash beta/hosting/publish-rsync.sh' \
#   MIKO_RSYNC_DEST='user@host:/var/www/miko/beta/' \
#     npm run release:beta -- --version 0.1.2 --publish
set -euo pipefail

FEED_DIR="${MIKO_UPDATE_FEED_DIR:?MIKO_UPDATE_FEED_DIR is required}"
DEST="${MIKO_RSYNC_DEST:?MIKO_RSYNC_DEST is required}"

if [[ ! -d "$FEED_DIR" ]]; then
  echo "Feed dir missing: $FEED_DIR" >&2
  exit 1
fi

echo "rsync $FEED_DIR/ → $DEST"
rsync -av --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r "$FEED_DIR"/ "$DEST"
echo "Published. Verify: curl -fsSL \"\${MIKO_UPDATE_URL}beta-mac.yml\" | head"
