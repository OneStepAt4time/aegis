# PRD: Agent Profiles (#3971)

**Status:** Approved by Boss (30 May 2026)
**Assignee:** Hephaestus (backend), Daedalus (dashboard — after API lands)
**Priority:** P1 — prerequisite for #3180 (Multi-Agent), #3981 (Squads), #3982 (Autopilots)
**Blocks:** #3180 cannot start implementation until this ships
**ADR refs:** ADR-0024 (Agent Identity Model), ADR-0006 (Middleware Not Framework)

---

## 1. Problem Statement

Aegis has no concept of an "agent." Every session is an anonymous CC process with ad-hoc config passed at creation time. Users who want consistent behavior — same model, same instructions, same MCP servers — must repeat their config every time they create a session.

Competitors (Multica, cc-connect, OpenACP) treat agents as first-class objects. An agent has a name, a runner, a model, custom instructions, and skills. Sessions reference agents, not the other way around.

Agent Profiles fix this: agents become reusable configuration templates that sessions inherit.

## 2. User Stories

| # | As a… | I want to… | So that… |
|---|-------|-----------|----------|
| 1 | Solo dev | Create a "backend-dev" agent with my preferred model and instructions | I don't repeat config on every session |
| 2 | Solo dev | Run `ag run --agent backend-dev "fix tests"` | My session picks up the right model, env, and MCP automatically |
| 3 | Team lead | Create a "reviewer" agent with read-only permissions | Code review sessions can't make changes |
| 4 | Team lead | Archive an old agent | It disappears from the list but existing sessions keep working |
| 5 | Developer | See which agent a session is using | I understand why it behaves a certain way |

## 3. Requirements

### Must Have (P0)
- Agent CRUD: create, list, get, update, archive (soft delete), restore
- Agent fields: name, description, runner type, model, thinking level, instructions, custom_env, custom_args, mcp_config, max_concurrent_sessions
- Session integration: `POST /v1/sessions { agentId }` applies agent config
- CLI: `ag agent create/list/get/update/delete/restore`
- Agent permissions ⊆ creating API key's permissions (ADR-0024)
- `npm run gate` passes

### Should Have (P1)
- Dashboard: agent list, create/edit form, agent detail with sessions
- WebSocket events: agent:created, agent:updated, agent:archived, agent:restored
- `ag run --agent <name>` flag

### Could Have (P2)
- Agent avatar/icon
- Agent usage metrics (sessions created, tokens used)
- Agent config validation (test MCP connection, verify model exists)

### Won't Have (explicitly out of scope)
- Skills attachment (separate issue)
- Model routing / load balancing (separate issue)
- Runtime abstraction / multi-runner (that's #3180)
- Cloud mode / remote runners
- Agent versioning / config history

## 4. API Surface

### Endpoints

```
POST   /v1/agents              — Create agent
GET    /v1/agents              — List agents (exclude archived, filterable)
GET    /v1/agents/:id          — Get agent details
PATCH  /v1/agents/:id          — Update agent
DELETE /v1/agents/:id          — Archive agent (soft delete)
POST   /v1/agents/:id/restore  — Restore archived agent
```

### Agent Object

```typescript
interface Agent {
  id: string;                    // UUID
  name: string;                  // Unique, SAFE_NAME_RE: ^[a-zA-Z0-9_-]+$
  description?: string;
  runner: string;                // Default: 'claude-code'
  model?: string;                // Model override (null = runner default)
  thinkingLevel?: 'none' | 'low' | 'medium' | 'high';
  maxConcurrentSessions: number; // Default: 1
  instructions?: string;         // Custom system prompt additions
  customEnv?: Array<{ key: string; value: string }>;
  customArgs?: string[];
  mcpConfig?: Record<string, unknown>;
  ownerKeyId: string;            // API key that created this agent
  permissions: ApiKeyPermission[]; // Subset of owner key's permissions
  archived: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
}
```

### Session Integration

```
POST /v1/sessions
{
  "agentId": "agent_abc123",      // NEW: optional
  "message": "Fix the auth tests",
  // agent's model/instructions/env/MCP are applied automatically
  // explicit flags override agent config
}
```

Response includes `agentId` and `runnerName` in session object.

### RBAC

| Endpoint | admin | operator | viewer |
|----------|-------|----------|--------|
| `GET /v1/agents` | ✅ Own + others' | ✅ Own only | ✅ Own only |
| `POST /v1/agents` | ✅ | ✅ | ❌ |
| `GET /v1/agents/:id` | ✅ | ✅ Own only | ✅ Own only |
| `PATCH /v1/agents/:id` | ✅ | ✅ Own only | ❌ |
| `DELETE /v1/agents/:id` | ✅ | ✅ Own only | ❌ |
| `POST /v1/agents/:id/restore` | ✅ | ✅ Own only | ❌ |

> "Own" = agent was created by the requesting API key or a key with the same role.

## 5. Acceptance Criteria

1. CRUD API works — create, list, get, update, archive, restore
2. Archive is soft-delete — agent disappears from list but sessions referencing it are unaffected
3. Agent name uniqueness enforced (409 on duplicate)
4. Agent name follows SAFE_NAME_RE (`^[a-zA-Z0-9_-]+$`)
5. Agent permissions validated at creation: must be ⊆ creating key's permissions
6. `POST /v1/sessions { agentId }` applies: model, instructions, env, MCP, constraints
7. `maxConcurrentSessions` enforced — returns 429 when exceeded
8. Explicit session flags override agent config
9. `ag run --agent <name>` works end-to-end
10. `npm run gate` passes
11. Tests cover: CRUD, archive/restore, permission validation, session spawn with agent config, concurrent session limits

## 6. Dependencies + Blockers

| Dependency | Status | Impact |
|-----------|--------|--------|
| ADR-0024 (Agent Identity) | ✅ Proposed | Design aligned |
| Existing session API | ✅ Shipped | Integration point |
| API key / RBAC system | ✅ Shipped | Permission inheritance |
| #3180 Multi-Agent | 🔲 Blocked on this | Cannot start until this ships |

**No blockers.** This issue can start immediately.

## 7. Out of Scope

- Skills / SKILL.md attachment → separate issue
- Model routing → separate issue
- Runner implementation → #3180
- Cloud mode → deferred
- Agent versioning / config history → future enhancement
- Agent marketplace / sharing → future enhancement

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Time to first session with agent | < 60 seconds (create agent → run session → config applied) |
| Agent CRUD P95 latency | < 50ms |
| Session spawn with agent config | < 200ms overhead vs. bare session |
| Zero permission escalation bugs | 100% |
| Tests | > 90% line coverage on new code |

## 9. Security Model

### 9.1 No Agent-Level Auth

Agents do NOT have their own API keys. They inherit from the user who created them. This avoids a whole key management surface. If agent-level auth is needed later, that's a separate issue.

### 9.2 Permission Ceiling

An agent CANNOT exceed its creator's permissions. If owner has `viewer` role, agent sessions are read-only regardless of agent config.

**Enforced at session creation time, not agent creation time.** Roles can change after an agent is defined — the permission check runs when a session actually starts, using the owner's *current* role.

```typescript
// At session start (not agent creation)
function effectivePermissions(
  agentPerms: ApiKeyPermission[],
  ownerKeyPerms: ApiKeyPermission[]  // current, not snapshot
): ApiKeyPermission[] {
  return agentPerms.filter(p => ownerKeyPerms.includes(p));
}
```

If the intersection is empty (e.g. owner downgraded to viewer after creating agent with `['create', 'send']`), the session starts with read-only access. No error — permissions are silently reduced to the effective set.

### 9.3 Key Revocation — Hard Fail

When an API key is revoked or deleted:

1. **Agents owned by that key are deactivated** (`archived: true`, `deactivatedReason: 'owner_key_revoked'`).
2. **Active sessions fail at next Aegis API call.** The token is cached in-process, so sessions continue until they next hit the Aegis server. On that call, auth fails — no silent degradation, hard fail visible in dashboard + SSE.
3. **New sessions** referencing a deactivated agent → `403 AGENT_DEACTIVATED` with error: "Agent owner's API key is invalid."
4. **No fallback to default key.** `ag run --agent <name>` fails at session creation. Does NOT silently use another key.
5. **Multiple agents, same owner, one key rotation:** all affected agents fail consistently. No partial auth state.
6. **Restore not possible** — the owning key no longer exists. Admin must create a new agent under a different key.

### 9.4 Key Rotation Edge Cases

| Scenario | Behavior |
|----------|----------|
| Key rotated while agent has active sessions | Sessions continue until next Aegis API call (token cached in-process). On next call: if new key is valid, session recovers. If not, session fails with clear error. |
| Agent config references invalid key | `ag run --agent <name>` fails at session creation with "Agent owner's API key is invalid." No fallback to default key. |
| Multiple agents, same owner, key rotated | All affected agents fail consistently. No partial auth state. |
| Key role changes while agent has active sessions | Existing sessions continue with cached permissions until next API call. New sessions use current permissions. |
| Agent permissions updated while sessions are running | Existing sessions keep their spawn-time config. New sessions use updated config. |

**Rule:** Sessions are immutable after creation. Permission changes take effect on the NEXT session or next API call, never retroactively on in-flight operations.

### 9.5 Archive ≠ Revoke

Archiving an agent does NOT kill its active sessions. Sessions from archived agents keep running until they complete or are killed manually. Archive only prevents NEW sessions.

This is distinct from key revocation (Section 9.3), which causes active sessions to fail on next API call.

### 9.6 Permission Escalation Prevention

| Scenario | Risk | Mitigation |
|----------|------|------------|
| Agent created with `['create', 'send']`, key later downgraded to viewer | Agent has more permissions than key | Session start uses `effectivePermissions()` — intersection of agent + current key perms |
| Agent `custom_env` includes `ADMIN_PASSWORD` | Env var injection | Agent env vars are merged AFTER session denylist check (#3023 env denylist applies) |
| Agent `mcp_config` includes filesystem access to `/etc` | Path traversal | `mcp_config` validated against session workDir constraints |
| Agent `instructions` include prompt injection | System prompt manipulation | Instructions appended to system prompt, marked as `[Agent Instructions]` section |
| Agent references runner not yet registered | Session fails with unclear error | Session start returns `400 UNKNOWN_RUNNER`. Agent can exist, but can't be used. |
| **Agent chaining** — User has Agent A (`session:create`) and Agent B (`session:kill`). Can A create a session that triggers B's kill scope? | Cross-agent privilege escalation | **No.** Each agent's permissions are scoped to its own identity. `effectivePermissions()` uses intersection of the *requesting agent's* perms + the *owner key's* current perms. Agent identity is immutable per-session — once spawned under Agent A, the session CANNOT reassign to Agent B mid-execution to inherit B's `kill` permission. Cross-agent boundaries enforced at the dispatch layer: `POST /v1/sessions/:id/kill` checks the session's own agent permissions, not other agents'. |

### 9.7 RBAC Edge Cases

| Edge Case | Resolution |
|-----------|------------|
| Admin creates agent, operator tries to update it | `403` — only owner or admin can update |
| Operator creates agent, admin archives it | ✅ Allowed — admin can manage all agents |
| Viewer tries to create agent | `403` — viewers cannot create agents |
| Two keys create agents with same name | `409 AGENT_NAME_EXISTS` — names are globally unique per server |

### 9.8 Audit Trail

All agent mutations are logged:

```
AGENT_CREATED     { agentId, name, ownerKeyId, permissions }
AGENT_UPDATED     { agentId, changes }
AGENT_ARCHIVED    { agentId, reason }
AGENT_RESTORED    { agentId }
AGENT_DEACTIVATED { agentId, reason: 'owner_key_revoked', keyId }
```

Audit entries are immutable and follow the existing audit trail format.

---

## Reference

- **Issue:** <https://github.com/OneStepAt4time/aegis/issues/3971>
- **ADR-0024:** Agent Identity Model
- **ADR-0006:** Aegis as Middleware, Not Agent Framework
- **Multica source:** `multica/server/internal/handler/agent.go` (1146 lines)
- **DB queries:** `multica/server/pkg/db/queries/agent.sql`
- **Permissions:** `src/services/auth/permissions.ts` — `['create', 'send', 'approve', 'reject', 'kill']`
- **Roles:** `src/services/auth/types.ts` — `admin | operator | viewer`
