#!/usr/bin/env bash
# Supply chain security gate — npm audit + lockfile lint
set -euo pipefail

echo "🔍 npm audit (--audit-level=high)..."
npm audit --audit-level=high

echo "🔒 lockfile-lint..."
npx lockfile-lint --type npm --path package-lock.json --validate-https

echo "✅ Supply chain checks passed"
