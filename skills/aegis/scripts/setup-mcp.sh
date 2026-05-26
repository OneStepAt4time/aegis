#!/usr/bin/env bash
# Configure Aegis MCP server in Claude Code settings.
# Adds an "aegis" MCP entry to ~/.claude/settings.json or project .mcp.json.
set -euo pipefail

SCOPE="${1:-user}"
PORT="${AEGIS_PORT:-9100}"

if [ "$SCOPE" = "project" ]; then
  CONFIG_FILE=".mcp.json"
else
  CONFIG_FILE="$HOME/.claude/settings.json"
  mkdir -p "$(dirname "$CONFIG_FILE")"
fi

echo "Configuring Aegis MCP ($SCOPE scope) in $CONFIG_FILE"

# Use claude mcp add if available
if command -v claude &>/dev/null; then
  if [ "$SCOPE" = "user" ]; then
    claude mcp add --scope user aegis -- npx aegis-bridge mcp --port "$PORT"
  else
    claude mcp add --scope project aegis -- npx aegis-bridge mcp --port "$PORT"
  fi
  echo "Done. MCP server 'aegis' added via claude CLI."
  exit 0
fi

# Fallback: write JSON directly
echo "claude CLI not found. Writing config directly."

if [ ! -f "$CONFIG_FILE" ]; then
  echo '{"mcpServers":{}}' > "$CONFIG_FILE"
fi

# Use jq to add the server entry
TMP=$(mktemp)
jq --arg port "$PORT" '
  .mcpServers = (.mcpServers // {}) |
  .mcpServers.aegis = {
    "command": "npx",
    "args": ["aegis-bridge", "mcp", "--port", $port]
  }
' "$CONFIG_FILE" > "$TMP" && mv "$TMP" "$CONFIG_FILE"

echo "Done. Added 'aegis' MCP server to $CONFIG_FILE"
echo "Restart Claude Code for changes to take effect."
