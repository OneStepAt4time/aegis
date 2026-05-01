#!/usr/bin/env bash
# check-sdk-drift.sh — Fail if the tracked TypeScript SDK has drifted
# from a fresh openapi-ts generation.
#
# Runs `npm run generate` in packages/client/ then checks for
# uncommitted changes in packages/client/src/generated/.
#
# Exit 0 = clean, Exit 1 = drifted (prints diff).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$ROOT/packages/client"

echo "Regenerating TypeScript SDK from openapi.yaml…"
(cd "$CLIENT_DIR" && npm run generate)

# Check for uncommitted changes in the generated directory.
# Only compare working tree vs index (staged files). This avoids false
# positives when the developer has staged but not yet committed regenerated files.
if git -C "$ROOT" diff --quiet -- "$CLIENT_DIR/src/generated/"; then
  echo "✓ TypeScript SDK is in sync with openapi.yaml"
  exit 0
fi

echo "✗ TypeScript SDK has drifted from openapi.yaml." >&2
echo "  Fix: run 'cd packages/client && npm run generate', then commit the changes." >&2
echo "" >&2

# Show the diff
git -C "$ROOT" diff -- "$CLIENT_DIR/src/generated/" || true

exit 1
