#!/usr/bin/env bash
# Simple headless check for 'ag mcp' — uses npx when available, falls back to local dist/cli.js
set -euo pipefail
PORT=${1:-9112}
TMPLOG=$(mktemp /tmp/ag-mcp.XXXX.log)
PIDFILE=$(mktemp /tmp/ag-mcp-pid.XXXX)

run_cmd() {
  if command -v npx >/dev/null 2>&1; then
    echo "Using npx to run aegis CLI (if package published)"
    npx @onestepat4time/aegis mcp --port "$PORT" >"$TMPLOG" 2>&1 &
  else
    echo "npx not available — using local dist/cli.js"
    node dist/cli.js mcp --port "$PORT" >"$TMPLOG" 2>&1 &
  fi
  echo $! >"$PIDFILE"
}

after() {
  if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE")" >/dev/null 2>&1 || true
    rm -f "$PIDFILE"
  fi
  if [ -f "$TMPLOG" ]; then
    echo "--- LOG (last 200 lines) ---"
    tail -n 200 "$TMPLOG" || true
    rm -f "$TMPLOG"
  fi
}

trap after EXIT

run_cmd
# Give it a moment to start and settle
sleep 1
PID=$(cat "$PIDFILE")
if ps -p "$PID" >/dev/null 2>&1; then
  echo "ag mcp started (pid=$PID) — headless invocation appears to work"
  # Optionally send a minimal signal or write to stdout
  exit 0
else
  echo "ag mcp did not stay running — check log"
  exit 2
fi
