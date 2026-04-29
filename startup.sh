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
    echo "Use option 4 to stop existing process first, or open http://localhost:$PORT directly."
    return
  fi
  echo "Starting local app on port $PORT..."
  cd "$ROOT_DIR"
  npm start
}

start_public() {
  echo ""
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "ngrok is not installed or not in PATH."
    echo "Install it from: https://ngrok.com/download"
    return
  fi
  cd "$ROOT_DIR"
  if ! bash scripts/start-public.sh; then
    echo "Public mode exited with an error. Returning to menu."
    echo "Tip: ensure ngrok is authenticated (`ngrok config add-authtoken ...`)."
  fi
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
  echo "=== Route Rehearsal Startup Menu ==="
  echo "1) Start public mode with ngrok (internet pairing)"
  echo "2) Show server status"
  echo "3) Stop process using port $PORT (aggressive)"
  echo "4) Exit"
  read -rp "Choose an option [1-4]: " choice

  case "$choice" in
    1) start_public ;;
    2) show_status ;;
    3) stop_port_processes ;;
    4) echo "Goodbye."; exit 0 ;;
    *) echo "Invalid option. Please choose 1-4." ;;
  esac
done
