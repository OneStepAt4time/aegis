#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔧 Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

echo ""
echo "🏃 Running docs walk-through..."
echo ""

npm test
