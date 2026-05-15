# CC Hooks Design for #161 — Zero-Latency Event Detection

## Overview
Use Claude Code HTTP hooks for real-time event delivery to Aegis instead of polling tmux capture-pane.

## Key Hook Events for Aegis

### 1. PermissionRequest
- **When**: Permission dialog appears
- **Matcher**: tool name (Bash, Write, Edit, etc.)
- **Input fields**: `tool_name`, `tool_input`, `permission_mode`
- **Output**: `hookSpecificOutput.decision.behavior` = "allow" | "deny"
- **Latency gain**: 0ms vs 2s polling

### 2. TaskCompleted
- **When**: Task marked as completed
- **No matcher** — fires on every occurrence
- **Input fields**: TBD (similar to Stop)
- **Use**: Detect when CC finishes a task

### 3. SubagentStart / SubagentStop
- **When**: Subagent spawned/finished
- **Matcher**: agent type (Bash, Explore, Plan, etc.)
- **Input fields**: `agent_id`, `agent_type`
- **Use**: Track subagent lifecycle

### 4. Stop
- **When**: Claude finishes responding
- **No matcher** — fires on every occurrence
- **Input fields**: `stop_reason`, `last_assistant_message`
- **Use**: Detect idle state

### 5. Notification
- **When**: CC sends a notification
- **Matcher**: notification type (permission_prompt, idle_prompt, auth_success, elicitation_dialog)
- **Use**: Already captured via JSONL

## HTTP Hook Configuration

Aegis should write to project `.claude/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:9100/v1/sessions/__SESSION_ID__/hooks/permission",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:9100/v1/sessions/__SESSION_ID__/hooks/stop",
            "timeout": 5
          }
        ]
      }
    ],
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:9100/v1/sessions/__SESSION_ID__/hooks/task-completed",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:9100/v1/sessions/__SESSION_ID__/hooks/subagent-start",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "http",
            "url": "http://127.0.0.1:9100/v1/sessions/__SESSION_ID__/hooks/subagent-stop",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

## Server Endpoints

### POST /v1/sessions/:id/hooks/permission
- Receive PermissionRequest event
- Update session state: `status: "permission_prompt"`
- Extract permission details from `tool_input`
- Emit `permission_request` event via channels
- Return `200` (allow CC to continue showing prompt to user)

### POST /v1/sessions/:id/hooks/stop
- Receive Stop event
- Update session state: `status: "idle"`
- Extract `stop_reason`
- Emit `session.idle` event via channels

### POST /v1/sessions/:id/hooks/task-completed
- Receive TaskCompleted event
- Emit `task.completed` event via channels

### POST /v1/sessions/:id/hooks/subagent-start
- Receive SubagentStart event
- Track subagent: `subagents: [{ agent_id, agent_type }]`
- Emit `subagent.start` event

### POST /v1/sessions/:id/hooks/subagent-stop
- Receive SubagentStop event
- Remove from subagent list
- Emit `subagent.stop` event

## Implementation Plan

1. **Phase 1**: Add hook endpoints to server.ts
   - Permission hook (most impactful for latency)
   - Stop hook (idle detection)

2. **Phase 2**: Modify SessionManager.createSession()
   - Write hook config to project `.claude/settings.json`
   - Inject session ID into URL template

3. **Phase 3**: Fallback strategy
   - Keep capture-pane polling as backup
   - Use hooks for primary detection, polling for missed events

4. **Phase 4**: Testing
   - Manual: verify hook receives events
   - Integration: compare hook timing vs polling timing

## Benefits
- Zero-latency permission detection (0ms vs 2s)
- Reduced tmux load (fewer capture-pane calls)
- More accurate state tracking
- Better DX (faster approval notifications)

## Notes
- Hook config must be written BEFORE CC starts in the tmux window
- Session ID injection: use placeholder `__SESSION_ID__` in URL, replace on createSession
- Timeout: 5s is reasonable for local HTTP calls
- If hook fails (non-2xx), CC continues — non-blocking
