#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"
NGROK_API_URL="${NGROK_API_URL:-http://127.0.0.1:4040/api/tunnels}"
NGROK_FORWARD_TARGET="${NGROK_FORWARD_TARGET:-127.0.0.1:$PORT}"
NGROK_URL="${NGROK_URL:-}"
PUBLIC_TUNNEL_PROVIDER="${PUBLIC_TUNNEL_PROVIDER:-ngrok}"
BROWSER_UA="${BROWSER_UA:-Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36}"

read_env_value() {
  local key="$1"
  local value=""

  if [[ -f .env ]]; then
    value="$(
      awk -F= -v key="$key" '
        $0 !~ /^[[:space:]]*#/ && $1 == key {
          sub(/^[^=]*=/, "");
          print;
          exit;
        }
      ' .env
    )"
  fi

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

is_port_in_use() {
  ss -ltn "sport = :$PORT" | awk 'NR>1 { found=1 } END { exit found ? 0 : 1 }'
}

if ! command -v ngrok >/dev/null 2>&1; then
  if [[ "$PUBLIC_TUNNEL_PROVIDER" == "ngrok" ]]; then
    echo "ngrok is not installed or not in PATH."
    echo "Install it from https://ngrok.com/download and run again."
    exit 1
  fi
  echo "ngrok is not installed or not in PATH. Will try Cloudflare quick tunnel."
fi

# Re-assert the .env token every time public mode starts. This intentionally
# overwrites stale or malformed ngrok config from earlier runs.
NGROK_AUTH_TOKEN="${NGROK_AUTH_TOKEN:-$(read_env_value NGROK_AUTH_TOKEN)}"
NGROK_URL="${NGROK_URL:-$(read_env_value NGROK_URL)}"
if [[ -n "$NGROK_AUTH_TOKEN" && ( "$NGROK_AUTH_TOKEN" == "..." || "${#NGROK_AUTH_TOKEN}" -lt 20 ) ]]; then
  echo "Warning: ignoring invalid-looking NGROK_AUTH_TOKEN value; not writing it to ngrok config."
  NGROK_AUTH_TOKEN=""
fi
if command -v ngrok >/dev/null 2>&1 && [[ -n "$NGROK_AUTH_TOKEN" ]]; then
  echo "Configuring ngrok authtoken from .env/env..."
  if ! ngrok config add-authtoken "$NGROK_AUTH_TOKEN" >/tmp/route-rehearsal-ngrok-auth.log 2>&1; then
    echo "Failed to configure ngrok authtoken."
    sed 's/Your authtoken: .*/Your authtoken: [redacted]/' /tmp/route-rehearsal-ngrok-auth.log || true
    exit 1
  fi
  export NGROK_AUTHTOKEN="$NGROK_AUTH_TOKEN"
elif command -v ngrok >/dev/null 2>&1; then
  echo "Warning: NGROK_AUTH_TOKEN not found in environment or .env."
fi

SERVER_PID=""
NGROK_PID=""
CLOUDFLARED_PID=""

# Kill any leftover tunnel processes from previous runs
pkill -f "ngrok http" 2>/dev/null || true
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
sleep 1

if is_port_in_use; then
  echo "Port $PORT already in use. Reusing existing app server."
else
  echo "Starting app server on port $PORT..."
  nohup node server.js >/tmp/route-rehearsal-server.log 2>&1 &
  SERVER_PID="$!"
  sleep 2
  # Verify server actually responds
  if ! curl -s -o /dev/null http://127.0.0.1:$PORT/; then
    echo "App server failed to respond on http://127.0.0.1:$PORT"
    echo "Server log: /tmp/route-rehearsal-server.log"
    cat /tmp/route-rehearsal-server.log
    exit 1
  fi
  echo "Server responding OK."
fi

cleanup() {
  if [[ -n "$NGROK_PID" ]] && kill -0 "$NGROK_PID" >/dev/null 2>&1; then
    kill "$NGROK_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CLOUDFLARED_PID" ]] && kill -0 "$CLOUDFLARED_PID" >/dev/null 2>&1; then
    kill "$CLOUDFLARED_PID" >/dev/null 2>&1 || true
    pkill -P "$CLOUDFLARED_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

public_url_serves_app_for_browser() {
  local url="$1"
  local headers="/tmp/route-rehearsal-public-check.headers"
  local body="/tmp/route-rehearsal-public-check.html"

  if ! curl -fsS --max-time 15 -A "$BROWSER_UA" -D "$headers" "$url" -o "$body"; then
    return 1
  fi

  if grep -qi '^ngrok-error-code:' "$headers"; then
    return 2
  fi

  grep -q "Road Route Rehearsal" "$body"
}

wait_for_public_url_to_serve_app() {
  local url="$1"
  local attempts="${2:-1}"

  for i in $(seq 1 "$attempts"); do
    public_url_serves_app_for_browser "$url"
    local check_status="$?"
    if [[ "$check_status" -eq 0 ]]; then
      return 0
    fi
    if [[ "$check_status" -eq 2 ]]; then
      return 2
    fi
    if [[ "$i" -lt "$attempts" ]]; then
      echo "Waiting for public URL to serve app... attempt $i/$attempts"
      sleep 2
    fi
  done

  return 1
}

start_ngrok_tunnel() {
  if ! command -v ngrok >/dev/null 2>&1; then
    return 1
  fi

  echo "Starting ngrok tunnel for port $PORT ..."
  if [[ -n "$NGROK_URL" ]]; then
    nohup ngrok http "$NGROK_FORWARD_TARGET" --url "$NGROK_URL" --log stdout >/tmp/route-rehearsal-ngrok.log 2>&1 &
  else
    nohup ngrok http "$NGROK_FORWARD_TARGET" --log stdout >/tmp/route-rehearsal-ngrok.log 2>&1 &
  fi
  NGROK_PID="$!"
  echo "ngrok process started (pid: $NGROK_PID). Waiting for public URL..."
  echo "ngrok forwarding target: $NGROK_FORWARD_TARGET"
  echo "ngrok log: /tmp/route-rehearsal-ngrok.log"

  PUBLIC_URL=""
  for i in $(seq 1 30); do
    if ! kill -0 "$NGROK_PID" >/dev/null 2>&1; then
      echo "ngrok process exited early."
      echo "Last ngrok log lines:"
      tail -n 30 /tmp/route-rehearsal-ngrok.log || true
      return 1
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
    return 1
  fi

  wait_for_public_url_to_serve_app "${PUBLIC_URL}/" 1
  local check_status="$?"
  if [[ "$check_status" -ne 0 ]]; then
    if [[ "$check_status" == "2" ]]; then
      echo "ngrok returned its browser warning page instead of the app for normal browsers."
      echo "This is ngrok's free-domain interstitial. On the laptop and phone, wait for it and tap Visit Site once."
      echo "If the warning page stays blank, refresh; use a paid/custom NGROK_URL to remove this ngrok behavior."
      return 0
    else
      echo "ngrok public URL was detected, but the app did not respond through it for a browser check."
      echo "Last ngrok log lines:"
      tail -n 30 /tmp/route-rehearsal-ngrok.log || true
      return 2
    fi
  fi

  return 0
}

start_cloudflare_tunnel() {
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx is not available, so Cloudflare quick tunnel fallback cannot start."
    return 1
  fi

  echo "Starting Cloudflare quick tunnel fallback for port $PORT ..."
  nohup npx --yes cloudflared tunnel --url "http://127.0.0.1:$PORT" --protocol http2 --no-autoupdate >/tmp/route-rehearsal-cloudflared.log 2>&1 &
  CLOUDFLARED_PID="$!"
  echo "cloudflared process started (pid: $CLOUDFLARED_PID). Waiting for public URL..."
  echo "cloudflared log: /tmp/route-rehearsal-cloudflared.log"

  PUBLIC_URL=""
  for i in $(seq 1 45); do
    if ! kill -0 "$CLOUDFLARED_PID" >/dev/null 2>&1; then
      echo "cloudflared process exited early."
      echo "Last cloudflared log lines:"
      tail -n 30 /tmp/route-rehearsal-cloudflared.log || true
      return 1
    fi

    PUBLIC_URL="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' /tmp/route-rehearsal-cloudflared.log | head -n 1 || true)"
    if [[ -n "$PUBLIC_URL" ]]; then
      echo "Cloudflare tunnel detected on attempt $i."
      break
    fi
    echo "Waiting for Cloudflare tunnel... attempt $i/45"
    sleep 1
  done

  if [[ -z "$PUBLIC_URL" ]]; then
    echo "cloudflared started, but public URL was not detected within 45s."
    echo "Last cloudflared log lines:"
    tail -n 30 /tmp/route-rehearsal-cloudflared.log || true
    return 1
  fi

  wait_for_public_url_to_serve_app "${PUBLIC_URL}/" 20
  local check_status="$?"
  if [[ "$check_status" -ne 0 ]]; then
    echo "Cloudflare public URL was detected, but the app did not respond through it for a browser check."
    echo "Last cloudflared log lines:"
    tail -n 30 /tmp/route-rehearsal-cloudflared.log || true
    return 1
  fi

  return 0
}

case "$PUBLIC_TUNNEL_PROVIDER" in
  ngrok)
    start_ngrok_tunnel || exit 1
    ;;
  cloudflare)
    start_cloudflare_tunnel || exit 1
    ;;
  auto)
    if ! start_ngrok_tunnel; then
      if [[ -n "$NGROK_PID" ]] && kill -0 "$NGROK_PID" >/dev/null 2>&1; then
        kill "$NGROK_PID" >/dev/null 2>&1 || true
        NGROK_PID=""
      fi
      echo "Falling back to Cloudflare quick tunnel for browser-compatible public access."
      start_cloudflare_tunnel || exit 1
    fi
    ;;
  *)
    echo "Unknown PUBLIC_TUNNEL_PROVIDER: $PUBLIC_TUNNEL_PROVIDER"
    echo "Use auto, ngrok, or cloudflare."
    exit 1
    ;;
esac

if [[ -n "$PUBLIC_URL" ]]; then
  LAPTOP_URL="${PUBLIC_URL}/"
  PHONE_URL="${PUBLIC_URL}/controller.html"
  echo "App server log: /tmp/route-rehearsal-server.log"
  echo "Public laptop URL: $LAPTOP_URL"
  echo "Public phone controller URL: $PHONE_URL"
  LAN_IPS="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v '^127\.' || true)"
  if [[ -n "$LAN_IPS" ]]; then
    echo "Same-Wi-Fi fallback phone URL(s):"
    while IFS= read -r lan_ip; do
      [[ -n "$lan_ip" ]] && echo "  - http://$lan_ip:$PORT/controller.html"
    done <<< "$LAN_IPS"
  fi
  echo "Open laptop URL on Firefox, then use the phone URL on mobile."

  if command -v firefox >/dev/null 2>&1; then
    firefox "$LAPTOP_URL" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$LAPTOP_URL" >/dev/null 2>&1 &
  fi
fi

echo "Press Ctrl+C to stop the public tunnel (and local server if started by this script)."
if [[ -n "$NGROK_PID" ]]; then
  wait "$NGROK_PID"
elif [[ -n "$CLOUDFLARED_PID" ]]; then
  wait "$CLOUDFLARED_PID"
fi
