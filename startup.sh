#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8080}"

is_port_in_use() {
  ss -ltn "sport = :$PORT" | awk 'NR>1 { found=1 } END { exit found ? 0 : 1 }'
}

start_local() {
  echo ""
  if is_port_in_use; then
    echo "Port $PORT is already in use."
    echo "Open http://localhost:$PORT directly."
    if command -v firefox >/dev/null 2>&1; then
      firefox "http://localhost:$PORT" >/dev/null 2>&1 &
    fi
    return
  fi
  echo "Starting local app on port $PORT..."
  cd "$ROOT_DIR"
  node server.js >/tmp/route-rehearsal-server.log 2>&1 &
  SERVER_PID="$!"
  sleep 1
  if ! is_port_in_use; then
    echo "Server failed to start. Log: /tmp/route-rehearsal-server.log"
    return
  fi
  echo "Server running at http://localhost:$PORT"
  if command -v firefox >/dev/null 2>&1; then
    firefox "http://localhost:$PORT" >/dev/null 2>&1 &
    echo "Opened Firefox."
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1 &
  fi
  echo "Press Enter to return to menu (server keeps running)."
  read -r
}

start_public() {
  echo ""
  if is_port_in_use; then
    echo "Server already running on port $PORT"
  else
    echo "Starting HTTPS server on port $PORT..."
    cd "$ROOT_DIR"
    node server.js &
    sleep 2
  fi
  
  LOCAL_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v 127.0.0.1 | head -1)
  echo ""
  echo "✓ Server running!"
  echo "  Laptop: https://localhost:$PORT/"
  echo "  Phone:  https://$LOCAL_IP:$PORT/controller.html"
  echo ""
  echo "Note: Accept certificate warnings on both devices for gyro to work"
  echo ""
  
  if command -v firefox >/dev/null 2>&1; then
    firefox "https://localhost:$PORT/" >/dev/null 2>&1 &
    echo "Opened in Firefox."
  fi
  
  read -rp "Press Enter to return to menu..."
}

show_status() {
  echo ""
  if is_port_in_use; then
    echo "Server status: RUNNING on port $PORT"
    echo "Local URL: http://localhost:$PORT"
  else
    echo "Server status: NOT RUNNING on port $PORT"
  fi
  echo ""
  echo "Tip: if you used Ctrl+Z earlier, run 'jobs' in that terminal."
}

stop_port_processes() {
  echo ""
  local pids
  pids="$(ss -ltnp "sport = :$PORT" 2>/dev/null | awk -F'pid=' 'NR>1 && NF>1 {split($2,a,","); print a[1]}' | sort -u)"
  if [[ -z "${pids// }" ]]; then
    echo "No process found listening on port $PORT."
    return
  fi

  echo "Stopping processes on port $PORT: $pids"
  for pid in $pids; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1

  if is_port_in_use; then
    echo "Port $PORT still in use after normal stop. Running aggressive cleanup..."
    for pid in $pids; do
      kill -CONT "$pid" 2>/dev/null || true
      kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 1

    if command -v fuser >/dev/null 2>&1; then
      fuser -k -TERM "${PORT}/tcp" >/dev/null 2>&1 || true
      sleep 1
      fuser -k -KILL "${PORT}/tcp" >/dev/null 2>&1 || true
    fi

    pkill -f "node server.js" >/dev/null 2>&1 || true
    pkill -f "npm start" >/dev/null 2>&1 || true
    pkill -9 -f "node server.js" >/dev/null 2>&1 || true
    pkill -9 -f "npm start" >/dev/null 2>&1 || true
    sleep 1
  fi

  if is_port_in_use; then
    echo "Port $PORT is STILL in use (unexpected)."
    echo "Run this once manually in your current terminal:"
    echo "  fuser -k -KILL ${PORT}/tcp"
    echo "Then choose option 3 to verify status."
  else
    echo "Port $PORT is now free."
  fi
}

while true; do
  echo ""
  echo "=== Road Route Rehearsal Startup Menu ==="
  echo "1) Start public mode with ngrok (internet pairing)"
  echo "2) Show server status"
  echo "3) Stop process using port $PORT (aggressive)"
  echo "4) Exit"
  read -rp "Choose an option [1-4]: " choice

  case "$choice" in
    0) start_local ;;
    1) start_public ;;
    2) show_status ;;
    3) stop_port_processes ;;
    4) echo "Goodbye."; exit 0 ;;
    *) echo "Invalid option. Please choose 1-4." ;;
  esac
done
ss using port $PORT (aggressive)"
  echo "4) Exit"
  read -rp "Choose an option [1-4]: " choice

  case "$choice" in
    0) start_local ;;
    1) start_public ;;
    2) show_status ;;
    3) stop_port_processes ;;
    4) echo "Goodbye."; exit 0 ;;
    *) echo "Invalid option. Please choose 1-4." ;;
  esac
done
