# CC Hooks Knowledge — Updated 2026-03-26

## Hook Types
1. **command** — shell script, input on stdin, output on stdout, exit codes 0/1/2
2. **http** — POST JSON to URL, response body uses same JSON format as command hooks
3. **prompt** — LLM evaluates yes/no decision
4. **agent** — spawns subagent with tools (Read, Grep, Glob)

## HTTP Hooks (type: "http")
- CC POSTs event JSON to the configured URL
- Response body uses same JSON output format as command hooks
- Timeout: defaults from common fields (not specified separately, likely 10s)
- No stdin — input is the POST body

## Key Events for Aegis (#169)
- **PermissionRequest** — fires when permission dialog appears, can auto-approve/deny via response
- **Stop** — fires when Claude finishes responding
- **StopFailure** — fires on API error
- **PostToolUse** — fires after tool call succeeds
- **PreToolUse** — fires before tool call, can block
- **Notification** — fires when CC needs user input
- **SessionStart** — fires on session begin/resume
- **SessionEnd** — fires on session terminate
- **SubagentStart/Stop** — subagent lifecycle
- **TaskCompleted** — task marked complete
- **PreCompact/PostCompact** — context compaction

## PermissionRequest Response Format
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        { "type": "setMode", "mode": "acceptEdits", "destination": "session" }
      ]
    }
  }
}
```

## PreToolUse Response Format (block)
Exit code 2 or return JSON with permissionDecision: "deny"

## Stop Event
Fires when Claude finishes responding. Can return hookSpecificOutput to modify behavior.

## Matcher Patterns
- Tool events: match tool_name (Bash, Edit|Write, mcp__.*)
- SessionStart: startup, resume, clear, compact
- SessionEnd: clear, resume, logout, prompt_input_exit, bypass_permissions_disabled, other
- Notification: permission_prompt, idle_prompt, auth_success, elicitation_dialog
- SubagentStart/Stop: agent type (Bash, Explore, Plan, custom)
- StopFailure: rate_limit, authentication_failed, billing_error, invalid_request, server_error, max_output_tokens, unknown

## Settings Locations
- ~/.claude/settings.json (global)
- .claude/settings.json (project, committable)
- .claude/settings.local.json (project, gitignored)
- Plugin hooks/hooks.json
- Skill/agent frontmatter

## Async Hooks
- `async: true` — runs in background without blocking
- Cannot return decisions (fire-and-forget)

## Integration Plan for Aegis (#169)
1. POST /v1/hooks/:event endpoint on Aegis server
2. Generate CC settings.json with HTTP hooks pointing to Aegis
3. Replace tmux polling for: status detection, permission detection, stall detection
4. Keep tmux for: pane content capture, send-keys
5. SSE events now come from CC hooks, not tmux polling
