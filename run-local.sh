#!/usr/bin/env bash
# Local trial of the Square checkout + order automation (SANDBOX ONLY).
# Writes .dev.vars from your environment, then starts `wrangler dev` on http://localhost:8787
#   export SQUARE_SANDBOX_ACCESS_TOKEN=...   (from developer.squareup.com > your app > Sandbox)
#   optional: SHEET_WEBHOOK_URL, SHEET_WEBHOOK_SECRET, SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL
#   ./run-local.sh
# Without a sandbox token it runs in DRY_RUN mode (mock checkout, shows the Square request).
# It never uses a production token and never prints any token.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"

umask 077
{
  if [ -n "${SQUARE_SANDBOX_ACCESS_TOKEN:-}" ]; then
    printf 'SQUARE_ACCESS_TOKEN=%s\n' "$SQUARE_SANDBOX_ACCESS_TOKEN"
    printf 'SQUARE_DRY_RUN=false\n'
  else
    printf 'SQUARE_DRY_RUN=true\n'
  fi
  printf 'SQUARE_ENV=sandbox\n'
  printf 'SQUARE_LOCATION_ID=%s\n' "${SQUARE_SANDBOX_LOCATION_ID:-}"
  printf 'SHEET_WEBHOOK_URL=%s\n' "${SHEET_WEBHOOK_URL:-}"
  printf 'SHEET_WEBHOOK_SECRET=%s\n' "${SHEET_WEBHOOK_SECRET:-}"
  printf 'SQUARE_WEBHOOK_SIGNATURE_KEY=%s\n' "${SQUARE_WEBHOOK_SIGNATURE_KEY:-}"
  printf 'SQUARE_WEBHOOK_URL=%s\n' "${SQUARE_WEBHOOK_URL:-http://localhost:$PORT/api/square-webhook}"
} > .dev.vars
if [ -n "${SQUARE_SANDBOX_ACCESS_TOKEN:-}" ]; then
  echo "Sandbox token found: real Square SANDBOX checkouts (test cards only, no real money)."
else
  echo "No SQUARE_SANDBOX_ACCESS_TOKEN set: DRY_RUN mode (mock checkout URL, no Square calls)."
fi
[ -n "${SHEET_WEBHOOK_URL:-}" ] && echo "Paid orders will be sent to SHEET_WEBHOOK_URL." || echo "SHEET_WEBHOOK_URL not set: paid orders are not sent anywhere."

[ -d node_modules/wrangler ] || npm install --no-audit --no-fund
export WRANGLER_SEND_METRICS=false
exec npx wrangler dev --port "$PORT" --ip 127.0.0.1
