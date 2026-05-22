#!/usr/bin/env bash
# Bundle size gate — mirrors CI threshold from .github/workflows/ci.yml
set -euo pipefail

THRESHOLD_KB=2195

if [ ! -d "dist" ]; then
  echo "❌ dist/ not found — run 'npm run build' first"
  exit 1
fi

SERVER_SIZE=$(find dist/ -name "*.js" ! -path "*/__tests__/*" ! -path "*/dashboard/*" -exec du -ck {} + | tail -1 | awk '{print $1}')
SERVER_SIZE_KB=$((SERVER_SIZE))

echo "Bundle size: ${SERVER_SIZE_KB}KB (threshold: ${THRESHOLD_KB}KB)"

if [ "$SERVER_SIZE_KB" -gt "$THRESHOLD_KB" ]; then
  echo "❌ Server bundle size ${SERVER_SIZE_KB}KB exceeds ${THRESHOLD_KB}KB threshold"
  exit 1
else
  echo "✅ Within budget"
fi
