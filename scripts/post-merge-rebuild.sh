#!/usr/bin/env bash
# post-merge-rebuild.sh — Rebuild dist/ and restart Aegis after pulling develop
#
# Install as a git post-merge hook:
#   cp scripts/post-merge-rebuild.sh .git/hooks/post-merge
#   chmod +x .git/hooks/post-merge
#
# Or run manually:
#   ./scripts/post-merge-rebuild.sh
#
# What it does:
#   1. Detects if the current branch is develop
#   2. Runs npm ci && npm run build
#   3. Restarts the Aegis service (systemd or pm2, auto-detected)
#
# Environment variables:
#   AEGIS_SKIP_RESTART=1 — skip service restart (build only)
#   AEGIS_SERVICE_NAME   — override service name (default: aegis)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${AEGIS_SERVICE_NAME:-aegis}"
SKIP_RESTART="${AEGIS_SKIP_RESTART:-0}"

cd "$REPO_DIR"

# 1. Only run on develop branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$BRANCH" != "develop" ]; then
  echo "post-merge-rebuild: skipping (branch is '$BRANCH', not 'develop')"
  exit 0
fi

echo "post-merge-rebuild: detected develop update, rebuilding..."

# 2. Install deps and build
if ! npm ci --ignore-scripts 2>&1; then
  echo "::error::npm ci failed — aborting rebuild"
  exit 1
fi

if ! npm run build 2>&1; then
  echo "::error::npm run build failed — NOT restarting (stale dist/ preserved)"
  exit 1
fi

echo "post-merge-rebuild: build succeeded"

# 3. Verify dist/ is fresh
JS_COUNT=$(find dist -name '*.js' 2>/dev/null | wc -l)
if [ "$JS_COUNT" -eq 0 ]; then
  echo "::error::dist/ is empty after build — NOT restarting"
  exit 1
fi
echo "post-merge-rebuild: dist/ contains $JS_COUNT JS files"

# 4. Restart service (if not skipped)
if [ "$SKIP_RESTART" = "1" ]; then
  echo "post-merge-rebuild: restart skipped (AEGIS_SKIP_RESTART=1)"
  exit 0
fi

# Auto-detect service manager
if systemctl --user list-units "$SERVICE_NAME.service" &>/dev/null 2>&1; then
  echo "post-merge-rebuild: restarting systemd user service '$SERVICE_NAME'..."
  systemctl --user restart "$SERVICE_NAME"
  echo "post-merge-rebuild: ✅ service restarted"
elif systemctl list-units "$SERVICE_NAME.service" &>/dev/null 2>&1; then
  echo "post-merge-rebuild: restarting system service '$SERVICE_NAME'..."
  sudo systemctl restart "$SERVICE_NAME"
  echo "post-merge-rebuild: ✅ service restarted"
elif command -v pm2 &>/dev/null; then
  echo "post-merge-rebuild: restarting via pm2..."
  pm2 restart "$SERVICE_NAME" 2>/dev/null || pm2 restart all
  echo "post-merge-rebuild: ✅ pm2 restarted"
else
  echo "post-merge-rebuild: ⚠️  no service manager detected — rebuild complete but manual restart required"
  echo "  Run: node dist/server.js"
fi
