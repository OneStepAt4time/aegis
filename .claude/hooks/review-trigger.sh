#!/bin/bash
# review-trigger.sh — Log new PRs to review queue for scheduled agent
# CC hook: PostToolUse matcher mcp__github__create_pull_request

INPUT=$(cat)
TOOL_RESULT=$(echo "$INPUT" | jq -r '.tool_result // empty' 2>/dev/null)

# Extract PR number from the tool result (the create_pull_request response)
PR_NUMBER=$(echo "$TOOL_RESULT" | jq -r '.number // empty' 2>/dev/null)

if [ -z "$PR_NUMBER" ]; then
  exit 0
fi

QUEUE_DIR="$HOME/.aegis"
QUEUE_FILE="$QUEUE_DIR/review-queue.jsonl"

mkdir -p "$QUEUE_DIR"
echo "{\"pr_number\":$PR_NUMBER,\"timestamp\":\"$(date -Iseconds)\",\"status\":\"pending_review\"}" >> "$QUEUE_FILE"

echo "📝 PR #$PR_NUMBER added to review queue ($QUEUE_FILE)"

exit 0
