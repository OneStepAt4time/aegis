# Multi-Agent Support — Architecture Design

**Issue:** #3180
**Blocks on:** #3971 (Agent Profiles — prerequisite)
**ADR refs:** ADR-0006 (middleware not framework), ADR-0024 (agent identity model)
**Date:** 2026-05-30
**Author:** Scribe (architecture design), Athena (review)
**Status:** APPROVED (Boss review, 2026-05-30)

---

## 1. Problem Statement

Aegis only supports Claude Code. Every competitor supports 10+ agent backends:

| Competitor | Agents | Approach |
|-----------|--------|----------|
| OpenACP | 28+ | ACP-native, one bridge per agent |
| cc-connect | 10+ | Chat-first, agent-specific adapters |
| ruflo | 98 | Plugin-based, MCP-heavy |
| mission-control | 5+ | Gateway pattern |

**The gap is existential.** Users choose the tool that supports their preferred AI coding agent. Without multi-agent, Aegis is invisible to anyone not using Claude Code.

## 2. Design Principles

From ADR-0006: **Aegis is middleware. Intelligence stays outside.**

1. **Aegis does NOT implement agent logic** — it bridges to agent backends
2. **Runner abstraction already exists** — `src/runners/` with `AgentRunner` interface (#3263)
3. **Agent Profiles (#3971) define WHAT to run** — Multi-Agent defines HOW to reach it
4. **File-based, no database** — consistent with Aegis's storage model (ADR-0024)
5. **ACP as the primary transport** — where available, use ACP/stdio; fall back to process spawning

## 3. What Already Exists

### 3.1 Runner Interface (`src/runners/types.ts`)

Already defined with full lifecycle:
- `AgentRunner` interface: `start()`, `sendInput()`, `readOutput()`, `kill()`, `isAlive()`, `getHandle()`
- `RunnerRegistry` interface: `register()`, `get()`, `listNames()`, `getDefault()`
- `InMemoryRunnerRegistry` implementation
- Stubs for Gemini CLI and Codex (`src/runners/stubs/`)

### 3.2 ACP Backend (Phase 3.5)

Aegis already has an ACP-native session layer:
- JSON-RPC client for ACP protocol
- Event mapping (ACP events → Aegis events)
- Action queue (Aegis actions → ACP commands)
- Session store (Postgres + file-based)

### 3.3 Agent Profiles (ADR-0024, pending #3971)

When #3971 ships, agents will have:
- `runnerType: string` — "claude-code" | "codex" | "gemini-cli" | etc.
- `constraints` — model allowlist, tool denylist, concurrent session limits
- Session binding — `POST /v1/sessions { agentId }`

**Multi-agent fills the gap:** Agent Profile says *which* runner to use. Multi-agent makes *each runner actually work*.

## 4. Architecture

### 4.1 Layer Diagram

```
┌─────────────────────────────────────────────┐
│  REST API / MCP / SSE / Dashboard / CLI     │  ← existing surface
├─────────────────────────────────────────────┤
│  Session Service (unchanged)                │
│    → resolves agentId → runnerType          │  ← #3971 adds this
├─────────────────────────────────────────────┤
│  Runner Registry                            │  ← exists (src/runners/)
│    → get(agent.runnerType) → AgentRunner    │
├──────────┬──────────┬───────────────────────┤
│ CC Runner│ Codex    │ Gemini CLI │ ...      │  ← different spawn commands
│ (ACP)    │ Runner   │ Runner     │          │    same NdjsonRpcTransport
├──────────┴──────────┴───────────────────────┤
│  NdjsonRpcTransport (reused, no new code)   │  ← src/acp-lifecycle/
└─────────────────────────────────────────────┘
```

### 4.2 Runner Implementations

Each runner implements `AgentRunner` (already defined). The key difference per backend is the **spawn command** — the wire protocol is identical.

| Runner | Spawn command | Protocol | Status | Notes |
|--------|--------------|----------|--------|-------|
| `claude-code` | `claude` | JSON-RPC 2.0 over stdio (ACP) | ✅ Active | Phase 3.5 |
| `codex` | `codex app-server --listen stdio://` | JSON-RPC 2.0 over stdio | 🔲 Stub | Confirmed from Multica source |
| `gemini-cli` | `gemini --experimental-acp` | JSON-RPC 2.0 over stdio | 🔲 Stub | Confirmed: `--experimental-acp` flag |
| `cc-connect` | HTTP endpoint | HTTP bridge | 🔲 Future | Delegates to cc-connect |
| `openacp` | HTTP endpoint | HTTP bridge | 🔲 Future | Delegates to OpenACP |

> **All three local runners speak the same wire protocol.** Codex (`codex app-server --listen stdio://`) and Gemini (`gemini --experimental-acp`) both use JSON-RPC 2.0 over stdin/stdout — identical to Claude Code's ACP. The existing `NdjsonRpcTransport` in `src/acp-lifecycle/ndjson-rpc-transport.ts` handles all three. Zero new transport code.
>
> **Phase-4c (NOT in scope):** Cursor, Copilot, and other HTTP API runners. Ship the three local runners first, then expand.
>
> **Bridge runners (cc-connect, OpenACP):** future issues. Will need their own HTTP transport when implemented.

### 4.3 Transport — Reuse NdjsonRpcTransport (YAGNI)

**Decision:** No new `AgentTransport` abstraction. All three local runners reuse `NdjsonRpcTransport` directly.

Confirmed from Multica source + local verification:
- **Codex:** `codex app-server --listen stdio://` → JSON-RPC 2.0 over stdin/stdout
- **Gemini CLI:** `gemini --experimental-acp` → JSON-RPC 2.0 over stdin/stdout
- **Claude Code:** already using `NdjsonRpcTransport` in Phase 3.5

Each runner is just a different spawn command + different binary name. The wire protocol is identical:

```typescript
// CodexRunner — different binary, same transport
export class CodexRunner implements AgentRunner {
  readonly name = 'codex';
  // spawn: codex app-server --listen stdio://
  // transport: NdjsonRpcTransport (same as CC)
}

// GeminiCliRunner — different binary, same transport
export class GeminiCliRunner implements AgentRunner {
  readonly name = 'gemini-cli';
  // spawn: gemini --experimental-acp
  // transport: NdjsonRpcTransport (same as CC)
}
```

**If a runner needs non-ACP transport later** (e.g. Cursor HTTP API, Copilot REST), we add a transport abstraction then. Right now, one transport covers everything.

#### Bridge Pattern (cc-connect / OpenACP) — Future

Bridge runners will need HTTP transport (not NdjsonRpc). That's a future issue — the `AgentRunner` interface stays identical, only the internal wiring changes.

```
Aegis ──HTTP──▶ cc-connect ──▶ Codex/Gemini/etc.
                    ▲
                    └── bridge runner translates Aegis actions
                        to bridge-specific API calls
```

The circuit breaker pattern (Section 4.3, Circuit Breaker) still applies to bridges when they're implemented.

#### Circuit Breaker (Bridge Transport)

Bridge runners connect to external services. When those services go down, Aegis must degrade gracefully — **never hang, never queue infinitely, never crash.**

**Circuit breaker contract:**

```typescript
interface BridgeCircuitBreaker {
  /** Current health state. */
  state: 'closed' | 'open' | 'half-open';
  /** Consecutive failures. */
  failureCount: number;
  /** Time the circuit opened. */
  openedAt: number | null;
  /** Last health check attempt. */
  lastCheckAt: number | null;
}
```

**State machine:**

```
closed (healthy)
  │  N consecutive failures (default: 3)
  ▼
open (unhealthy)
  │  after cooldown period (default: 30s)
  ▼
half-open (probing)
  │  success → closed
  │  failure → open (reset cooldown)
  ```

**Behavior per state:**

| State | `connect()` | `send()` | Session impact |
|-------|------------|---------|----------------|
| `closed` | Normal | Normal | None |
| `open` | Reject immediately: `503 BRIDGE_UNAVAILABLE` | Reject immediately | New sessions fail fast with clear error. Existing sessions marked `failed`. |
| `half-open` | Allow one attempt | Allow one attempt | If succeeds → back to `closed`. If fails → back to `open`. |

**Retry with backoff:**
- Half-open probes use exponential backoff: 30s → 60s → 120s → max 5min
- Max retries configurable per bridge (default: unlimited, but circuit stays open)
- Health check: lightweight `GET /health` or equivalent on bridge endpoint

**Dashboard visibility:**
- Bridge health shown in `GET /v1/runners` response: `{ available: false, healthState: 'open', lastError: '...' }`
- Dashboard shows degraded state with last known error
- SSE event `runner:health` on state transitions

**Why this matters:** Aegis is middleware (ADR-0006). If the downstream bridge is down, Aegis must report that clearly — not silently queue or timeout. The user sees "cc-connect is unreachable" and can act on it.

#### Dirty Shutdown Handling

`disconnect()` MUST handle unclean shutdowns. Every transport can fail differently:

| Transport | Dirty shutdown scenario | Mitigation |
|-----------|------------------------|------------|
| NdjsonRpcTransport (CC) | JSON-RPC stream hangs, no response to close | SIGTERM → wait 5s → SIGKILL. Mark session `crashed` on timeout. |
| NdjsonRpcTransport (Codex) | Same as CC — `codex app-server` may hang | Same mitigation. Process group kill + reap. |
| NdjsonRpcTransport (Gemini) | Same as CC — `gemini` may hang | Same mitigation. |
| Bridge (HTTP) | Remote endpoint stops responding | HTTP timeout (10s). Circuit breaker opens. Mark session `failed`. No local cleanup needed. |

**Implementation requirements:**
1. Every transport tracks its child process / connection state
2. `disconnect()` has a hard timeout (10s) — after which it force-kills
3. On server shutdown, `disconnect()` is called for ALL active connections in parallel
4. Orphan detection: on startup, check for stale processes from previous Aegis instance
5. Tests MUST cover: SIGTERM ignored, SIGKILL required, process group kill, timeout exceeded

### 4.4 Runner Discovery & Registration

**Auto-discovery first, config for overrides.** Zero-config is a core Aegis value.

At server startup:

1. **Auto-discover** installed CLIs via PATH (`which claude`, `which codex`, `which gemini`)
2. For each discovered binary, register the corresponding runner with default config
3. Load `aegis.config.ts` for **overrides** (custom binary path, extra args, env vars)
4. Validate: at least one runner must be available (CC is default)
5. Expose runner capabilities via API (`GET /v1/runners`)

```typescript
// aegis.config.ts — overrides only, not mandatory
export default {
  runners: {
    // Override CC binary path
    'claude-code': { command: '/usr/local/bin/claude' },
    // Override Codex with custom args
    'codex': { args: ['--json', '--quiet'] },
    // Explicit opt-out: don't register even if installed
    'gemini-cli': { disabled: true },
  },
  defaultRunner: 'claude-code',
};
```

**Auto-discovery logic:**

```typescript
const RUNNER_BINARIES = {
  'claude-code': 'claude',
  'codex': 'codex',
  'gemini-cli': 'gemini',
};

for (const [runnerName, binary] of Object.entries(RUNNER_BINARIES)) {
  const resolved = resolveBinary(binary); // which(1) equivalent
  if (resolved) {
    registry.register(new Runner(runnerName, resolved, configOverrides));
  }
}
// CC is always registered (hard requirement)
```

Users never need to configure runners unless they want to override defaults.

### 4.5 Session Lifecycle (with multi-agent)

```
1. User creates session: POST /v1/sessions { agentId: "codex-reviewer" }
2. Session service resolves agent → runnerType: "codex"
3. Registry.get("codex") → CodexRunner
4. CodexRunner.start(sessionId, config) → spawns Codex CLI via subprocess transport
5. Session maps to Aegis session normally (SSE, REST, MCP, dashboard)
6. All existing features work: approve, reject, kill, transcript, export, etc.
```

**Key insight:** The session layer doesn't change. Only the runner layer does. This is why the abstraction was built in #3263.

## 5. Scope for This Issue

### In Scope
- [ ] CodexRunner — spawn `codex app-server --listen stdio://`, reuse NdjsonRpcTransport
- [ ] GeminiCliRunner — spawn `gemini --experimental-acp`, reuse NdjsonRpcTransport
- [ ] Auto-discovery of installed CLIs (`which claude`, `which codex`, `which gemini`)
- [ ] `GET /v1/runners` — runner capabilities API (available, version, features)
- [ ] Runner config in `aegis.config.ts` (overrides only)
- [ ] CLI: `ag run --agent codex "fix the tests"` (uses agent profile to pick runner)
- [ ] CLI: `ag runners list` (show available runners + status)
- [ ] Dashboard: agent type badge on sessions
- [ ] Docs: multi-agent guide, runner config reference, feature matrix

### NOT In Scope (future issues)
- Transport abstraction layer (YAGNI — NdjsonRpcTransport covers all three runners)
- Cursor, Copilot, Kimi, Devin, etc. runners (phase-4c)
- cc-connect / OpenACP bridge implementations (needs HTTP transport + per-bridge API research)
- Task Queue (#3970)
- Squads (#3981) / Autopilots (#3982)
- Runner marketplace / plugin system
- Per-runner cost tracking

## 6. Dependencies

| Dependency | Status | Blocks |
|-----------|--------|--------|
| #3971 Agent Profiles | 🔲 Not started | **Hard block** — can't resolve runnerType without agents |
| #3263 Runner abstraction | ✅ Done | Satisfied |
| ACP backend (Phase 3.5) | ✅ Done | Satisfied |
| ADR-0024 Agent identity | ✅ Proposed | Design aligned |

**Implementation cannot start until #3971 ships.** Architecture design (this doc) can proceed in parallel.

## 7. API Surface Changes

### New Endpoint: `GET /v1/runners`

Returns capabilities and status for all registered runners. Dashboard and CLI consume this.

```
GET /v1/runners
```

```json
{
  "runners": [
    {
      "name": "claude-code",
      "family": "local",
      "protocol": "acp",
      "available": true,
      "version": "2.1.145",
      "binaryPath": "/usr/local/bin/claude",
      "capabilities": {
        "mcp": true,
        "customPrompts": true,
        "toolPermissions": true,
        "multiTurn": true,
        "streaming": true
      }
    },
    {
      "name": "codex",
      "family": "local",
      "protocol": "subprocess",
      "available": false,
      "version": null,
      "binaryPath": null,
      "capabilities": {
        "mcp": false,
        "customPrompts": false,
        "toolPermissions": false,
        "multiTurn": true,
        "streaming": false
      }
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `available` | Binary found and healthy |
| `version` | Detected CLI version |
| `capabilities` | Feature support matrix — per-runner, not docs-only |

### New Config

```typescript
// aegis.config.ts — overrides only, auto-discovery handles defaults
{
  runners: {
    'claude-code': { command: '/usr/local/bin/claude' },
    'codex': { args: ['--json'] },
    'gemini-cli': { disabled: true },  // opt-out
  },
  defaultRunner: 'claude-code',
}
```

### Existing API (no changes)

```
POST /v1/sessions { agentId: "codex-reviewer" }  ← agentId from #3971
GET  /v1/sessions/:id                             ← runnerType in response
POST /v1/sessions/:id/send                        ← works via runner abstraction
```

### New CLI Commands

```
ag run --agent codex-reviewer "fix the tests"
ag agents list                                    ← from #3971
ag runners list                                   ← NEW: show available runners
```

## 8. Risk Assessment

### Low Risk
- Runner interface already exists and is tested
- Session layer is transport-agnostic
- File-based config is consistent with Aegis patterns

### Medium Risk
- **Feature parity** — Codex and Gemini CLI may not support all CC features (MCP, custom prompts, tool permissions). Need graceful degradation.
- **CLI flag differences** — each runner needs different spawn args. If Codex or Gemini change their CLI flags, runners break. Mitigation: version detection + flag mapping per version.

### High Risk
- **ACP protocol divergence** — each agent's ACP implementation may differ. OpenACP solved this by testing against each one. We'll need per-runner integration tests.
- **User expectations** — listing "Codex support" means it needs to work as smoothly as CC. Half-baked multi-agent is worse than single-agent.
- **Bridge reliability** — cc-connect and OpenACP are external processes. If they crash, Aegis sessions hang. Need health checks, timeouts, and fallback.
- **Bridge API coupling** — cc-connect and OpenACP have no stable public API. Their internal endpoints could change. Mitigation: abstract behind our bridge runner, version-pin the integration.

### Mitigation
- Ship runners one at a time: Codex first, then Gemini, then evaluate
- Per-runner integration tests in CI (mock where possible)
- Clear docs on what each runner supports (feature matrix)
- Beta flag: `runners.<name>.experimental: true`

## 9. Testing Strategy

### Unit Tests
- Runner registration, resolution, and auto-discovery
- Config parsing and override merging
- NdjsonRpcTransport reuse across runners (CC, Codex, Gemini)
- Dirty shutdown: SIGTERM ignored, SIGKILL fallback, process group kill
- Orphan detection on startup
- `GET /v1/runners` response shape

### Integration Tests
- Spawn Codex CLI with a simple prompt → verify output
- Spawn Gemini CLI with a simple prompt → verify output
- Kill runner mid-execution → verify cleanup
- Session lifecycle with non-CC runner

### E2E Tests
- Create session with Codex agent → approve → verify completion
- Switch between CC and Codex sessions → verify no conflicts

## 10. Docs Plan

When implementation ships:
1. **New guide:** `docs/guides/multi-agent.md` — setup, config, runner list, feature matrix
2. **Update:** `getting-started.md` — add "Using Codex" and "Using Gemini CLI" sections
3. **Update:** `api-reference.md` — runnerType field in session responses, `GET /v1/runners` endpoint
4. **Update:** `cli.md` — `ag runners list` command
5. **Update:** `enterprise.md` — runner configuration reference
6. **ADR:** Multi-agent architecture (this doc — ADR-0032)

---

## Appendix A: Competitive Transport Survey

| Agent | Protocol | Auth | Multi-turn | MCP | Notes |
|-------|----------|------|------------|-----|-------|
| Claude Code | ACP (JSON-RPC) | API key | ✅ | ✅ | Best supported |
| Codex CLI | ACP / subprocess | API key | ✅ | 🔲 | Gaining ACP support |
| Gemini CLI | stdio / subprocess | OAuth | ✅ | 🔲 | Google's CLI tool |
| Cursor | HTTP REST | API key | ✅ | ✅ | Agent API |
| Copilot | HTTP REST | OAuth | ✅ | 🔲 | GitHub CLI |
| Aider | subprocess | API key | ✅ | 🔲 | Python-based |
| Continue | subprocess | API key | ✅ | ✅ | VS Code extension |

## Appendix B: Questions for Team Review

### Resolved (Boss review, 2026-05-30)
1. ✅ **Transport priority** — subprocess first. ACP where available (CC only for now).
2. ✅ **Config** — `aegis.config.ts` only, overrides only. Auto-discovery handles registration.
3. ✅ **Scope** — CC + Codex + Gemini only. No Cursor/Copilot (phase-4c).
4. ✅ **Feature matrix** — exposed via `GET /v1/runners` API, not docs-only.
5. ✅ **Runner discovery** — auto-detect installed CLIs. Config is for overrides.

### Open
6. **Beta strategy** — ship Codex behind `experimental` flag, or wait for feature parity?
7. **Dashboard** — how much runner management UI in v1?
8. **Bridge health monitoring** — should Aegis actively health-check bridge endpoints, or fail on demand?
9. **Orphan reaper** — reuse #4378 session reaper pattern for stale runner processes?
