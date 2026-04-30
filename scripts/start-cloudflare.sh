#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8080}"

is_port_in_use() {
  ss -ltn "sport = :$PORT" | awk 'NR>1 { found=1 } END { exit found ? 0 : 1 }'
}

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared to ~/.local/bin..."
  mkdir -p ~/.local/bin
  curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared
  chmod +x ~/.local/bin/cloudflared
  export PATH="$HOME/.local/bin:$PATH"
fi

pkill -f "cloudflared tunnel" 2>/dev/null || true
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
  pkill -f "cloudflared tunnel" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Starting Cloudflare tunnel..."
cloudflared tunnel --url http://localhost:$PORT --protocol http2 2>&1 | tee /tmp/route-rehearsal-tunnel.log &
TUNNEL_PID=$!

for i in {1..30}; do
  URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/route-rehearsal-tunnel.log 2>/dev/null | head -1 || true)
  if [[ -n "$URL" ]]; then
    echo ""
    echo "✓ Tunnel ready!"
    echo "  Laptop: $URL/"
    echo "  Phone:  $URL/controller.html"
    echo ""
    firefox "$URL/" >/dev/null 2>&1 &
    break
  fi
  sleep 1
done

wait $TUNNEL_PID
