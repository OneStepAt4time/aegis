<!-- 
  AGENTS API REFERENCE — STUB
  Issue: #3971 (Agent Profiles)
  Status: DRAFT — endpoint contracts pending Hephaestus implementation
  
  This file will be merged into docs/api-reference.md as Section 14: Agents
  once the API surface is confirmed. Keeping separate during development for
  faster iteration.
-->

# Agents API

Agents are first-class configuration objects. Each agent defines a named profile with model, instructions, environment variables, and MCP config that sessions inherit on creation.

**Base path:** `/v1/agents`

## Endpoints

### List Agents

```
GET /v1/agents
```

Returns all active agents (excludes archived).

**Parameters:**

| Parameter | Type | In | Description |
|-----------|------|----|-------------|
| `limit` | integer | query | Max results (default 50) |
| `offset` | integer | query | Pagination offset |
| `runner` | string | query | Filter by runner type |

**Response:** `200 OK`

```json
{
  "agents": [
    {
      "id": "agent_abc123",
      "name": "claude-code-hep",
      "description": "Backend development agent",
      "runner": "claude-code",
      "model": "claude-sonnet-4-20250514",
      "thinking_level": "high",
      "max_concurrent_sessions": 3,
      "instructions": "Focus on backend TypeScript...",
      "archived": false,
      "created_at": "2026-06-01T10:00:00Z",
      "updated_at": "2026-06-01T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0
  }
}
```

---

### Get Agent

```
GET /v1/agents/:id
```

**Response:** `200 OK`

```json
{
  "id": "agent_abc123",
  "name": "claude-code-hep",
  "description": "Backend development agent",
  "runner": "claude-code",
  "model": "claude-sonnet-4-20250514",
  "thinking_level": "high",
  "max_concurrent_sessions": 3,
  "instructions": "Focus on backend TypeScript...",
  "custom_env": [
    { "key": "NODE_ENV", "value": "development" }
  ],
  "custom_args": ["--verbose"],
  "mcp_config": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/project"]
    }
  },
  "archived": false,
  "active_sessions": 1,
  "created_at": "2026-06-01T10:00:00Z",
  "updated_at": "2026-06-01T10:00:00Z",
  "last_active_at": "2026-06-01T12:30:00Z"
}
```

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `AGENT_NOT_FOUND` | Agent ID does not exist |
| 410 | `AGENT_ARCHIVED` | Agent was archived (still readable) |

---

### Create Agent

```
POST /v1/agents
```

**Body:**

```json
{
  "name": "codex-reviewer",
  "description": "Code review agent using Codex",
  "runner": "codex",
  "model": "codex-mini",
  "thinking_level": "medium",
  "max_concurrent_sessions": 1,
  "instructions": "Review code for security vulnerabilities...",
  "custom_env": [
    { "key": "OPENAI_API_KEY", "value": "$OPENAI_API_KEY" }
  ],
  "custom_args": [],
  "mcp_config": {}
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Unique agent name (SAFE_NAME_RE: `^[a-zA-Z0-9_-]+$`) |
| `description` | string | ❌ | Human-readable description |
| `runner` | string | ❌ | Runner type (default: `"claude-code"`) |
| `model` | string | ❌ | Model override (null = runner default) |
| `thinking_level` | string | ❌ | `"none"` / `"low"` / `"medium"` / `"high"` |
| `max_concurrent_sessions` | integer | ❌ | Max simultaneous sessions (default: 1) |
| `instructions` | string | ❌ | Custom system prompt additions |
| `custom_env` | array | ❌ | `[{key, value}]` environment variables |
| `custom_args` | array | ❌ | Extra CLI arguments |
| `mcp_config` | object | ❌ | MCP server definitions |

**Response:** `201 Created`

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 409 | `AGENT_NAME_EXISTS` | Name already taken |
| 400 | `INVALID_NAME` | Name doesn't match SAFE_NAME_RE |

---

### Update Agent

```
PATCH /v1/agents/:id
```

Updates specified fields. Omitted fields are unchanged.

**Body:** Same fields as create, all optional.

**Response:** `200 OK` — returns updated agent.

**Errors:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | `AGENT_NOT_FOUND` | Agent ID does not exist |
| 409 | `AGENT_NAME_EXISTS` | New name already taken |
| 400 | `AGENT_ARCHIVED` | Cannot update archived agent |

---

### Archive Agent (Soft Delete)

```
DELETE /v1/agents/:id
```

Archives the agent. Existing sessions using this agent are **unaffected** — they continue running with the config they were spawned with.

**Response:** `200 OK`

```json
{
  "id": "agent_abc123",
  "archived": true,
  "archived_at": "2026-06-01T15:00:00Z"
}
```

---

### Restore Agent

```
POST /v1/agents/:id/restore
```

Restores an archived agent.

**Response:** `200 OK` — returns agent with `archived: false`.

---

## WebSocket Events

| Event | Payload | Description |
|-------|---------|-------------|
| `agent:created` | `{ id, name, runner }` | New agent created |
| `agent:updated` | `{ id, name, changes }` | Agent config updated |
| `agent:archived` | `{ id, name }` | Agent archived |
| `agent:restored` | `{ id, name }` | Agent restored from archive |

---

## Session Integration

When creating a session with an agent:

```
POST /v1/sessions
{
  "agentId": "agent_abc123",
  "message": "Fix the failing tests in src/auth/"
}
```

The session inherits the agent's config:
- `model` → session model override
- `instructions` → appended to system prompt
- `custom_env` → merged into session environment
- `custom_args` → appended to runner CLI args
- `mcp_config` → merged into session MCP servers
- `max_concurrent_sessions` → enforced (returns 429 if exceeded)

---

<!-- 
  TODO: Fill in once implementation ships
  - RBAC role table (which roles can create/update/archive agents)
  - Rate limits
  - Examples with curl + TypeScript SDK
-->
