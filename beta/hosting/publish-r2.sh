#!/usr/bin/env bash
# Upload the local beta feed folder to Cloudflare R2 (S3-compatible).
# Secrets stay in the environment — never commit them.
#
# Required:
#   MIKO_UPDATE_FEED_DIR   (set by release-beta.mjs when --publish runs)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#   AWS_ENDPOINT_URL        e.g. https://ACCOUNTID.r2.cloudflarestorage.com
#   MIKO_R2_BUCKET
# Optional:
#   MIKO_R2_PREFIX          default miko/beta/
#   AWS_DEFAULT_REGION      default auto
#
# Usage (via release script):
#   MIKO_UPDATE_PUBLISH_CMD='bash beta/hosting/publish-r2.sh' \
#     npm run release:beta -- --version 0.1.2 --publish
set -euo pipefail

FEED_DIR="${MIKO_UPDATE_FEED_DIR:?MIKO_UPDATE_FEED_DIR is required}"
BUCKET="${MIKO_R2_BUCKET:?MIKO_R2_BUCKET is required}"
PREFIX="${MIKO_R2_PREFIX:-miko/beta/}"
PREFIX="${PREFIX#/}"
PREFIX="${PREFIX%/}/"
REGION="${AWS_DEFAULT_REGION:-auto}"
ENDPOINT="${AWS_ENDPOINT_URL:?AWS_ENDPOINT_URL is required}"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required (https://aws.amazon.com/cli/)" >&2
  exit 1
fi

if [[ ! -d "$FEED_DIR" ]]; then
  echo "Feed dir missing: $FEED_DIR" >&2
  exit 1
fi

DEST="s3://${BUCKET}/${PREFIX}"
echo "Syncing $FEED_DIR → $DEST"
aws s3 sync "$FEED_DIR" "$DEST" \
  --endpoint-url "$ENDPOINT" \
  --region "$REGION" \
  --only-show-errors

# Channel metadata must be publicly readable for electron-updater.
# Objects inherit the bucket’s public-read policy for this prefix (configure in R2).
echo "Published. Ensure HTTPS base URL serves ${PREFIX}beta-mac.yml"
echo "Example check: curl -fsSL \"\${MIKO_UPDATE_URL}beta-mac.yml\" | head"
