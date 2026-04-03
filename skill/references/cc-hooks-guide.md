# Claude Code Hooks Guide

Aegis uses Claude Code's HTTP hook system to track session events and orchestrate CC sessions.

## Available Hooks

| Hook Event | When Called | Aegis Use |
|------------|-------------|-----------|
| `SessionStart` | CC session starts | Track active sessions |
| `SessionEnd` | CC session ends | Cleanup, metrics |
| `Stop` | User stops CC | Detect completion |
| `StopFailure` | CC crashes/stops unexpectedly | Error reporting |
| `PreToolUse` | Before any tool runs | Permission checks, logging |
| `PostToolUse` | After any tool completes | Result capture |
| `PostToolUseFailure` | After tool fails | Error tracking |
| `PermissionRequest` | CC asks for permission | Auto-approve (configurable) |
| `TaskCompleted` | Task finishes | Result delivery |
| `UserPromptSubmit` | User sends a prompt | Prompt logging |
| `SubagentStart` | Sub-agent is spawned | Swarm tracking |
| `SubagentStop` | Sub-agent stops | Swarm tracking |
| `Notification` | CC sends notification | Event relay |
| `TeammateIdle` | Teammate goes idle | Status updates |

## How Aegis Registers Hooks

Aegis generates a per-session `settings.local.json` with HTTP hooks pointing to its receiver:

```
http://localhost:9100/v1/hooks/<EventName>?sessionId=<sessionId>&secret=<secret>
```

The hook URL includes:
- `sessionId` — Routes the event to the correct session
- `secret` — HMAC authentication (prevents spoofing)

## Adding Custom Hooks

To add your own hooks alongside Aegis hooks:

1. Edit `.claude/settings.local.json` (NOT distributed — contains secrets)
2. Aegis deep-merges its hooks with yours

## Hook Request Format

```typescript
interface HookRequest {
  type: 'hook';
  hook: {
    name: string;        // Event name, e.g. 'Stop'
    payload: unknown;    // Event-specific data
  };
  sessionId: string;
  timestamp: string;
  secret?: string;       // HMAC secret for verification
}
```

## Security Notes

- Hook URLs contain per-session secrets — never share `settings.local.json`
- Aegis verifies HMAC signatures on all incoming hook requests
- Stale hooks from dead sessions are automatically cleaned up on restart
