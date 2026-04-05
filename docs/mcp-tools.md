# MCP Tools Reference

Aegis exposes 25 tools and 3 prompts via the MCP (Model Context Protocol) server. These tools allow Claude Code and other MCP hosts to manage sessions, read transcripts, orchestrate pipelines, and share state.

## Setup

```bash
claude mcp add aegis -- npx aegis-bridge mcp
```

This connects Claude Code to the Aegis MCP server running on `localhost:9100`.

## Tools

### Session Management

#### `list_sessions`

List Aegis-managed Claude Code sessions. Optionally filter by status or workDir substring.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `status` | string | no | Filter by status (`idle`, `working`, `permission_prompt`) |
| `workDir` | string | no | Filter by workDir substring |

**Example:**

```json
{ "status": "working", "workDir": "my-project" }
```

---

#### `get_status`

Get detailed status and health of a specific Aegis session.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to check |

---

#### `create_session`

Spawn a new Claude Code session managed by Aegis. Returns the session ID and initial status.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `workDir` | string | yes | Working directory for the new session |
| `name` | string | no | Optional human-readable name |
| `prompt` | string | no | Optional initial prompt to send after creation |

**Example:**

```json
{ "workDir": "/home/user/project", "name": "code-review", "prompt": "Review the latest commit" }
```

---

#### `kill_session`

Kill an Aegis session. Deletes the tmux window and cleans up all resources.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to kill |

---

#### `escape_session`

Send an Escape keypress to an Aegis session. Useful for dismissing prompts or cancelling operations.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to send escape to |

---

#### `interrupt_session`

Send Ctrl+C to interrupt the current operation in an Aegis session.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to interrupt |

---

### Communication

#### `send_message`

Send a message to another Aegis session. The message is delivered via tmux send-keys with delivery verification.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The target session ID |
| `text` | string | yes | The message text to send |

---

#### `send_bash`

Execute a bash command in an Aegis session. The command is prefixed with `!` and sent via tmux.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to send the bash command to |
| `command` | string | yes | The bash command to execute |

**Example:**

```json
{ "sessionId": "abc-123", "command": "git status" }
```

---

#### `send_command`

Send a slash command to an Aegis session. The command is prefixed with `/` if not already.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to send the command to |
| `command` | string | yes | The slash command (`help`, `compact`, etc.) |

---

### Transcript & Observability

#### `get_transcript`

Read the conversation transcript of another Aegis session. Returns recent messages from the JSONL log.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to read from |

---

#### `capture_pane`

Capture the raw terminal pane content of an Aegis session. Returns the current visible text.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to capture |

---

#### `get_session_metrics`

Get performance metrics for a specific Aegis session (message counts, latency, etc.).

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to get metrics for |

---

#### `get_session_summary`

Get a summary of an Aegis session including message counts, duration, and status history.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to summarize |

---

#### `get_session_latency`

Get latency metrics for a specific Aegis session, including realtime and aggregated measurements.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID to get latency for |

---

#### `server_health`

Check the health and status of the Aegis server. Returns version, uptime, and session counts.

**Parameters:** None.

---

### Permissions

#### `approve_permission`

Approve a pending permission prompt in an Aegis session.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID with a pending permission prompt |

---

#### `reject_permission`

Reject a pending permission prompt in an Aegis session.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The session ID with a pending permission prompt |

---

### Orchestration

#### `batch_create_sessions`

Create multiple Aegis sessions in a single batch operation.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessions` | array | yes | Array of session specifications (`workDir`, optional `name`, optional `prompt`) |

**Example:**

```json
{
  "sessions": [
    { "workDir": "/home/user/project", "name": "agent-1", "prompt": "Implement feature X" },
    { "workDir": "/home/user/project", "name": "agent-2", "prompt": "Write tests for feature X" }
  ]
}
```

---

#### `list_pipelines`

List all configured pipelines in the Aegis server.

**Parameters:** None.

---

#### `create_pipeline`

Create a new pipeline for orchestrating multiple Aegis sessions in sequence.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Name of the pipeline |
| `workDir` | string | yes | Working directory for pipeline sessions |
| `steps` | array | yes | Array of pipeline steps (`name` optional, `prompt` required) |

**Example:**

```json
{
  "name": "review-fix-test",
  "workDir": "/home/user/project",
  "steps": [
    { "name": "review", "prompt": "Review the latest commit for bugs" },
    { "name": "fix", "prompt": "Fix any issues found in the review" },
    { "name": "test", "prompt": "Run the test suite and verify all tests pass" }
  ]
}
```

---

#### `get_swarm`

Get a snapshot of all Claude Code processes detected on the system (the "swarm").

**Parameters:** None.

---

### State (Memory Bridge)

#### `state_set`

Set a shared state key/value entry via Aegis memory bridge.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | State key in `namespace/key` format |
| `value` | string | yes | State payload as string |
| `ttlSeconds` | number | no | TTL in seconds (max 30 days) |

**Example:**

```json
{ "key": "pipeline/run-123", "value": "{\"status\": \"in_progress\"}", "ttlSeconds": 3600 }
```

---

#### `state_get`

Get a shared state key/value entry via Aegis memory bridge.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | State key in `namespace/key` format |

---

#### `state_delete`

Delete a shared state key/value entry via Aegis memory bridge.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `key` | string | yes | State key in `namespace/key` format |

---

## Prompts

MCP prompts are pre-built conversation starters that guide Claude Code through structured workflows.

### `implement_issue`

Create a session and generate a structured implementation prompt for a GitHub issue.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `issueNumber` | string | yes | GitHub issue number |
| `workDir` | string | yes | Working directory for the new session |
| `repoOwner` | string | no | Repository owner (default: `OneStepAt4time`) |
| `repoName` | string | no | Repository name (default: `aegis`) |

**Workflow:** Creates a session → reads the issue → analyzes codebase → plans implementation → implements changes → runs quality gate → commits.

---

### `review_pr`

Create a session and generate a structured code review prompt for a GitHub pull request.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `prNumber` | string | yes | GitHub pull request number |
| `workDir` | string | yes | Working directory for the new session |
| `repoOwner` | string | no | Repository owner (default: `OneStepAt4time`) |
| `repoName` | string | no | Repository name (default: `aegis`) |

**Workflow:** Creates a session → fetches PR details and diff → reviews for correctness, security, test coverage, breaking changes → posts review as PR comment.

---

### `debug_session`

Generate a diagnostic summary for an Aegis session by reading its transcript and status.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | The Aegis session ID to debug |

**Workflow:** Gets session status → reads transcript → captures terminal pane → analyzes for unexpected state, errors, stalls, repeated permission requests → provides diagnostic summary with recommended actions.

---

## Tool Summary

| Category | Tools |
|---|---|
| Session Management | `list_sessions`, `get_status`, `create_session`, `kill_session`, `escape_session`, `interrupt_session` |
| Communication | `send_message`, `send_bash`, `send_command` |
| Transcript & Observability | `get_transcript`, `capture_pane`, `get_session_metrics`, `get_session_summary`, `get_session_latency`, `server_health` |
| Permissions | `approve_permission`, `reject_permission` |
| Orchestration | `batch_create_sessions`, `list_pipelines`, `create_pipeline`, `get_swarm` |
| State | `state_set`, `state_get`, `state_delete` |
