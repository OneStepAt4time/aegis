#!/usr/bin/env bash
# aegis-healthcheck.sh — Periodic health probe for Aegis.
#
# Called by aegis-healthcheck.timer every 60 seconds.
# Pings the /health endpoint and sends an alert on failure.
#
# Required environment:
#   AEGIS_FAILURE_WEBHOOK — webhook URL for alerts
#
# Optional environment:
#   AEGIS_HEALTH_TOKEN    — bearer token for /health endpoint
#   AEGIS_PORT            — server port (default: 9100)
#
# Install:
#   sudo cp aegis-healthcheck.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/aegis-healthcheck.sh
#   sudo systemctl enable --now aegis-healthcheck.timer

set -euo pipefail

PORT="${AEGIS_PORT:-9100}"
WEBHOOK_URL="${AEGIS_FAILURE_WEBHOOK:-}"
TOKEN="${AEGIS_HEALTH_TOKEN:-}"
HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Build curl auth header
AUTH_HEADER=""
if [ -n "$TOKEN" ]; then
  AUTH_HEADER="-H \"Authorization: Bearer $TOKEN\""
fi

# Health check — allow 5s for response
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time 5 \
  $AUTH_HEADER \
  "http://127.0.0.1:${PORT}/health" 2>/dev/null || echo '000')"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  # Healthy — exit cleanly
  exit 0
fi

# Unhealthy — send alert
echo "[aegis-healthcheck] Health check FAILED (HTTP $HTTP_CODE) at ${TIMESTAMP}" >&2

if [ -z "$WEBHOOK_URL" ]; then
  echo "[aegis-healthcheck] AEGIS_FAILURE_WEBHOOK not set. Skipping notification." >&2
  exit 1
fi

read -r -d '' PAYLOAD << EOF || true
{
  "content": "⚠️ **Aegis health check failed** on \`${HOSTNAME}\`",
  "embeds": [{
    "title": "Health Check Failure",
    "color": 16776960,
    "fields": [
      {"name": "Host", "value": "${HOSTNAME}", "inline": true},
      {"name": "Time (UTC)", "value": "${TIMESTAMP}", "inline": true},
      {"name": "HTTP Status", "value": "${HTTP_CODE}", "inline": true},
      {"name": "Endpoint", "value": "http://127.0.0.1:${PORT}/health", "inline": true},
      {"name": "Action", "value": "Check \`systemctl status aegis\` and \`journalctl -u aegis -n 50\`.", "inline": false}
    ],
    "footer": {"text": "aegis-healthcheck (systemd timer)"}
  }]
}
EOF

ALERT_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  --max-time 10 \
  -d "$PAYLOAD" \
  "$WEBHOOK_URL" 2>/dev/null || echo '000')"

echo "[aegis-healthcheck] Alert sent (HTTP $ALERT_CODE)"
exit 1
