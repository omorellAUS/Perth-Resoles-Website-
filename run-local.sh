#!/usr/bin/env bash
# Local trial of the Square checkout (SANDBOX ONLY).
# Writes .dev.vars from your environment, then starts `wrangler dev` on http://localhost:8787
#   export SQUARE_SANDBOX_ACCESS_TOKEN=...   (from developer.squareup.com > your app > Sandbox)
#   ./run-local.sh
# Without a sandbox token it runs in DRY_RUN mode (mock checkout, shows the Square request).
# It never uses a production token and never prints the token.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8787}"

umask 077
if [ -n "${SQUARE_SANDBOX_ACCESS_TOKEN:-}" ]; then
  {
    printf 'SQUARE_ACCESS_TOKEN=%s\n' "$SQUARE_SANDBOX_ACCESS_TOKEN"
    printf 'SQUARE_ENV=sandbox\n'
    printf 'SQUARE_LOCATION_ID=%s\n' "${SQUARE_SANDBOX_LOCATION_ID:-}"
    printf 'SQUARE_DRY_RUN=false\n'
  } > .dev.vars
  echo "Sandbox token found: real Square SANDBOX checkouts (test cards only, no real money)."
else
  {
    printf 'SQUARE_ENV=sandbox\n'
    printf 'SQUARE_DRY_RUN=true\n'
  } > .dev.vars
  echo "No SQUARE_SANDBOX_ACCESS_TOKEN set: DRY_RUN mode (mock checkout URL, no Square calls)."
fi

[ -d node_modules/wrangler ] || npm install --no-audit --no-fund
export WRANGLER_SEND_METRICS=false
exec npx wrangler dev --port "$PORT" --ip 127.0.0.1
