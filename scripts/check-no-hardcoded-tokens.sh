#!/usr/bin/env bash
# check-no-hardcoded-tokens.sh
# Scans tracked files for hardcoded secret patterns that should be env vars.
# Used as a pre-push/CI guard to prevent accidental token leaks.
#
# Exit 0 if clean, exit 1 if tokens found.

set -euo pipefail

PATTERNS=(
  'gho_[a-zA-Z0-9]{36}'
  'ghp_[a-zA-Z0-9]{36}'
  'ghu_[a-zA-Z0-9]{36}'
  'ghs_[a-zA-Z0-9]{36}'
  'sbp_[a-zA-Z0-9]{30,}'
)

FOUND=0

# Only scan tracked files (respect .gitignore), exclude test fixtures
TRACKED_FILES=$(git ls-files -- ':!*.lock' ':!package-lock.json' ':!pnpm-lock.yaml' ':!*.test.ts' ':!*.test.js')

for file in $TRACKED_FILES; do
  for pattern in "${PATTERNS[@]}"; do
    # Use grep with perl regex for word boundaries
    if grep -Pn "$pattern" "$file" 2>/dev/null; then
      echo "ERROR: Hardcoded token pattern '$pattern' found in $file" >&2
      FOUND=1
    fi
  done
done

if [ "$FOUND" -ne 0 ]; then
  echo "" >&2
  echo "FAIL: Hardcoded tokens detected. Move secrets to environment variables." >&2
  echo "See docs/security-best-practices.md → MCP Configuration Secrets" >&2
  exit 1
fi

echo "OK: No hardcoded tokens in tracked files."
exit 0
