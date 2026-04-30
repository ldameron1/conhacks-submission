#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"

is_port_in_use() {
  ss -ltn "sport = :$PORT" | awk 'NR>1 { found=1 } END { exit found ? 0 : 1 }'
}

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Install Node.js first."
  exit 1
fi

# Kill only the actual tunnel processes, not this script
pkill -9 -f "node.*localtunnel" 2>/dev/null || true
pkill -9 cloudflared 2>/dev/null || true
pkill -9 ngrok 2>/dev/null || true
rm -f /tmp/route-rehearsal-tunnel.log
sleep 1

if is_port_in_use; then
  echo "Port $PORT already in use. Reusing existing server."
else
  echo "Starting server on port $PORT..."
  nohup node server.js >/tmp/route-rehearsal-server.log 2>&1 &
  sleep 2
  if ! curl -s -o /dev/null http://127.0.0.1:$PORT/; then
    echo "Server failed to start."
    exit 1
  fi
fi

cleanup() {
  pkill -f "node.*localtunnel" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting localtunnel (this may take 10-15 seconds)..."
npx -y localtunnel --port $PORT > /tmp/route-rehearsal-tunnel.log 2>&1 &
TUNNEL_PID=$!

for i in {1..30}; do
  URL=$(grep -oP 'https://[a-z0-9-]+\.loca\.lt' /tmp/route-rehearsal-tunnel.log 2>/dev/null | head -1 || true)
  if [[ -n "$URL" ]]; then
    echo ""
    echo "✓ Tunnel ready!"
    echo "  Laptop: $URL/"
    echo "  Phone:  $URL/controller.html"
    echo ""
    echo "Note: First visit may show a warning page - click 'Continue' to proceed."
    firefox "$URL/" >/dev/null 2>&1 &
    break
  fi
  sleep 1
done

wait $TUNNEL_PID
