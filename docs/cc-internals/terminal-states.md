# Claude Code Terminal States — Internal Reference

**Version analyzed:** Claude Code v2.1.81  
**Purpose:** Reference for the Aegis terminal-parser. Documents all UI states, transitions, permission modes, and idle/stall detection patterns extracted from the minified JS source.

---

## 1. UI State Machine

The terminal UI is driven by a React component tree. The core state function is `UQA()` which determines the current "prompt suggestion state" based on app state. The shell component (`E5f`) switches rendering based on `A.status`.

### 1.1 Top-Level Shell States (`A.status`)

| Status | Description | Visual Indicator |
|--------|-------------|-----------------|
| `"idle"` | Waiting for user input. No active task. | Input prompt visible, `❯` cursor |
| `"working"` | Claude is processing a request (API call active) | Spinner/progress indicator |
| `"responding"` | Claude is streaming a response back | Text appearing in real-time |
| `"thinking"` | Claude is in extended thinking mode | Thinking indicator |
| `"waiting"` | Waiting for user action (permission, input, etc.) | Depends on sub-state |
| `"ready"` | Session initialized, ready for input | `❯` prompt |
| `"waiting_for_login"` | Authentication required | Login prompt |
| `"completed"` | Task finished | Returns to idle |
| `"failed"` | Task errored | Error display |

### 1.2 Prompt Suggestion State (`UQA()` return values)

This function determines the overlay state shown to the user:

```js
function UQA(H) {
  if (!H.promptSuggestionEnabled) return "disabled";
  if (H.pendingWorkerRequest || H.pendingSandboxRequest) return "pending_permission";
  if (H.elicitation.queue.length > 0) return "elicitation_active";
  if (H.toolPermissionContext.mode === "plan") return "plan_mode";
  if (ZW.status !== "allowed") return "rate_limit";
  return null;  // → normal idle
}
```

| State | Condition | Meaning |
|-------|-----------|---------|
| `null` | Normal idle | No overlay, standard input prompt |
| `"disabled"` | `promptSuggestionEnabled === false` | Suggestions off (headless/API mode) |
| `"pending_permission"` | Worker or sandbox permission pending | Permission dialog shown |
| `"elicitation_active"` | Elicitation queue has items | Claude is asking a structured question |
| `"plan_mode"` | `toolPermissionContext.mode === "plan"` | Plan mode active |
| `"rate_limit"` | Rate limiter `ZW.status !== "allowed"` | Rate limited, cannot proceed |

---

## 2. Terminal String Patterns

### 2.1 Input Prompt Patterns

| Pattern | Context |
|---------|---------|
| `❯` | Main input cursor (idle state) |
| `? for shortcuts` | Keyboard shortcut hint shown at bottom |
| `Esc to cancel` | Cancel current operation |
| `Enter to confirm · Esc to cancel` | Confirmation dialog |
| `Enter to submit · Esc to cancel` | Submit dialog (edits, etc.) |
| `Edit and press Enter to retry, or Esc to cancel` | Edit retry after failure |
| `Tab to toggle · Enter to confirm · Esc to cancel` | Toggle option selection |
| `Press ↑↓ to navigate, Enter to select, Esc to cancel` | Menu/list selection |
| ` · Tab to amend` | Amend option available |

### 2.2 Status Messages

| String | Context |
|--------|---------|
| `Claude is waiting for your input` | Idle notification (notificationType: `"idle_prompt"`) |
| `[awaiting approval]` / `awaiting approval` | Permission pending |
| `Agent idle` | Agent spawned but not actively processing |
| `Still working on task #3, need 5 more minutes` | Agent progress message |
| `Loading guest pass information…` | Auth loading state |
| `Feedback cancelled` | User cancelled feedback |
| `$Canceled` | Operation cancelled marker |

### 2.3 Permission Prompt Labels

When a permission prompt appears, the user sees these options:

| Label | Value (internal) |
|-------|-----------------|
| `Yes, auto-accept edits` | `"yes-accept-edits"` |
| `Yes, clear context and auto-accept edits` | `"yes-accept-edits-keep-context"` |
| `Yes, and bypass permissions` | `"yes-bypass-permissions"` |
| `Yes, and use auto mode` | `"yes-resume-auto-mode"` |
| `Yes, clear context and bypass permissions` | (with context clear) |
| `No` | `"no"` |

### 2.4 Mode Indicator Strings

| String | Context |
|--------|---------|
| ` Fast mode (research preview)` | Fast/auto mode active indicator |
| `$Permissions` | Permission group display |
| `$PermissionsGroupBase` | Permission group component |

---

## 3. State Transitions

### 3.1 Core Flow

```
[ready/idle] → user types prompt → [working/responding] → [idle]
                                          ↓
                                     [thinking] → [responding]
                                          ↓
                                   [waiting] (permission) → user approves → [working]
                                          ↓
                                       user denies → [idle]
```

### 3.2 Permission Flow

```
[working] → tool needs permission → [waiting/permission_prompt]
    → app:interrupt fires → XA("app:interrupt", onReject, {context:"Confirmation"})
    → Permission dialog renders (component selected by tool type)
    → User approves → onDone() → [working]
    → User rejects → onReject() → [idle]
    → Esc pressed → onReject() → [idle]
```

### 3.3 Plan Mode Flow

```
[working] → plan_mode attachment received → [plan_mode]
    → Claude writes plan → shows plan content
    → User can:
        → "No, keep planning" → stays in plan_mode
        → Approve plan → plan_mode_exit → [working]
        → Esc/cancel → plan_mode_exit → [idle]
```

### 3.4 Auto Mode Flow

```
[working] → auto_mode triggered → auto-accepts permissions
    → Circuit breaker may activate:
        → "auto mode circuit breaker active (cached) — falling back to default"
        → "Auto mode classifier unavailable, falling back to normal permission handling"
    → Auto mode exits → auto_mode_exit attachment → back to manual
```

### 3.5 Elicitation Flow

```
[working] → Claude asks structured question → [elicitation_active]
    → User answers → elicitation_response
    → Claude continues → [working]
```

---

## 4. Permission System

### 4.1 Permission Modes

The permission context (`toolPermissionContext.mode`) has 4 modes:

| Mode | Value | Auto-approves | Asks for |
|------|-------|---------------|----------|
| **Default** | `"default"` | Read-only tools | File writes, bash commands, MCP tools |
| **Plan** | `"plan"` | Nothing (plan only) | All tool use blocked, plan-only mode |
| **Accept Edits** | `"acceptEdits"` | File edits | Destructive commands (rm, bash with side effects) |
| **Bypass** | `"bypassPermissions"` | Everything | Nothing — fully autonomous |

### 4.2 Permission Behaviors

Each tool check returns a behavior:

| Behavior | Meaning |
|----------|---------|
| `"allow"` | Tool is auto-approved |
| `"ask"` | User must confirm (permission prompt) |
| `"deny"` | Tool is blocked |
| `"passthrough"` | No permission check needed (internal/meta tools) |

### 4.3 Permission Context Switching

```js
// Current mode is set via:
$.current = { mode: "default" | "plan" | "acceptEdits" | "bypassPermissions" };

// The context determines what checkPermissions() returns:
// checkPermissions() → { behavior: "allow" | "ask" | "deny" | "passthrough" }
```

### 4.4 Auto Mode (Internal Permission Classifier)

Auto mode uses a classifier to decide whether to auto-approve tool use:

- `"auto_mode"` attachment triggers auto-accept
- `"auto_mode_exit"` returns to manual
- Circuit breaker conditions:
  - `"auto mode circuit breaker active (cached)"` — too many denials
  - `"Auto mode classifier transcript exceeded context window"` — transcript too long
  - `"Auto mode classifier unavailable"` — fallback to manual (fail open or fail closed)

### 4.5 Worker Permission Prompts

When agents (teammates) need permission:
- `notificationType: "worker_permission_prompt"` fires
- Message: `"${agent_id} needs permission for ${tool_name}"`
- Permission response processed via inbox polling

### 4.6 Sandbox Permission Prompts

When workers need network access:
- `notificationType: "worker_permission_prompt"` fires  
- Message: `"${workerName} needs network access to ${host}"`

---

## 5. Notification Types (Hook Events)

These are the valid notification_type values that trigger OS notifications:

| Type | Description |
|------|-------------|
| `"permission_prompt"` | Tool use needs user confirmation |
| `"idle_prompt"` | Claude has been waiting for input |
| `"auth_success"` | Authentication completed |
| `"elicitation_dialog"` | Claude is asking a structured question |
| `"elicitation_complete"` | Elicitation answered |
| `"elicitation_response"` | Elicitation response sent |

### Message Attachment Types

These appear as attachments on conversation messages to signal state changes:

```
hook_success, hook_additional_context, hook_cancelled, command_permissions,
agent_mention, budget_usd, critical_system_reminder, edited_image_file,
edited_text_file, opened_file_in_ide, output_style, plan_mode,
plan_mode_exit, plan_mode_reentry, structured_output, team_context,
todo_reminder, ultramemory, context_efficiency, deferred_tools_delta,
mcp_instructions_delta, token_usage, ultrathink_effort, max_turns_reached,
task_reminder, auto_mode, auto_mode_exit, output_token_usage,
pen_mode_enter, pen_mode_exit, verbatim
```

---

## 6. Stall / Idle Detection

### 6.1 Distinguishing "Thinking" vs "Stuck"

| Indicator | Meaning | Detection |
|-----------|---------|-----------|
| `status === "responding"` + active streaming | Claude is generating | Stream delta events arriving |
| `status === "thinking"` | Extended thinking active | Thinking token consumption |
| `status === "working"` + no change for >N seconds | Possibly stuck | Monitor for timeout |
| `status === "idle"` + `"Claude is waiting for your input"` notification | Normal idle waiting | Expected state |
| `"Agent idle"` | Spawned agent paused | Check agent status separately |

### 6.2 Idle Notification Logic

```js
// From the source — idle detection fires after threshold:
// Conditions: 
//   1. jA === 1 (active session)
//   2. e0 !== 0 (has conversation)
//   3. !Zf (not in input mode)
//   4. No active prompt/bash mode
//   5. No pending edits (hL.current === undefined)
//   6. Time elapsed >= messageIdleNotifThresholdMs

setTimeout(() => {
  if (elapsed >= messageIdleNotifThresholdMs) {
    Dg({
      message: "Claude is waiting for your input",
      notificationType: "idle_prompt"
    }, notify);
  }
}, messageIdleNotifThresholdMs);
```

### 6.3 Rate Limit State

The rate limiter (`ZW`) gates all API calls:
- `ZW.status === "allowed"` → normal operation
- `ZW.status !== "allowed"` → `"rate_limit"` state returned by `UQA()`
- When rate limited, prompt suggestions are suppressed

### 6.4 Auto-Submitting State

`"AutoSubmitting"` — Claude is in the process of auto-submitting (auto mode actively processing without user intervention).

---

## 7. Agent/Teammate States

Spawned agents have their own lifecycle states:

| Status | Description |
|--------|-------------|
| `"idle"` | Agent ready, no task |
| `"running"` | Agent actively processing |
| `"pending"` | Agent queued, waiting |
| `"completed"` | Agent finished successfully |
| `"failed"` / `"failure"` | Agent errored |
| `"killed"` | Agent terminated by user |
| `"async_launched"` | Agent spawned as background task |
| `"teammate_spawned"` | Agent created and running |
| `"searching"` | Agent is searching for context |
| `"waiting"` | Agent waiting for input/permission |
| `"started"` | Agent just started |
| `"progress"` | Agent reporting progress |

---

## 8. Terminal Parser Recommendations for Aegis

### 8.1 State Detection Priority

When parsing terminal output, check in this order:

1. **Permission prompt** → Look for `"❯"` with options, `"Esc to cancel"`, `"Enter to confirm"`
2. **Plan mode** → Look for `"plan_mode"` in attachments or plan content display
3. **Elicitation** → Look for structured question UI (input fields, not just `❯`)
4. **Working/Responding** → Stream output with `status === "responding"` or `"thinking"`
5. **Idle** → `❯` prompt alone, possibly with `"Claude is waiting for your input"` notification
6. **Rate limited** → No activity, rate limit message may appear
7. **Error** → Error message text, `status === "failed"`

### 8.2 Key Markers to Watch

```
# ACTIVE STATES (Claude is doing something):
- Streaming text output (not a prompt)
- Thinking indicator
- " Fast mode (research preview)" indicator
- Tool execution output

# BLOCKED STATES (Waiting for human):
- "Esc to cancel" (any variant)
- Permission prompt with Yes/No options
- "[awaiting approval]"
- "Claude is waiting for your input" (idle notification)

# TRANSIENT STATES:
- "Loading guest pass information…"
- Rate limit messages
- Auto mode classifier fallback messages
```

### 8.3 Anti-Stall Heuristics

```
# DEFINITELY STUCK (timeout after 120s+):
- status === "working" AND no stream delta for > 120s
- "Auto mode classifier unavailable" + no recovery
- API error with no retry

# PROBABLY WORKING (be patient):
- status === "thinking" (extended thinking can take minutes)
- status === "responding" with periodic output
- Agent status === "searching" or "progress"

# EXPECTED WAIT:
- Permission prompt visible
- "Claude is waiting for your input"
- Elicitation dialog active
```

---

## Appendix: Extracted from CC v2.1.81 minified source

### A. Shell Status Switch Statement (reconstructed)

```js
function E5f(H) {
  let { shell: A } = H;
  switch (A.status) {
    case "idle":     // → render input prompt
    case "working":  // → render progress/spinner
    case "responding": // → render streaming output
    case "thinking": // → render thinking indicator
    case "waiting":  // → render sub-state (permission, elicitation, etc.)
    case "ready":    // → render input prompt
    case "completed": // → back to idle
    case "failed":   // → render error
  }
}
```

### B. Permission Dialog Registration

```js
// Permission prompts register as interrupts:
XA("app:interrupt", onReject, { context: "Confirmation" });
jsH(toolUseContext, "permission_prompt");  // tagged for notification routing
```

### C. CLI Flags

```
--allow-dangerously-skip-permissions  → bypassPermissions mode
--permission-mode <mode>               → explicit mode selection
--append-system-prompt <prompt>        → additional system prompt
--append-system-prompt-file <file>     → system prompt from file
```
