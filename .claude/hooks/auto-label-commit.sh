#!/bin/bash
# auto-label-commit.sh — Suggest labels when commit message references an issue
# CC hook: PostToolUse matcher Bash (when command contains git commit)

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

# Only trigger on git commit commands
if ! echo "$COMMAND" | grep -q "git commit"; then
  exit 0
fi

# Extract commit message from the command (heredoc or -m flag)
COMMIT_MSG=$(echo "$COMMAND" | sed -n '/-m /{s/.*-m "\([^"]*\)".*/\1/;p;}' 2>/dev/null)

if [ -z "$COMMIT_MSG" ]; then
  exit 0
fi

# Extract issue number
ISSUE_NUM=$(echo "$COMMIT_MSG" | grep -oP '#(\d+)' | grep -oP '\d+' | head -1)

if [ -z "$ISSUE_NUM" ]; then
  exit 0
fi

# Suggest labels based on commit prefix
LABELS=()
case "$COMMIT_MSG" in
  feat:*|feature:*) LABELS+=("enhancement") ;;
  fix:*|bugfix:*)    LABELS+=("bug") ;;
  docs:*)           LABELS+=("documentation") ;;
  perf:*)           LABELS+=("performance") ;;
  test:*)           LABELS+=("testing") ;;
  chore:*)          ;;  # no label suggestion
esac

if [ ${#LABELS[@]} -gt 0 ]; then
  echo "💡 Commit references #$ISSUE_NUM. Suggested labels: ${LABELS[*]}"
fi

exit 0
