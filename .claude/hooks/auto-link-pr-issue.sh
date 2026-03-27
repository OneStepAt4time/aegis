#!/bin/bash
# auto-link-pr-issue.sh — Extract issue # from branch name, append "Fixes #N" to PR body
# CC hook: PostToolUse matcher mcp__github__create_pull_request

INPUT=$(cat)
HEAD_BRANCH=$(echo "$INPUT" | jq -r '.tool_input.head // empty')

if [ -z "$HEAD_BRANCH" ]; then
  exit 0
fi

# Extract issue number from branch name patterns:
# feature/42-something, fix/42-something, issue-42-something
ISSUE_NUM=$(echo "$HEAD_BRANCH" | grep -oP '(?:feature|fix|issue)[/-](\d+)' | grep -oP '\d+' | head -1)

if [ -z "$ISSUE_NUM" ]; then
  exit 0
fi

# Check if PR body already references the issue
PR_BODY=$(echo "$INPUT" | jq -r '.tool_input.body // empty')

if echo "$PR_BODY" | grep -q "Fixes #$ISSUE_NUM\|Closes #$ISSUE_NUM\|Resolves #$ISSUE_NUM"; then
  exit 0
fi

echo "💡 Branch '$HEAD_BRANCH' references issue #$ISSUE_NUM. Consider adding 'Fixes #$ISSUE_NUM' to the PR body."

exit 0
