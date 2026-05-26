#!/usr/bin/env bash
# console-guard.sh — CI guard: fail if production src/ adds new console.* calls
# Existing exceptions are tracked in eslint.config.js ignores.
# This script provides a second layer: a baseline count that must not increase.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

# Count console.* calls in non-test src/ (excluding comments)
VIOLATIONS=$(grep -rn "console\.\(log\|warn\|error\)" src/ --include="*.ts" \
  | grep -v "node_modules" \
  | grep -v "__tests__" \
  | grep -v "^\s*//" \
  | grep -v "^\s*\*" \
  | wc -l)

BASELINE=165

echo "Console.* violations in src/: ${VIOLATIONS}"
echo "Baseline: ${BASELINE}"

if [ "$VIOLATIONS" -gt "$BASELINE" ]; then
  DIFF=$((VIOLATIONS - BASELINE))
  echo ""
  echo "❌ FAIL: ${DIFF} new console.* call(s) detected in production code."
  echo "   Use StructuredLogger instead, or add the file to eslint.config.js ignores."
  echo ""
  echo "New violations:"
  grep -rn "console\.\(log\|warn\|error\)" src/ --include="*.ts" \
    | grep -v "node_modules" \
    | grep -v "__tests__" \
    | grep -v "^\s*//" \
    | grep -v "^\s*\*" \
    | head -20
  exit 1
fi

if [ "$VIOLATIONS" -lt "$BASELINE" ]; then
  DIFF=$((BASELINE - VIOLATIONS))
  echo "✅ PASS: ${DIFF} violation(s) removed since baseline — consider updating BASELINE in this script."
fi

echo "✅ PASS: No new console.* violations."
exit 0
