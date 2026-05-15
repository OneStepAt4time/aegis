# oh-my-claudecode Multi-Agent Orchestration Analysis

> Deep-dive analysis for Aegis learning — patterns, architecture, and comparative assessment

**Source:** `/home/bubuntu/projects/aegis/.claude-internals/oh-my-claudecode/`
**Date:** 2026-04-01
**Version:** v4.4.0+ (post-swarm removal, CLI-first team runtime)

---

## Executive Summary

oh-my-claudecode (OMC) is a **skill-based orchestration layer** for Claude Code that provides:
- **Team mode**: Canonical staged pipeline with N coordinated workers
- **Mixed-model support**: Claude + Codex + Gemini via tmux CLI workers
- **Persistence loops**: Ralph for guaranteed completion with verification
- **Parallel execution**: Ultrawork for high-throughput concurrent agents

**Key innovation**: OMC treats orchestration as **behavior injection** through skills and hooks, not as a separate runtime. Claude Code remains the execution engine; OMC adds coordination semantics on top.

---

## 1. Team Orchestration — The Staged Pipeline

### Pipeline Stages

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

| Stage | Purpose | Agents Used |
|-------|---------|-------------|
| **team-plan** | Decompose task, create task graph | `explore` (haiku), `planner` (opus), optionally `analyst`/`architect` |
| **team-prd** | Clarify requirements, acceptance criteria | `analyst` (opus), optionally `critic` |
| **team-exec** | Execute tasks in parallel | `executor` (sonnet), `debugger`, `designer`, `writer`, `test-engineer` |
| **team-verify** | Verify completion with evidence | `verifier` (sonnet), `security-reviewer`, `code-reviewer` (opus) |
| **team-fix** | Fix defects from verification | `executor`, `debugger` |

### Stage Transitions

- **Entry/Exit Criteria**: Each stage has explicit entry conditions and exit gates
- **Handoff Documents**: Lead writes `.omc/handoffs/<stage>.md` with decisions, rejected alternatives, risks
- **State Persistence**: `state_write(mode="team", current_phase="team-exec", ...)` for resume

### How It Works

1. **Lead parses input**: Extracts N (worker count), agent-type, task description
2. **Lead decomposes**: Uses `explore`/`architect` to break task into N subtasks
3. **Team creation**: `TeamCreate` → lead becomes `team-lead@{team-name}`
4. **Task creation**: `TaskCreate` for each subtask with dependencies
5. **Worker spawning**: `Task(subagent_type, team_name, name)` for each worker
6. **Monitor loop**: Lead polls `TaskList`, receives `SendMessage` from workers
7. **Completion**: Shutdown protocol → `TeamDelete` → state cleanup

### Key Patterns

**Pre-assignment to avoid races**:
```json
// Lead assigns owners BEFORE spawning workers
{ "taskId": "1", "owner": "worker-1" }
```

**Internal tasks for lifecycle tracking**:
- Each worker gets an auto-created internal task (`metadata._internal: true`)
- Filter these when counting real progress

**Worker preamble injection**:
```markdown
You are a TEAM WORKER in team "{team_name}". Your name is "{worker_name}".
You report to the team lead ("team-lead").

== WORK PROTOCOL ==
1. CLAIM: Call TaskList to see your assigned tasks
2. WORK: Execute the task using your tools
3. COMPLETE: Mark task completed
4. REPORT: Notify lead via SendMessage
5. NEXT: Check for more tasks
6. SHUTDOWN: Respond to shutdown_request
```

---

## 2. Worker Spawning — Claude / Codex / Gemini

### Three Worker Types

| Type | Runtime | Capabilities | Use Case |
|------|---------|--------------|----------|
| **claude_worker** | Claude Code Task tool | Full tool access, team messaging | Iterative work needing coordination |
| **codex_worker** | Codex CLI in tmux pane | Filesystem access, autonomous | Code review, security, architecture |
| **gemini_worker** | Gemini CLI in tmux pane | Filesystem access, autonomous | UI/design, docs, large context |

### CLI Worker Lifecycle (Codex/Gemini)

1. **Prompt file creation**: Lead writes `.omc/state/team/{team}/{worker}/inbox.md`
2. **tmux pane spawn**: `tmux split-window` or detached session
3. **Worker bootstrap**: Generates overlay markdown with protocol instructions
4. **Autonomous execution**: Worker reads files, makes changes, writes output
5. **Result collection**: Lead reads `.omc/artifacts/` output files
6. **Cleanup**: Pane killed on shutdown

### Key Difference: Claude vs CLI Workers

| Aspect | Claude Workers | CLI Workers |
|--------|---------------|-------------|
| Communication | `SendMessage` (real-time) | File-based (inbox/outbox) |
| Task awareness | `TaskList`/`TaskUpdate` | None (lead manages) |
| Lifecycle | Persistent teammate | One-shot job |
| Coordination | Full team participation | Isolated execution |

---

## 3. tmux Management — Parallel Worker Runtime

### Session Naming Convention

```
omc-team-{teamName}-{workerName}
```

### Session Modes

| Mode | When Used | Description |
|------|-----------|-------------|
| **split-pane** | Inside tmux (`$TMUX` set) | Split current window |
| **dedicated-window** | New window requested | New window in existing session |
| **detached-session** | Plain terminal or cmux | Create detached session |

### Shell Detection

OMC detects and configures the appropriate shell:
- Priority: User's `$SHELL` if zsh/bash → zsh candidates → bash candidates → /bin/sh
- Sources rc file (`.zshrc`, `.bashrc`) for environment
- Handles MSYS2/Git Bash on Windows

### Worker Launch Command Structure

```bash
env KEY='value' /bin/bash -lc '[ -f ~/.bashrc ] && . ~/.bashrc; exec "$@"' -- claude --model sonnet
```

### Health Monitoring

- **Heartbeat files**: `.omc/state/team/{team}/{worker}/heartbeat.json`
- **Status files**: `.omc/state/team/{team}/{worker}/status.json`
- **Dead pane detection**: No heartbeat + stuck task → reassign

---

## 4. Communication Between Agents

### Inbox/Outbox Model (JSONL)

**File locations**:
```
~/.claude/teams/{team}/
├── inbox/{worker}.jsonl      # Lead → Worker
├── outbox/{worker}.jsonl     # Worker → Lead
└── signals/{worker}.shutdown # Shutdown signal
```

**Cursor-based reading**:
- Each worker tracks byte offset in `.offset` file
- Only reads new messages since last cursor position
- Handles file truncation gracefully

### Mailbox Messages (Team Native)

For Claude workers using native team tools:

```json
// Direct message
{
  "type": "message",
  "recipient": "worker-2",
  "content": "Task #3 is now unblocked",
  "summary": "New task assignment"
}
```

### Shutdown Protocol (Blocking)

```
1. Lead sends shutdown_request
2. Worker responds with shutdown_response(approve: true)
3. Worker terminates
4. Lead calls TeamDelete (ONLY after all workers confirmed)
5. Orphan scan: cleanup-orphans.mjs kills stray processes
```

---

## 5. Pipeline Stages — Detailed Breakdown

### team-plan (Decomposition)

**Agents**: `explore` (haiku), `planner` (opus)

**Activities**:
1. Scan codebase for relevant files
2. Identify dependencies between components
3. Break task into file-scoped or module-scoped subtasks
4. Create dependency graph (blockedBy relationships)

**Output**: Task graph with N subtasks

**Handoff format**:
```markdown
## Handoff: team-plan → team-prd
- **Decided**: [key decisions made in this stage]
- **Rejected**: [alternatives considered and why rejected]
- **Risks**: [identified risks for the next stage]
- **Files**: [key files created or modified]
- **Remaining**: [items left for the next stage]
```

### team-prd (Requirements Clarification)

**Agents**: `analyst` (opus), `critic` (opus)

**Activities**:
1. Extract acceptance criteria from task description
2. Identify hidden constraints and edge cases
3. Challenge scope with `critic` agent

**Output**: Explicit acceptance criteria, bounded scope

### team-exec (Execution)

**Agents**: `executor` (sonnet/opus), `debugger`, `designer`, `writer`

**Activities**:
1. Workers claim tasks via `TaskUpdate`
2. Execute work with full tool access
3. Report progress via `SendMessage`
4. Mark completed or failed

**Output**: Implementation files, test files

**Routing rules**:
- Analysis/review → architect/critic Claude agents
- UI work → designer agents
- CLI workers → one-shot, no team communication

### team-verify (Verification)

**Agents**: `verifier` (sonnet), `security-reviewer`, `code-reviewer` (opus)

**Activities**:
1. Run build/typecheck
2. Run tests
3. Security review (if auth/crypto)
4. Code review (if >20 files or architectural)

**Verification tiers**:
| Size | Minimum Reviewer |
|------|------------------|
| <5 files, <100 lines | Lightweight verifier |
| Standard | Standard verifier |
| >20 files or security | `security-reviewer` + `code-reviewer` (opus) |

**Output**: Verification report, fix tasks (if failures)

### team-fix (Fix Loop)

**Agents**: `executor`, `debugger`

**Activities**:
1. Process fix tasks from verification
2. Loop back to team-exec for re-execution
3. Bounded by `max_fix_loops` (default: 3)

**Terminal states**: `complete`, `failed`, `cancelled`

---

## 6. Mixed-Model Support — Claude + Codex + Gemini

### Model Routing by Tier

| Tier | Model | Cost | Use For |
|------|-------|------|---------|
| LOW | Haiku | $1/$5 per M tokens | Simple lookups, quick checks |
| MEDIUM | Sonnet | $3/$15 per M tokens | Standard implementation |
| HIGH | Opus | $5/$25 per M tokens | Architecture, complex analysis |

### Agent-to-Tier Mapping

```typescript
// Default assignments
haiku:  ['explore', 'writer']
sonnet: ['executor', 'debugger', 'test-engineer', 'designer', 'verifier']
opus:   ['architect', 'planner', 'critic', 'code-reviewer', 'analyst']
```

### Cost Optimization

**47% savings** through intelligent routing:
- 70% simple lookups → Haiku (67% savings)
- 25% standard work → Sonnet (no change)
- 5% complex work → Opus (higher cost, but rare)

### ccg Skill (Tri-Model Synthesis)

```
/oh-my-claudecode:ccg "Review this PR"
    │
    ├─→ omc ask codex "architecture review"
    │      └─→ .omc/artifacts/ask/codex-*.md
    │
    ├─→ omc ask gemini "UX review"
    │      └─→ .omc/artifacts/ask/gemini-*.md
    │
    └─→ Claude synthesizes both → unified answer
```

### Environment Variables for Model Control

```bash
ANTHROPIC_MODEL=claude-sonnet-4-20250514
CLAUDE_CODE_BEDROCK_SONNET_MODEL=...
OMC_MODEL_MEDIUM=...
```

---

## 7. Session Lifecycle — Creation, Monitoring, Cleanup

### Creation

```typescript
// 1. Create team
TeamCreate({ team_name: "fix-ts-errors", description: "..." })

// 2. Create tasks
TaskCreate({ subject: "...", description: "...", activeForm: "..." })

// 3. Set dependencies
TaskUpdate({ taskId: "3", addBlockedBy: ["1"] })

// 4. Pre-assign owners
TaskUpdate({ taskId: "1", owner: "worker-1" })

// 5. Spawn workers (parallel!)
Task({ subagent_type: "executor", team_name: "fix-ts-errors", name: "worker-1", prompt: "..." })
Task({ subagent_type: "executor", team_name: "fix-ts-errors", name: "worker-2", prompt: "..." })
```

### Monitoring

**Two channels**:
1. **Inbound messages**: Workers send `SendMessage` → arrives as conversation turn
2. **TaskList polling**: Periodic status check

**Watchdog policy**:
- Task stuck >5 min → status check
- Task stuck >10 min → reassign
- Worker fails 2+ tasks → stop assigning

**Status tracking**:
```json
// .omc/state/team/{team}/workers/{worker}/status.json
{ "state": "working", "updated_at": "2026-04-01T01:00:00Z" }
```

**Heartbeat monitoring**:
```json
// .omc/state/team/{team}/workers/{worker}/heartbeat.json
{ 
  "pid": 12345,
  "last_turn_at": "2026-04-01T01:00:00Z",
  "turn_count": 5,
  "alive": true
}
```

### Cleanup

```typescript
// 1. Verify all tasks terminal
TaskList() → all completed or failed

// 2. Request shutdown
SendMessage({ type: "shutdown_request", recipient: "worker-1", ... })

// 3. Wait for response (30s timeout per worker)
// Worker responds with shutdown_response

// 4. Delete team
TeamDelete({ team_name: "fix-ts-errors" })

// 5. Clear OMC state
state_clear(mode="team")

// 6. Orphan scan
node scripts/cleanup-orphans.mjs --team-name fix-ts-errors
```

### Resume

```typescript
// Detect existing state
const state = state_read(mode="team")
if (state.active && state.current_phase !== "complete") {
  // Resume from last incomplete stage
  // Read .omc/handoffs/ for context
}
```

---

## 8. What Aegis Can Learn

### ✅ Patterns to Adopt

#### 1. Staged Pipeline with Explicit Handoffs

**OMC pattern**:
```
team-plan → team-prd → team-exec → team-verify → team-fix
```

**Aegis equivalent**: Define explicit stages for CC sessions:
```
plan → implement → verify → fix
```

Each stage writes a handoff document for context preservation.

#### 2. Pre-Assignment to Avoid Races

**OMC pattern**: Lead assigns `owner` before spawning workers.

**Aegis application**: When spawning multiple CC sessions for parallel work, pre-assign tasks to avoid two sessions claiming the same work.

#### 3. Worker Preamble Injection

**OMC pattern**: Generated markdown with protocol instructions injected into worker context.

**Aegis application**: Generate consistent preamble for CC sessions:
```markdown
You are AEGIS-WORKER-{id}. 
Your task: {task}
Report progress via: {mechanism}
When blocked: {escalation path}
```

#### 4. Inbox/Outbox for CLI Workers

**OMC pattern**: JSONL files with cursor-based reading for non-Claude workers.

**Aegis application**: If Aegis spawns Codex/Gemini workers, use file-based communication:
```
~/.aegis/sessions/{session}/workers/{worker}/
├── inbox.jsonl
├── outbox.jsonl
└── heartbeat.json
```

#### 5. Shutdown Protocol (Blocking)

**OMC pattern**: `shutdown_request` → `shutdown_response` → cleanup.

**Aegis application**: Never kill CC sessions without graceful shutdown. Send termination request, wait for acknowledgment, then cleanup.

#### 6. Tiered Agent Routing

**OMC pattern**: Haiku for simple, Sonnet for standard, Opus for complex.

**Aegis application**: Route tasks to appropriate model:
- Simple queries → fast model
- Implementation → standard model
- Architecture review → best model

### ⚠️ Patterns to Evaluate Carefully

#### 1. tmux as Primary Runtime

**OMC approach**: Heavy reliance on tmux for worker panes.

**Aegis consideration**: 
- ✅ Good for local development
- ❌ Complex for remote/headless environments
- **Alternative**: Use Aegis HTTP API + process management (systemd) for workers

#### 2. File-Based State

**OMC approach**: `.omc/state/` with JSON files.

**Aegis consideration**:
- ✅ Simple, debuggable
- ❌ Race conditions without locking
- **OMC mitigation**: `withTaskLock()` for critical operations
- **Aegis approach**: Keep in-memory state with periodic persistence (current design)

#### 3. Claude Code Native Teams

**OMC approach**: Uses CC's `TeamCreate`/`TaskCreate`/`SendMessage` APIs.

**Aegis consideration**:
- ✅ Native integration, no reinventing
- ❌ Tied to CC's implementation
- **Decision**: Aegis wraps CC sessions; can leverage native teams if available

### ❌ Patterns to Avoid

#### 1. Magic Keywords in Hooks

**OMC approach**: Hardcoded keyword detection in `keyword-detector` hook.

**Problem**: Not customizable, conflicts possible.

**Aegis approach**: Explicit skill invocation (`/aegis:team`) or configuration-driven keywords.

#### 2. Broadcast Messaging

**OMC approach**: `SendMessage(type="broadcast")` sends N messages.

**Problem**: O(N) cost, easy to abuse.

**Aegis approach**: Prefer targeted messages; use broadcast only for critical alerts.

#### 3. SQLite Dependency (Legacy)

**OMC removed**: `swarm` skill used SQLite (`better-sqlite3`).

**Lesson**: Native file-based state (CC teams) is simpler and has fewer dependencies.

**Aegis**: Keep state simple — JSON files or in-memory with persistence.

---

## 9. Comparative Assessment: OMC vs Aegis

| Aspect | OMC | Aegis | Assessment |
|--------|-----|-------|------------|
| **Architecture** | Skill-based injection | HTTP bridge + sessions | Different approaches, both valid |
| **Worker runtime** | tmux panes | CC sessions via API | Aegis more remote-friendly |
| **Communication** | Inbox/outbox + SendMessage | HTTP API + MCP | Aegis has richer interface |
| **State storage** | `.omc/` JSON files | In-memory + JSON persistence | Similar |
| **Mixed models** | Codex/Gemini CLI | Not yet | Aegis could add |
| **Verification** | Tiered reviewers | Not formalized | Aegis needs this |
| **Persistence** | Ralph loop | Not yet | Aegis needs retry logic |
| **Dashboard** | HUD statusline | Web dashboard | Aegis has better visibility |

### What Aegis Does Better

1. **HTTP API**: Clean REST interface for external orchestration
2. **MCP Server**: Native Claude Code integration
3. **Dashboard**: Web UI for monitoring
4. **Session management**: Persistent sessions with worktrees
5. **Remote-friendly**: No tmux dependency

### What OMC Does Better

1. **Staged pipeline**: Explicit phase transitions with handoffs
2. **Worker protocol**: Consistent preamble and lifecycle
3. **Verification**: Tiered review with architect/critic
4. **Mixed models**: Codex/Gemini integration
5. **Persistence**: Ralph loop for guaranteed completion

---

## 10. Recommendations for Aegis

### Short-Term (Implement Now)

| Item | Description | Effort |
|------|-------------|--------|
| **Staged pipeline** | Define `plan → implement → verify → fix` stages for sessions | Medium |
| **Worker preamble** | Generate consistent context for spawned CC sessions | Low |
| **Handoff documents** | Write `.aegis/handoffs/{stage}.md` for context preservation | Low |
| **Graceful shutdown** | Implement request/response protocol before session termination | Medium |

### Medium-Term (Plan For)

| Item | Description | Effort |
|------|-------------|--------|
| **Tiered verification** | Add `verifier` role with architect review option | Medium |
| **Mixed-model support** | Add Codex/Gemini workers via CLI | High |
| **Retry logic** | Implement Ralph-like persistence for guaranteed completion | Medium |
| **Task dependencies** | Support blockedBy relationships in task graph | Medium |

### Long-Term (Consider)

| Item | Description | Effort |
|------|-------------|--------|
| **Native team integration** | Leverage CC's TeamCreate/TaskCreate if appropriate | High |
| **Dynamic scaling** | Add/remove workers mid-session | High |
| **Cost optimization** | Model routing based on task complexity | Medium |
| **Event log** | JSONL audit trail for all session events | Low |

---

## Appendix A: Key Files to Study

| File | Purpose |
|------|---------|
| `skills/team/SKILL.md` | Team orchestration protocol |
| `src/team/runtime.ts` | Team runtime implementation (v1) |
| `src/team/runtime-v2.ts` | Event-driven runtime |
| `src/team/tmux-session.ts` | tmux management |
| `src/team/inbox-outbox.ts` | Communication channels |
| `src/team/worker-bootstrap.ts` | Worker preamble generation |
| `src/team/monitor.ts` | Snapshot-based monitoring |
| `skills/ralph/SKILL.md` | Persistence loop |
| `skills/ultrawork/SKILL.md` | Parallel execution |
| `skills/ccg/SKILL.md` | Mixed-model synthesis |
| `AGENTS.md` | Orchestration guidance |

---

## Appendix B: OMC Team State Schema

```typescript
// .omc/state/team/{team}/state.json
interface TeamState {
  active: boolean;
  current_phase: 'team-plan' | 'team-prd' | 'team-exec' | 'team-verify' | 'team-fix' | 'complete' | 'failed';
  team_name: string;
  agent_count: number;
  agent_types: string;
  task: string;
  fix_loop_count: number;
  max_fix_loops: number;
  linked_ralph: boolean;
  stage_history: string; // "team-plan:T1,team-prd:T2,..."
}

// .omc/state/team/{team}/workers/{worker}/status.json
interface WorkerStatus {
  state: 'idle' | 'working' | 'blocked' | 'done' | 'failed';
  updated_at: string;
}

// .omc/state/team/{team}/workers/{worker}/heartbeat.json
interface WorkerHeartbeat {
  pid: number;
  last_turn_at: string;
  turn_count: number;
  alive: boolean;
}
```

---

## Appendix C: Shutdown Protocol Sequence

```
Lead                              Worker
  │                                 │
  │  shutdown_request               │
  ├────────────────────────────────>│
  │  {request_id: "shutdown-XXX"}   │
  │                                 │
  │                                 │ Complete current task
  │                                 │ Write final status
  │                                 │
  │  shutdown_response              │
  │<────────────────────────────────┤
  │  {approve: true, request_id}    │
  │                                 │
  │                                 │ Exit process
  │                                 X
  │
  │  TeamDelete
  ├──────────────────────────────────> ~/.claude/teams/{team}/ deleted
  │
  │  state_clear
  ├──────────────────────────────────> .omc/state/team/ cleared
  │
  X
```

---

*End of analysis — Generated 2026-04-01*
