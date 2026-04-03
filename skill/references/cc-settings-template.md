# Claude Code Settings Template

This is a reference template for Aegis's Claude Code settings structure. It shows the complete settings schema including all HTTP hooks that Aegis injects.

## Template

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  },
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<token>",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "MCP_CONNECTION_NONBLOCKING": "true"
  },
  "hooks": {
    "Stop": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/Stop?sessionId=<session-id>"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/PreToolUse?sessionId=<session-id>"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/PostToolUse?sessionId=<session-id>"
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/PermissionRequest?sessionId=<session-id>"
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/TaskCompleted?sessionId=<session-id>"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/Notification?sessionId=<session-id>"
          }
        ]
      }
    ],
    "TeammateIdle": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/TeammateIdle?sessionId=<session-id>"
          }
        ]
      }
    ],
    "FileChanged": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/FileChanged?sessionId=<session-id>"
          }
        ]
      }
    ],
    "CwdChanged": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/CwdChanged?sessionId=<session-id>"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/PreCompact?sessionId=<session-id>"
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:9100/v1/hooks/PostCompact?sessionId=<session-id>"
          }
        ]
      }
    ]
  }
}
```

## Hook Types

### Core Hooks (used by Aegis)
- `Stop` — Session ended
- `PreToolUse` — Before a tool is executed
- `PostToolUse` — After a tool executes
- `PermissionRequest` — Permission prompt triggered
- `TaskCompleted` — Task finished
- `Notification` — User notification available

### Telemetry Hooks (Issue #571)
- `Notification` — Real-time notifications
- `TeammateIdle` — Sub-agent idle detection
- `FileChanged` — File modification tracking
- `CwdChanged` — Working directory changes
- `PreCompact` / `PostCompact` — Context compaction detection

## Notes

- Replace `<session-id>` with the actual Aegis session UUID
- Replace `<token>` with the Anthropic API token
- `MCP_CONNECTION_NONBLOCKING=true` prevents CC from blocking on MCP server connections (Issue #931)
- Aegis injects these hooks automatically via the `--settings` flag on session creation
