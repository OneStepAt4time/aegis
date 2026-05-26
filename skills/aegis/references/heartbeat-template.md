# Heartbeat Template (Dev Loop)

Use this template to implement a polling loop that drives an Aegis session through completion. Suitable for CI/CD, automated dev loops, or supervised agent workflows.

---

## Basic Loop

```bash
#!/usr/bin/env bash
set -euo pipefail

SID="$1"
MAX_WAIT="${2:-600}"  # 10 minutes default
POLL_INTERVAL=5
ELAPSED=0
LAST_MSG_COUNT=0
STALL_START=0
STALL_THRESHOLD=150   # 2.5 minutes with no new messages

while [ $ELAPSED -lt $MAX_WAIT ]; do
  RESP=$(curl -sf http://127.0.0.1:9100/v1/sessions/$SID/read)
  STATUS=$(echo "$RESP" | jq -r '.status')
  MSG_COUNT=$(echo "$RESP" | jq -r '.messages | length')

  case "$STATUS" in
    idle)
      echo "Session $SID completed."
      echo "$RESP" | jq '.messages[-3:]'  # last 3 messages
      exit 0
      ;;
    working)
      # Stall detection
      if [ "$MSG_COUNT" -eq "$LAST_MSG_COUNT" ]; then
        if [ "$STALL_START" -eq 0 ]; then
          STALL_START=$ELAPSED
        fi
        STALLED=$((ELAPSED - STALL_START))
        if [ "$STALLED" -gt "$STALL_THRESHOLD" ]; then
          echo "STALL detected (${STALLED}s without progress). Sending nudge."
          curl -sf -X POST http://127.0.0.1:9100/v1/sessions/$SID/send \
            -H "Content-Type: application/json" \
            -d '{"text":"Continue. What is blocking you?"}'
          STALL_START=$ELAPSED  # reset stall timer
        fi
      else
        STALL_START=$ELAPSED
      fi
      LAST_MSG_COUNT=$MSG_COUNT
      ;;
    permission_prompt|bash_approval)
      echo "Approving permission prompt."
      curl -sf -X POST http://127.0.0.1:9100/v1/sessions/$SID/approve
      ;;
    plan_mode)
      echo "Approving plan (option 1)."
      curl -sf -X POST http://127.0.0.1:9100/v1/sessions/$SID/approve
      ;;
    ask_question)
      QUESTION=$(echo "$RESP" | jq -r '.messages[-1].text' 2>/dev/null)
      echo "Agent asks: $QUESTION"
      # Default: approve. Customize per use case.
      curl -sf -X POST http://127.0.0.1:9100/v1/sessions/$SID/send \
        -H "Content-Type: application/json" \
        -d '{"text":"Proceed with your best judgment."}'
      ;;
    *)
      echo "Unknown status: $STATUS. Checking pane."
      curl -sf http://127.0.0.1:9100/v1/sessions/$SID/pane | tail -20
      ;;
  esac

  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

echo "TIMEOUT after ${MAX_WAIT}s. Session may still be running."
exit 2
```

## Usage

```bash
# Create session
SID=$(curl -s -X POST http://127.0.0.1:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"workDir":"/path/to/repo","name":"task","prompt":"Implement X"}' \
  | jq -r '.id')

# Run heartbeat loop
bash heartbeat.sh $SID 600

# Check exit code: 0=done, 2=timeout
```

## Customization Points

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_WAIT` | 600s | Maximum time before timeout |
| `POLL_INTERVAL` | 5s | How often to check status |
| `STALL_THRESHOLD` | 150s | Time without progress before nudging |
| Permission handling | Auto-approve | Change to log/reject for untrusted commands |
