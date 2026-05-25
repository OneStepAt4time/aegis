#!/usr/bin/env bash
set -euo pipefail
THRESHOLD=${1:-500}
# Find TypeScript files in src/ exceeding threshold
FOUND=0
# Use git ls-files to respect repo file set
FILES=$(git ls-files 'src/**/*.ts' || true)
if [ -z "$FILES" ]; then
  echo "No files found under src/."
  exit 0
fi
for f in $FILES; do
  LINES=$(wc -l < "$f" || echo 0)
  if [ "$LINES" -gt "$THRESHOLD" ]; then
    echo "FILE_TOO_LARGE: $f ($LINES lines)"
    FOUND=1
  fi
done
if [ "$FOUND" -eq 1 ]; then
  echo "One or more files exceed $THRESHOLD lines. Please split or get approval from Argus+Hephaestus."
  exit 2
fi
echo "File-size check passed (<= $THRESHOLD lines)."
