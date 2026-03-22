#!/bin/bash
# build-on-stop.sh — Full build + test verification when agent finishes
# CC hook: Stop

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# TSC check
TSC_OUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "❌ TSC ERRORS — Do not merge this code:"
  echo "$TSC_OUT" | grep "error TS" | head -10
  exit 0
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
