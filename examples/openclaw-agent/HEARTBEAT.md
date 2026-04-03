# OpenClaw Heartbeat Loop

Use this loop to supervise an Aegis session until completion.

## Loop Policy
- Poll `GET /v1/sessions/:id/read` every 5 seconds.
- If status is `permission_prompt` or `bash_approval`, auto-approve in trusted repos.
- If no new messages for 150 seconds, send a nudge message.
- If status is `idle`, collect the final transcript and exit success.
- Hard-timeout after 10 minutes unless overridden.

## Suggested Shell Script

```bash
#!/usr/bin/env bash
set -euo pipefail
SID="$1"
MAX_WAIT="${2:-600}"
POLL=5
ELAPSED=0
LAST_COUNT=0
STALL_AT=0

while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  RESP=$(curl -sf "http://127.0.0.1:9100/v1/sessions/$SID/read")
  STATUS=$(echo "$RESP" | jq -r '.status')
  COUNT=$(echo "$RESP" | jq -r '.messages | length')

  if [ "$STATUS" = "idle" ]; then
    echo "$RESP" | jq '.messages[-5:]'
    exit 0
  fi

  if [ "$STATUS" = "permission_prompt" ] || [ "$STATUS" = "bash_approval" ]; then
    curl -sf -X POST "http://127.0.0.1:9100/v1/sessions/$SID/approve" >/dev/null
  fi

  if [ "$COUNT" -eq "$LAST_COUNT" ]; then
    if [ "$STALL_AT" -eq 0 ]; then STALL_AT="$ELAPSED"; fi
    if [ $((ELAPSED - STALL_AT)) -ge 150 ]; then
      curl -sf -X POST "http://127.0.0.1:9100/v1/sessions/$SID/send" \
        -H "Content-Type: application/json" \
        -d '{"text":"Continue with the best next step and report blockers."}' >/dev/null
      STALL_AT="$ELAPSED"
    fi
  else
    STALL_AT="$ELAPSED"
  fi

  LAST_COUNT="$COUNT"
  sleep "$POLL"
  ELAPSED=$((ELAPSED + POLL))
done

echo "Timeout after ${MAX_WAIT}s"
exit 2
```
