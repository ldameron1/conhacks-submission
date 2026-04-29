#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
NGROK_API_URL="${NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"

is_port_in_use() {
  ss -ltn "sport = :$PORT" | awk 'NR>1 { found=1 } END { exit found ? 0 : 1 }'
}

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed or not in PATH."
  echo "Install it from https://ngrok.com/download and run again."
  exit 1
fi

SERVER_PID=""
NGROK_PID=""

if is_port_in_use; then
  echo "Port $PORT already in use. Reusing existing app server."
else
  echo "Starting app server on port $PORT..."
  node server.js >/tmp/route-rehearsal-server.log 2>&1 &
  SERVER_PID="$!"
  sleep 1
  if ! is_port_in_use; then
    echo "App server failed to bind port $PORT."
    echo "Server log: /tmp/route-rehearsal-server.log"
    exit 1
  fi
fi

cleanup() {
  if [[ -n "$NGROK_PID" ]] && kill -0 "$NGROK_PID" >/dev/null 2>&1; then
    kill "$NGROK_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting ngrok tunnel for http://localhost:$PORT ..."
ngrok http "$PORT" >/tmp/route-rehearsal-ngrok.log 2>&1 &
NGROK_PID="$!"
echo "ngrok process started (pid: $NGROK_PID). Waiting for public URL..."
echo "ngrok log: /tmp/route-rehearsal-ngrok.log"

PUBLIC_URL=""
for i in $(seq 1 30); do
  if ! kill -0 "$NGROK_PID" >/dev/null 2>&1; then
    echo "ngrok process exited early."
    echo "Last ngrok log lines:"
    tail -n 30 /tmp/route-rehearsal-ngrok.log || true
    exit 1
  fi

  if command -v curl >/dev/null 2>&1; then
    PUBLIC_URL="$(
      (curl -s "$NGROK_API_URL" 2>/dev/null || true) \
      | sed -n 's/.*"public_url":"\(https:[^"]*\)".*/\1/p' \
      | head -n 1
    )"
  fi
  if [[ -n "$PUBLIC_URL" ]]; then
    echo "ngrok tunnel detected on attempt $i."
    break
  fi
  echo "Waiting for ngrok API... attempt $i/30"
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "ngrok started, but public URL was not detected within 30s."
  echo "Last ngrok log lines:"
  tail -n 30 /tmp/route-rehearsal-ngrok.log || true
  echo "You can keep watching with: tail -f /tmp/route-rehearsal-ngrok.log"
else
  LAPTOP_URL="${PUBLIC_URL}/"
  PHONE_URL="${PUBLIC_URL}/controller.html"
  echo "App server log: /tmp/route-rehearsal-server.log"
  echo "Public laptop URL: $LAPTOP_URL"
  echo "Public phone controller URL: $PHONE_URL"
  echo "Open laptop URL on Firefox, then use the phone URL on mobile."

  if command -v firefox >/dev/null 2>&1; then
    firefox "$LAPTOP_URL" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$LAPTOP_URL" >/dev/null 2>&1 &
  fi
fi

echo "Press Ctrl+C to stop ngrok (and local server if started by this script)."
wait "$NGROK_PID"
