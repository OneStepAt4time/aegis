#!/bin/bash
# type-check.sh — Run TSC after every Edit/Write on .ts files
# CC hook: PostToolUse matcher Edit|Write

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only check TypeScript files
if [[ "$FILE_PATH" != *.ts ]]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || exit 0

# Quick type check
TSC_OUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  ERRORS=$(echo "$TSC_OUT" | grep "error TS" | wc -l)
  echo "❌ $ERRORS TypeScript error(s) after editing $FILE_PATH:"
  echo "$TSC_OUT" | grep "error TS" | head -5
fi

exit 0
