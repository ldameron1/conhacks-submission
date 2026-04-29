#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOGFILE="/tmp/route-rehearsal-local.log"

# Start server on an ephemeral port (0 = kernel picks)
PORT=0 node server.js >"$LOGFILE" 2>&1 &
SERVER_PID="$!"

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# Wait for server to bind and extract the actual port
URL=""
for i in $(seq 1 30); do
  URL="$(grep -oP 'http://localhost:[0-9]+' "$LOGFILE" | head -n 1 || true)"
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 0.2
done

if [[ -z "$URL" ]]; then
  echo "Server failed to start. Log:"
  cat "$LOGFILE"
  exit 1
fi

echo "Server running at $URL"
echo "Opening Firefox..."

if command -v firefox >/dev/null 2>&1; then
  firefox "$URL" >/dev/null 2>&1 &
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
else
  echo "Firefox not found. Open $URL manually."
fi

echo "Press Ctrl+C to stop."
wait "$SERVER_PID"
