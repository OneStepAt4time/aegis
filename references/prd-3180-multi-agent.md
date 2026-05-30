# PRD: Multi-Agent Support (#3180)

**Status:** Draft (architecture approved, implementation blocked on #3971)
**Assignee:** Implementation: Hephaestus (after #3971). Architecture: Athena + Scribe.
**Priority:** P1 — competitive existential (cc-connect has 10+ runners, OpenACP has 28+)
**Blocked by:** #3971 (Agent Profiles — runnerType field required)
**ADR refs:** ADR-0032 (Multi-Agent Architecture), ADR-0006 (Middleware Not Framework), ADR-0024 (Agent Identity)
**Co-authors:** Athena (product specs), Scribe (architecture + this document)

---

## 1. Problem Statement

Aegis only supports Claude Code. Every competitor supports 10+ agent backends:

| Competitor | Agents | Stars | Approach |
|-----------|--------|-------|----------|
| OpenACP | 28+ | ~2K | ACP-native, one bridge per agent |
| cc-connect | 10+ | 11K | Chat-first, agent-specific adapters, 47% star growth in 23 days |
| ruflo | 98 | ~1K | Plugin-based, MCP-heavy |
| mission-control | 5+ | ~500 | Gateway pattern |

**The gap is existential.** Users choose the tool that supports their preferred AI coding agent. Without multi-agent, Aegis is invisible to anyone not using Claude Code.

The Runner interface already exists (#3263, `src/runners/`). This PRD covers wiring it to real backends.

## 2. User Stories

| # | As a… | I want to… | So that… |
|---|-------|-----------|----------|
| 1 | Solo dev using Codex | Run `ag run --agent codex-reviewer "fix tests"` | My Codex session is managed by Aegis with approvals, SSE, and dashboard |
| 2 | Solo dev using Gemini | Create a Gemini CLI agent with custom instructions | I can manage Gemini sessions from my phone via Telegram |
| 3 | Developer | See which runner a session is using in the dashboard | I understand why it behaves a certain way |
| 4 | Developer | List available runners with `ag runners list` | I know which CLIs are installed and compatible |
| 5 | Developer | Run `ag run` without --agent flag | It defaults to Claude Code with zero breakage |
| 6 | Team lead | Archive a Codex agent | New sessions stop using it, active sessions continue |
| 7 | DevOps | Configure custom binary paths in aegis.config.ts | I can point Aegis to specific CLI versions |
| 8 | Developer | Get a clear error when a runner binary is missing | I know I need to install Codex, not debug Aegis |

## 3. Requirements

### Must Have (P0)

- **CodexRunner**: spawn `codex app-server --listen stdio://`, reuse NdjsonRpcTransport
- **GeminiCliRunner**: spawn `gemini --experimental-acp`, reuse NdjsonRpcTransport
- **Auto-discovery**: detect installed CLIs via PATH at startup (`which claude`, `which codex`, `which gemini`)
- **GET /v1/runners**: runner capabilities API (available, version, binary path, feature flags)
- **Session wiring**: agent profile's `runnerType` resolved to correct runner via RunnerRegistry
- **Backward compatibility**: `ag run` without --agent defaults to Claude Code (zero breakage)
- **Graceful degradation**: runner unavailable = clear error ("Codex CLI not found"), not crash
- **Runner config**: overrides in `aegis.config.ts` (custom binary path, args, disabled flag)
- **Dirty shutdown**: SIGTERM → 5s → SIGKILL for all local runners. Process group kill + reap.
- `npm run gate` passes

### Should Have (P1)

- **CLI: `ag runners list`**: show available runners, binary paths, versions, health status
- **Dashboard: runner badge**: session list shows runner type icon/badge per session
- **Dashboard: runner health**: agent detail shows runner installation status
- **Runner version detection**: parse `--version` output for each CLI
- **Feature matrix per runner**: Codex may not support MCP or custom prompts — surface this in API
- **Orphan detection**: on startup, check for stale processes from previous Aegis instance

### Could Have (P2)

- **Beta flag**: `runners.<name>.experimental: true` — mark runners as experimental in API/dashboard
- **Runner health monitoring**: periodic health check for bridge runners (when implemented)
- **Per-runner cost tracking**: session cost broken down by runner type

### Won't Have (explicitly out of scope)

- Transport abstraction layer (YAGNI — NdjsonRpcTransport covers all three runners)
- Cursor, Copilot, Kimi, Devin, etc. runners (phase-4c)
- cc-connect / OpenACP bridge implementations (needs HTTP transport, future issue)
- Task Queue (#3970), Squads (#3981), Autopilots (#3982)
- Runner marketplace / plugin system
- Model routing across runners

## 4. API Surface

### New Endpoint: GET /v1/runners

```
GET /v1/runners
Authorization: Bearer <api-key>
```

```json
{
  "runners": [
    {
      "name": "claude-code",
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
      "available": false,
      "version": null,
      "binaryPath": null,
      "capabilities": {
        "mcp": false,
        "customPrompts": false,
        "toolPermissions": false,
        "multiTurn": true,
        "streaming": true
      }
    },
    {
      "name": "gemini-cli",
      "available": true,
      "version": "0.32.1",
      "binaryPath": "/usr/local/bin/gemini",
      "capabilities": {
        "mcp": false,
        "customPrompts": true,
        "toolPermissions": false,
        "multiTurn": true,
        "streaming": true
      }
    }
  ]
}
```

**RBAC:** All roles (admin, operator, viewer) can read runner info. No mutation — runners are discovered, not created via API.

### Existing Endpoints (no breaking changes)

```
POST /v1/sessions { agentId: "codex-reviewer" }  ← #3971 resolves agent → runnerType
GET  /v1/sessions/:id                             ← runner_name in response
POST /v1/sessions/:id/send                        ← works via runner abstraction
DELETE /v1/sessions/:id                            ← kill via runner.disconnect()
```

Session response gains one field:

```json
{
  "id": "sess_abc123",
  "runner_name": "codex",
  "agent_id": "codex-reviewer",
  ...
}
```

### New CLI Commands

```
ag run --agent codex-reviewer "fix the tests"    ← resolves agent → runner → spawns
ag runners list                                    ← show available runners + status
```

### Config (aegis.config.ts)

```typescript
export default {
  runners: {
    'claude-code': { command: '/usr/local/bin/claude' },  // override binary
    'codex': { args: ['--json', '--quiet'] },             // extra args
    'gemini-cli': { disabled: true },                      // opt-out
  },
  defaultRunner: 'claude-code',
};
```

## 5. Acceptance Criteria

1. `ag run --agent <codex-agent>` spawns a Codex session (CodexRunner via NdjsonRpcTransport)
2. `ag run --agent <gemini-agent>` spawns a Gemini session (GeminiCliRunner via NdjsonRpcTransport)
3. `ag run` (no agent flag) spawns CC session — zero breakage, fully backward compatible
4. `GET /v1/runners` returns all discovered runners with version, binary path, capabilities
5. Session API response includes `runner_name` field
6. Dashboard shows runner type badge per session
7. Runner falls back gracefully if binary not found: clear error message, not crash
8. Dirty shutdown: SIGTERM → 5s → SIGKILL works for all three runners
9. Auto-discovery detects all three CLIs via PATH without config
10. `aegis.config.ts` overrides work (custom binary path, disabled flag)
11. `npm run gate` passes
12. Tests: runner wiring, Codex start/kill, Gemini start/kill, fallback when binary missing, auto-discovery, dirty shutdown

## 6. Dependencies + Blockers

| Dependency | Status | Impact |
|-----------|--------|--------|
| #3971 Agent Profiles | 🔲 In progress (Hephaestus) | **Hard block** — can't resolve runnerType without agents |
| #3263 Runner abstraction | ✅ Merged | Interface + registry + stubs ready |
| ACP backend (Phase 3.5) | ✅ Live | NdjsonRpcTransport exists and works |
| ADR-0024 Agent identity | ✅ Approved | Design aligned |
| ADR-0032 Multi-agent arch | ✅ Approved | This document |

**Implementation cannot start until #3971 ships.**

## 7. Security Model

### 7.1 Runner Isolation

Each runner runs as an isolated subprocess. Runners cannot:
- Access Aegis internal state
- Communicate with other runners
- Elevate permissions beyond the agent's effective permissions

### 7.2 Binary Validation

Auto-discovery resolves binaries via PATH. To prevent path injection:
- Binary must be a regular file (not symlink to /dev/null, etc.)
- Binary must be executable by the Aegis process user
- Config overrides use `path.resolve()` — relative paths resolved against workDir
- Custom binary paths validated at startup, not at session spawn (fail fast)

### 7.3 Permission Inheritance

Agent permissions (from #3971) flow to the runner:
- Runner receives the agent's `effectivePermissions()` at session start
- Runner cannot perform actions outside the agent's permission scope
- If agent owner's key is revoked mid-session, next API call fails hard (per #3971 security model)

### 7.4 Environment Variable Isolation

Agent `custom_env` passes to runner subprocess. Security rules:
- No overriding Aegis internal env vars (`AEGIS_*`)
- No access to other agents' env vars
- Secrets in env vars are NOT logged (redacted in transcript)
- `PATH` cannot be overridden per-agent (use `command` config for custom binary path)

### 7.5 Dirty Shutdown Safety

- Force-kill uses process group kill (`kill(-pgid, SIGKILL)`) — kills all child processes
- No orphan processes after shutdown
- On startup, orphan detection reaps stale processes from previous instance

### 7.6 Runner Version Pinning (future)

Not in scope for this issue, but the architecture supports:
- Minimum version requirement per runner
- Warning when runner version is below recommended
- Blocking when runner version is known-broken

## 8. Out of Scope

| Feature | Reason | When |
|---------|--------|------|
| Transport abstraction | YAGNI — NdjsonRpcTransport covers all 3 runners | If a runner needs non-ACP transport |
| Cursor runner | Phase-4c | After 3 local runners ship |
| Copilot runner | Phase-4c | After 3 local runners ship |
| cc-connect bridge | Needs HTTP transport + API research | Future issue |
| OpenACP bridge | Needs HTTP transport + API research | Future issue |
| Model routing | Agent framework territory, not middleware | Never (ADR-0006) |
| Task Queue (#3970) | Separate feature | After multi-agent |
| Squads (#3981) | Depends on multi-agent | After multi-agent |
| Runner marketplace | Premature | Phase 4+ |

## 9. Testing Strategy

### Unit Tests
- Runner registration, resolution, auto-discovery
- Config parsing and override merging
- NdjsonRpcTransport reuse across all three runners
- Dirty shutdown: SIGTERM ignored, SIGKILL fallback, process group kill
- Orphan detection on startup
- `GET /v1/runners` response shape
- Binary validation (path injection prevention)

### Integration Tests
- Spawn Codex CLI with simple prompt → verify output
- Spawn Gemini CLI with simple prompt → verify output
- Kill runner mid-execution → verify cleanup (no orphan processes)
- Session lifecycle with non-CC runner (create → send → approve → kill)
- Auto-discovery with multiple CLIs installed

### E2E Tests
- Create session with Codex agent → approve → verify completion
- Switch between CC and Codex sessions → verify no conflicts
- Runner not installed → clear error message in CLI and API

## 10. Implementation Phases

### Phase A: Profile → Runner Wiring (after #3971)
- Extend `session.ts` — resolve agent profile's `runnerType`, route to correct runner
- Default to `claude-code` when no agent specified
- Session metadata includes `runner_name`

### Phase B: Codex Runner
- Replace `stubs/codex-runner.ts` with real implementation
- Spawn `codex app-server --listen stdio://`
- Reuse NdjsonRpcTransport
- Binary discovery via PATH

### Phase C: Gemini Runner
- Replace `stubs/gemini-runner.ts` with real implementation
- Spawn `gemini --experimental-acp`
- Reuse NdjsonRpcTransport
- Binary discovery via PATH

### Phase D: API + Dashboard
- `GET /v1/runners` endpoint
- `ag runners list` CLI command
- Dashboard runner badge per session
- Runner health indicator

## 11. Success Metrics

**Primary:** Create a Codex agent → run session → see it in dashboard in <60 seconds. Same for Gemini.

**Secondary:**
- Zero breakage for existing CC-only users
- Clear error when runner binary missing (actionable, not stack trace)
- Feature parity visible: `GET /v1/runners` shows what each runner can/can't do

## 12. Competitive Context

| Feature | Aegis (after #3180) | cc-connect | OpenACP |
|---------|-------------------|------------|---------|
| CC support | ✅ | ✅ | ✅ |
| Codex support | ✅ | ✅ | ✅ |
| Gemini support | ✅ | ✅ | ✅ |
| Dashboard | ✅ Full React UI | ✅ Web console | ❌ |
| RBAC | ✅ 3 roles | ❌ | ❌ |
| Audit trail | ✅ Immutable | ❌ | ❌ |
| MCP hooks | ✅ | ⚠️ Shell/HTTP only | ❌ |
| Telegram approval | ✅ | ✅ | ✅ |
| Session transcripts | ✅ Paginated | ❌ | ❌ |
| Bridge pattern | 🔲 Future | N/A (is a bridge) | N/A (is a bridge) |

**Our moat:** depth (control plane with RBAC, audit, MCP, dashboard) > breadth (more runners). Three runners covering 90% of the market + middleware depth.

## Reference

- **Issue:** https://github.com/OneStepAt4time/aegis/issues/3180
- **ADR-0032:** Multi-Agent Architecture (approved)
- **ADR-0024:** Agent Identity Model
- **ADR-0006:** Middleware Not Framework
- **#3971 PRD:** `references/prd-3971-agent-profiles.md`
- **Competitive:** cc-connect (#3004), OpenACP (#3003), landscape (#3016)
- **Existing code:** `src/runners/` (types.ts, registry.ts, stubs/)
- **Existing transport:** `src/acp-lifecycle/ndjson-rpc-transport.ts`
