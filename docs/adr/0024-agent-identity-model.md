# ADR-0024: Agent Identity Model

**Status:** Proposed
**Date:** 2026-05-23
**Issue:** #3999
**Blocks:** #3971–#3978 (multi-agent feature set)

## Context

Aegis has no concept of an "agent" — only sessions exist. Sessions are ephemeral work units. The multi-agent roadmap (#3970–#3978) requires agents as first-class entities with identity, capabilities, and permissions.

Currently:
- Sessions have a `runnerName` field (e.g. "claude-code") — informational only
- Auth is API-key-based with roles (admin/operator/viewer) and fine-grained permissions
- No agent table, no agent-session binding, no agent-level permission scoping

## Decision

### Agent = Configuration Entity (not runtime)

An Agent defines what a session **can** do. It is a configuration object — not a running process. A session references an agent to inherit its capabilities.

```
Agent → (defines) → capabilities, constraints, defaults
Session → (references) → agentId → inherits agent config
```

### Data Model

```typescript
interface Agent {
  id: string;                    // UUID
  name: string;                  // Human-readable (e.g. "claude-code-hep", "codex-reviewer")
  description?: string;          // Optional description
  runnerType: string;            // "claude-code" | "codex" | "gemini-cli" | etc.
  role: ApiKeyRole;              // Inherited from creating key, can be narrowed
  permissions: ApiKeyPermission[]; // Subset of creating key's permissions
  constraints: AgentConstraints; // Resource limits
  ownerKeyId: string;            // API key that created this agent
  createdAt: number;             // Epoch ms
  updatedAt: number;             // Epoch ms
  lastActiveAt?: number;         // Updated when any session using this agent starts
  metadata?: Record<string, unknown>; // Extensible for future use
}

interface AgentConstraints {
  maxConcurrentSessions?: number;  // Max simultaneous sessions
  maxTokensPerSession?: number;    // Token budget per session
  allowedModels?: string[];        // Model allowlist (empty = all allowed)
  deniedTools?: string[];          // Tool denylist
}
```

### Key Design Decisions

1. **Agent permissions ⊆ API key permissions.** An agent cannot exceed its creator's authority. This is enforced at creation time and on every session start.

2. **One agent can be bound to multiple sessions.** An agent is a template — multiple sessions can reference the same agent simultaneously.

3. **Agent ownership is tied to API key.** The API key that created the agent owns it. If the key is revoked, its agents are deactivated (not deleted — audit trail).

4. **`runnerType` is a string, not an enum.** The agent runner ecosystem is evolving rapidly. Hardcoding runner types creates version coupling. Unknown runners are allowed — they just don't get runner-specific features.

5. **Storage: file-based, consistent with existing patterns.** Aegis uses `FileAcpLocalStorageProfile` for state. Agents follow the same pattern — JSON file in the data directory. No database.

### API

```
POST   /v1/agents              — Create agent
GET    /v1/agents              — List agents (filtered by owner key)
GET    /v1/agents/:id          — Get agent details
PATCH  /v1/agents/:id          — Update agent (name, constraints, permissions)
DELETE /v1/agents/:id          — Deactivate agent (soft delete)
```

### Session Binding

Sessions get a new optional `agentId` field:

```
POST /v1/sessions  { ..., agentId?: string }
```

When `agentId` is provided:
1. Verify agent exists and is active
2. Verify agent's permissions ⊆ session creator's permissions
3. Apply agent constraints as session limits
4. Record agentId in session metadata

## Consequences

### Positive
- Foundation for all multi-agent features (#3970–#3978)
- Agent-level permission scoping without changing existing auth
- No database — file-based storage stays consistent
- Extensible via `metadata` and `constraints` without schema migrations

### Negative
- Another entity to manage in the API surface
- File-based storage may not scale for teams with 100+ agents (acceptable for Phase 4)
- Need to update SDK types and API contracts

### Risks
- Over-engineering before we have real multi-agent usage data. Mitigation: start minimal, add fields as needed.
- Agent-session binding could conflict with ACP backend's own agent concept. Mitigation: `runnerType` is informational; ACP handles its own routing.

## Implementation Plan

1. **Type definitions** — `src/services/agents/types.ts`
2. **AgentManager** — CRUD + permission validation — `src/services/agents/AgentManager.ts`
3. **Storage** — file-based, follows `local-storage.ts` pattern
4. **Routes** — `src/routes/agents.ts`
5. **Session binding** — extend `POST /v1/sessions` and session type
6. **Tests** — CRUD, permission validation, session binding
