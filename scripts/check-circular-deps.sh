#!/usr/bin/env bash
set -euo pipefail
# Runs madge circular check
CIRC=$(npx madge --circular --extensions ts src 2>/dev/null || true)
if [ -n "$CIRC" ]; then
  echo "Circular dependencies found:";
  echo "$CIRC";
  exit 2
fi
echo "No circular dependencies found."
