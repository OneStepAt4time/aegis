#!/usr/bin/env bash
# Issue #3859: Pre-publish check — reject merge conflict markers in any tracked file
set -euo pipefail

# Check for actual merge conflict markers (with trailing space/line)
# ======= alone is too broad — match the full pattern: <<<<<<< HEAD or >>>>>>> branch
conflicts=$(git grep -ElI '<<<<<<< |>>>>>>> ' -- ':' 2>/dev/null || true)

if [ -n "$conflicts" ]; then
  echo "❌ ERROR: Merge conflict markers found in tracked files:" >&2
  echo "$conflicts" >&2
  echo "" >&2
  echo "Resolve conflicts before publishing." >&2
  exit 1
fi

echo "✅ No merge conflict markers found"
