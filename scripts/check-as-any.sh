#!/usr/bin/env bash
set -euo pipefail
# Fail if this branch introduces any new 'as any' occurrences compared to develop
BASE=${1:-origin/develop}
# Fetch develop for diff
git fetch origin develop:develop-fetch || true
DIFF=$(git diff --no-color --unified=0 $BASE...HEAD || true)
# Look for added lines containing 'as any'
ADDITIONS=$(echo "$DIFF" | grep '^+' || true)
if [ -z "$ADDITIONS" ]; then
  echo "No additions detected vs $BASE. Skipping as-any check."
  exit 0
fi
COUNT=$(echo "$ADDITIONS" | grep -E "as any" -c || true)
if [ "$COUNT" -gt 0 ]; then
  echo "New 'as any' occurrences introduced in this branch: $COUNT"
  echo "$ADDITIONS" | grep -n -E "as any" || true
  exit 2
fi
echo "No new 'as any' additions detected vs $BASE."
