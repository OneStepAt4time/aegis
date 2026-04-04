#!/usr/bin/env bash
# Verify Aegis server is running and responsive.
set -euo pipefail

HOST="${AEGIS_HOST:-127.0.0.1}"
PORT="${AEGIS_PORT:-9100}"
URL="http://$HOST:$PORT/v1/health"

echo -n "Aegis health check ($URL)... "

RESPONSE=$(curl -sf --max-time 5 "$URL" 2>/dev/null) && STATUS=$? || STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "FAIL (connection refused or timeout)"
  echo "Start Aegis: aegis-bridge start"
  exit 1
fi

STATUS_VAL=$(echo "$RESPONSE" | jq -r '.status // . // empty' 2>/dev/null)
if [ "$STATUS_VAL" = "ok" ] || [ "$STATUS_VAL" = "healthy" ]; then
  echo "OK"
else
  # If response is valid JSON, assume healthy
  if echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
    echo "OK (response received)"
  else
    echo "FAIL (unexpected response: $RESPONSE)"
    exit 1
  fi
fi

# Best-effort MCP config check
USER_CFG="$HOME/.claude/settings.json"
PROJECT_CFG=".mcp.json"
HAS_MCP=0

if [ -f "$USER_CFG" ] && jq -e '.mcpServers.aegis' "$USER_CFG" >/dev/null 2>&1; then
  HAS_MCP=1
fi

if [ -f "$PROJECT_CFG" ] && jq -e '.mcpServers.aegis' "$PROJECT_CFG" >/dev/null 2>&1; then
  HAS_MCP=1
fi

if [ "$HAS_MCP" -eq 1 ]; then
  echo "MCP config: OK (aegis server found)"
else
  echo "MCP config: MISSING"
  echo "Run: bash skill/scripts/setup-mcp.sh user"
fi

exit 0
