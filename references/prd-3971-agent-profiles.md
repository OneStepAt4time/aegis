---
name: prd-3971-agent-profiles
title: Agent Profiles — First-Class Agents with Identity, Config, Skills, and Model Routing
issue: 3971
status: approved (v2 — Themis audit incorporated)
created: 2026-05-30
updated: 2026-05-30
authors: [Athena, Scribe]
auditors: [Themis]
depends: []
blocks: [3180, 3981, 3982]
---

# PRD: Agent Profiles

## 1. Problem Statement

Aegis treats every AI session as anonymous — a CC process spun up with ad-hoc config. There is no concept of "who" the agent is, what it knows, or how it should behave by default. This means:

- **No agent identity.** Users can't name, describe, or customize agents.
- **No reusable config.** Every session starts from scratch. Model, instructions, MCP, tools — all manual, every time.
- **No agent-level routing.** Can't assign work to "the frontend specialist" because that specialist doesn't exist as an entity.
- **No multi-agent foundation.** Squads (#3981), Autopilots (#3982), and Multi-Agent Support (#3180) all require agents to be first-class objects.

Without profiles, Aegis is a single-tool orchestrator. With profiles, it becomes a multi-agent control plane.

## 2. Solution

Agents are first-class persistent objects. Each agent has:

- **Identity**: name, description, avatar
- **Runtime config**: model override, thinking level, max concurrent tasks, runtime binding
- **Prompt customization**: custom instructions, environment variables, CLI args
- **MCP config**: agent-specific MCP server definitions
- **Lifecycle**: active → archived (soft delete), restorable

### v1 Scope Cuts (per ADR-0029 single-tenant refocus)

The following are **removed from v1** and deferred to v2 or later:

- ~~Visibility (`workspace` / `private`)~~ — no multi-user, no private agents until enterprise
- ~~Skills array in API~~ — `agent_skill` join table exists in migration for forward compat, but no skills endpoint or skills field in create/update payloads
- ~~Routing rules~~ — model override via `model` field only. Routing logic is a follow-up issue
- ~~`workspaceId` required~~ — field kept as nullable for future, not required in v1 (single-tenant per ADR-0029)

## 3. User Stories

1. As a user, I can create an agent named "Frontend Lead" with a default model, custom instructions, so that any task assigned to it uses the right configuration automatically.
2. As a user, I can edit an agent's model and instructions without affecting running sessions, so that config changes apply to future tasks only.
3. As a user, I can archive an agent I no longer need, so it disappears from listings but its historical task data remains intact.
4. As a user, I can restore a previously archived agent, so I can reactivate it without recreating its config.
5. As a user, I can see all agents in a list, so I know what specialists are available.
6. As a developer, I can assign a task to an agent by ID, and the system looks up the agent's config (model, instructions, MCP) and applies it when spawning the session.
7. As a developer, I can bind an agent to a specific runtime (local daemon), so the agent always executes on the right infrastructure.
8. As a user, I see real-time WebSocket events when agents are created, archived, or restored.

## 4. Data Model

```sql
CREATE TABLE agent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID,  -- nullable in v1 (single-tenant), required in v2
    name TEXT NOT NULL,  -- validated: ^[a-zA-Z0-9_-]{1,64}$
    description TEXT,
    avatar_url TEXT,
    runtime_mode TEXT NOT NULL DEFAULT 'daemon',
    runtime_config JSONB DEFAULT '{}',
    runtime_id UUID REFERENCES runtime(id),
    model TEXT,
    thinking_level TEXT CHECK(thinking_level IN ('none','low','medium','high')),
    max_concurrent_tasks INTEGER NOT NULL DEFAULT 1,
    instructions TEXT,
    custom_env JSONB DEFAULT '[]',   -- validated against env denylist at write time
    custom_args JSONB DEFAULT '[]',  -- validated against arg denylist at write time
    mcp_config JSONB DEFAULT '{}',   -- validated against MCP allowlist at write time
    owner_key_id TEXT NOT NULL,       -- matches ADR-0024 ownership model
    archived_at TIMESTAMPTZ,
    archived_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_active ON agent(workspace_id) WHERE archived_at IS NULL;
```

### Skill Attachment (forward compat — no v1 API)

```sql
CREATE TABLE agent_skill (
    agent_id UUID NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
    attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_id, skill_id)
);
```

## 5. API Design

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/agents` | List agents (exclude archived) |
| GET | `/v1/agents/:id` | Get agent details |
| POST | `/v1/agents` | Create agent |
| PATCH | `/v1/agents/:id` | Update agent |
| DELETE | `/v1/agents/:id` | Archive agent (soft delete) |
| POST | `/v1/agents/:id/restore` | Restore archived agent |

### Name Validation

Agent names MUST match `^[a-zA-Z0-9_-]{1,64}$`. Enforcement at **both layers**:
- **Model layer** (`AgentManager.create()` / `update()`) — rejects invalid names before DB write
- **Route layer** — schema validation as first line of defense

### Create Agent Request

```typescript
{
  name: string,           // required, SAFE_NAME_RE validated
  description?: string,
  avatar_url?: string,
  runtime_mode?: 'daemon',
  runtime_config?: Record<string, unknown>,
  runtime_id?: string,
  model?: string,
  thinking_level?: 'none' | 'low' | 'medium' | 'high',
  max_concurrent_tasks?: number,
  instructions?: string,
  custom_env?: Array<{key: string, value: string}>,
  custom_args?: string[],
  mcp_config?: Record<string, unknown>
}
```

## 6. Config Application on Task Dispatch

When a task is assigned to an agent:
1. System fetches agent record by ID
2. **Resolve effective permissions**: `effectivePermissions = userPermissions ∩ agentPermissions`
3. **If effectivePermissions is empty → `403 PERMISSION_CEILING_EMPTY`** (do not spawn dead session)
4. Applies `model` as model override (null = tool default)
5. Injects `instructions` into system prompt
6. Merges `mcp_config` with defaults
7. Sets `custom_env` and `custom_args` on the spawned process (denylist re-checked at read time)
8. Enforces `max_concurrent_tasks` — reject dispatch if at capacity

## 7. WebSocket Events

- `agent:created` — new agent created
- `agent:archived` — agent archived
- `agent:restored` — agent restored
- `agent:status` — status change (online/offline via runtime heartbeat)

## 8. Security Model

### 8.1 Authentication

All agent API endpoints require authenticated key. Token validation at middleware layer.

### 8.2 Authorization

- **Create/Patch/Delete/Restore**: `operator` role or above
- **Read (list/get)**: all authenticated keys

### 8.3 Escalation Prevention

Seven attack vectors mitigated:

1. **Privilege escalation via role change.** If an agent's owner is downgraded to `viewer`, the effective permission set becomes empty. Dispatch is rejected with `403 PERMISSION_CEILING_EMPTY` — no silent dead sessions.

2. **Name injection.** Agent names validated against `^[a-zA-Z0-9_-]{1,64}$` at both model and route layers. No path traversal (`../../etc/passwd`), no XSS (`<script>`), no unicode tricks.

3. **MCP config injection.** Agent `mcp_config` validated against an allowlist of approved MCP server definitions at creation time. Arbitrary commands blocked.

4. **Custom env/args abuse.** `custom_env` and `custom_args` validated against denylist (#3023) at **both** write time (agent creation) and read time (session spawn). A user who stores `ANTHROPIC_API_KEY: "stolen-key"` in `customEnv` gets rejected at `POST /v1/agents`, not silently stored. Blocked patterns: `LD_PRELOAD`, `PATH`, `HOME`, `*KEY*`, `*TOKEN*`, `*SECRET*`.

5. **Archive/restore race conditions.** Archive and restore are idempotent. No TOCTOU window.

6. **Agent chaining (cross-agent escalation).** Each agent's permissions are scoped to its own identity. `effectivePermissions` uses intersection. Agent identity is **immutable per-session** — once a session is spawned under Agent A, it cannot reassign itself to Agent B to inherit B's scope. Cross-agent boundaries enforced at the dispatch layer AND at the session layer via `validateForSession()` which checks:
   - Agent exists and is active
   - Resolved permission set is non-empty
   - Session cannot mutate its own agent binding mid-flight

7. **Permission ceiling empty.** When `effectivePermissions(user, agent)` yields an empty set, dispatch returns `403 PERMISSION_CEILING_EMPTY` with a descriptive error. No session is created. Dashboard surfaces a warning that the agent's permissions are incompatible with the user's role.

### 8.4 Rate Limiting

Agent CRUD endpoints are rate-limited at the gateway layer:
- `POST /v1/agents`: 10 requests/min per key
- `PATCH /v1/agents/:id`: 30 requests/min per key
- `DELETE /v1/agents/:id`: 30 requests/min per key

This prevents DoS via agent spam, audit log flooding, and name squatting from compromised keys.

## 9. Testing Decisions

1. **Unit tests**: CRUD operations, name validation (positive + injection cases), env denylist at write time, archive/restore
2. **Integration tests**: Task dispatch with agent config, `effectivePermissions` intersection, `PERMISSION_CEILING_EMPTY` rejection
3. **E2E tests**:
   - Create agent → verify in list
   - Name validation: reject `../../etc/passwd`, `<script>`, empty, 65+ chars
   - `customEnv` denylist: reject `ANTHROPIC_API_KEY` at creation time
   - Assign task to agent → verify config applied
   - Archive agent → removed from list, existing tasks unaffected
   - Downgrade owner role → dispatch returns `403 PERMISSION_CEILING_EMPTY`
   - Agent chaining: Agent A session cannot invoke Agent B's scoped operations
   - Rate limiting: 11th create in 1 min → `429`
4. **Gate**: `npm run gate` must pass before merge

## 10. Out of Scope

- Agent versioning / config history (v2)
- Agent visibility / private agents (v2 — multi-user)
- Skills in API (join table exists, no endpoint)
- Routing rules (model override only)
- Agent marketplace / sharing
- Cloud runtime mode (placeholder)
- Agent metrics dashboard (separate issue)
- `workspaceId` required (nullable in v1)

## 11. Further Notes

- Reference implementation: `multica/server/internal/handler/agent.go`
- DB queries: `multica/server/pkg/db/queries/agent.sql`
- ADR-0024: agent data model specification
- ADR-0029: single-tenant refocus
- Env denylist: #3023
- Security audit: Themis (findings incorporated as Section 8.3 items 1, 2, 4, 6, 7 and Section 8.4)

## Changelog

- **v1** (2026-05-30): Initial PRD by Athena + Scribe
- **v2** (2026-05-30): Themis audit incorporated — permission ceiling empty rejection, name validation at model layer, env denylist at write time, agent chaining session-level check, rate limiting. V1 scope cuts applied (visibility, skills API, routing rules, workspaceId).
