#!/usr/bin/env bash
# Agent bootstrap helper: list assigned open issues and save to workspace for next heartbeat.
set -euo pipefail
OUT_DIR=".openclaw"
mkdir -p "$OUT_DIR"
REPO="OneStepAt4time/aegis"
# Run gh CLI to list issues assigned to the current user (@me)
gh issue list --repo "$REPO" --assignee @me --state open --json number,title > "$OUT_DIR/assigned_issues.json" 2>/dev/null || echo '[]' > "$OUT_DIR/assigned_issues.json"
# Also write a human-readable summary
jq -r '.[] | "#\(.number) - \(.title)"' "$OUT_DIR/assigned_issues.json" > "$OUT_DIR/assigned_issues.txt" 2>/dev/null || true
