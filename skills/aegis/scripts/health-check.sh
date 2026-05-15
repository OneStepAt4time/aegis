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
  exit 0
fi

# If response is valid JSON, assume healthy
if echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
  echo "OK (response received)"
  exit 0
fi

echo "FAIL (unexpected response: $RESPONSE)"
exit 1
