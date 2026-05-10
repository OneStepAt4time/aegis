#!/bin/bash
# build-on-stop.sh — Build + test verification when CC agent finishes
# CC hook: Stop
#
# Issue #3170: Added guards to prevent OOM crashes in production.
# - Skips entirely when AEGIS_SERVICE is set (production systemd)
# - Skips build+test when available memory < 2GB
# - Only runs tsc --noEmit (lightweight) in memory-constrained environments

# Guard: skip entirely in production Aegis service
if [ -n "$AEGIS_SERVICE" ] || [ -f "/run/aegis-production.flag" ]; then
  echo "⏭️ Skipping build+test hook in production Aegis service"
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# TSC check (lightweight — ~200MB)
TSC_OUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "❌ TSC ERRORS — Do not merge this code:"
  echo "$TSC_OUT" | grep "error TS" | head -10
  exit 0
fi

# Guard: check available memory before heavy operations
# vitest spawns 5-6 processes consuming 4-5GB — skip if RAM is tight
AVAILABLE_KB=$(grep MemAvailable /proc/meminfo 2>/dev/null | awk '{print $2}')
if [ -n "$AVAILABLE_KB" ]; then
  AVAILABLE_GB=$((AVAILABLE_KB / 1024 / 1024))
  if [ "$AVAILABLE_GB" -lt 2 ]; then
    echo "✅ TSC clean (skipping build+test — only ${AVAILABLE_GB}GB RAM available)"
    exit 0
  fi
fi

# Full build
BUILD_OUT=$(npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "❌ BUILD FAILED:"
  echo "$BUILD_OUT" | tail -10
  exit 0
fi

# Tests
TEST_OUT=$(npm test 2>&1)
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  echo "❌ TESTS FAILED:"
  echo "$TEST_OUT" | tail -15
  exit 0
fi

# Stats
PASS_COUNT=$(echo "$TEST_OUT" | grep -oP '\d+ passed' | head -1)
echo "✅ TSC clean, build passed, $PASS_COUNT"

exit 0
