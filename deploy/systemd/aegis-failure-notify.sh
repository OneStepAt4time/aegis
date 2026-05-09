#!/usr/bin/env bash
# aegis-failure-notify.sh — Called by systemd OnFailure when Aegis enters failed state.
#
# Sends a webhook notification (Discord/Slack/generic) with failure details.
#
# Required environment:
#   AEGIS_FAILURE_WEBHOOK — webhook URL for crash alerts
#
# Optional environment:
#   AEGIS_HEALTH_TOKEN    — bearer token for /health endpoint
#   AEGIS_PORT            — server port (default: 9100)
#
# Install:
#   sudo cp aegis-failure-notify.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/aegis-failure-notify.sh

set -euo pipefail

WEBHOOK_URL="${AEGIS_FAILURE_WEBHOOK:-}"
PORT="${AEGIS_PORT:-9100}"
HOSTNAME="$(hostname -f 2>/dev/null || hostname)"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [ -z "$WEBHOOK_URL" ]; then
  echo "[aegis-failure-notify] AEGIS_FAILURE_WEBHOOK not set. Skipping notification." >&2
  exit 0
fi

# Gather service status
SERVICE_STATUS="$(systemctl show aegis.service --no-pager --property=ActiveState,SubState,ExecMainStatus,ExecMainPID,ActiveEnterTimestamp,NRestarts 2>/dev/null || echo 'unavailable')"
JOURNAL_TAIL="$(journalctl -u aegis.service --no-pager -n 20 --output=short-iso 2>/dev/null || echo 'unavailable')"

# Build payload (Discord-compatible webhook format)
read -r -d '' PAYLOAD << EOF || true
{
  "content": "🚨 **Aegis server entered failed state** on \`${HOSTNAME}\`",
  "embeds": [{
    "title": "Service Failure Alert",
    "color": 15158332,
    "fields": [
      {"name": "Host", "value": "${HOSTNAME}", "inline": true},
      {"name": "Time (UTC)", "value": "${TIMESTAMP}", "inline": true},
      {"name": "Service Status", "value": "$(echo "$SERVICE_STATUS" | tr '\n' ' ' | head -c 200)", "inline": false},
      {"name": "Action", "value": "Restart attempts exhausted. Manual intervention required. Run \`systemctl status aegis\` for details.", "inline": false}
    ],
    "footer": {"text": "aegis-failure-notify (systemd OnFailure)"}
  }]
}
EOF

# Send notification
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  --max-time 10 \
  -d "$PAYLOAD" \
  "$WEBHOOK_URL" 2>/dev/null || echo '000')"

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "[aegis-failure-notify] Alert sent successfully (HTTP $HTTP_CODE)"
else
  echo "[aegis-failure-notify] Failed to send alert (HTTP $HTTP_CODE)" >&2
  exit 1
fi
