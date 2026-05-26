# Technical Brief: Multi-Agent Orchestration for Aegis

> **Author:** Hephaestus (Subagent Analysis)  
> **Date:** 2026-04-01  
> **Purpose:** Integration blueprint for staged pipeline multi-agent orchestration based on oh-my-claudecode patterns  
> **Target Version:** Aegis v0.5.0+

---

## Executive Summary

This brief outlines a roadmap for bringing **team-based multi-agent orchestration** to Aegis, inspired by oh-my-claudecode's (OMC) proven `team` skill system. The goal is to enable Aegis to:

1. **Spawn coordinated teams** of N workers (Claude, Codex, Gemini) for parallel task execution
2. **Orchestrate staged pipelines** with explicit phase transitions (plan → exec → verify → fix)
3. **Provide worker lifecycle management** with health monitoring, task assignment, and graceful shutdown
4. **Expose this via HTTP API + MCP** — Aegis's unique advantage over OMC's slash-command interface

**Key Insight:** Aegis already has the foundation (session management, tmux control, event streaming). What's missing is the **coordination layer** — task distribution, inter-worker messaging, and pipeline state machines.

---

## 1. Current State — How Aegis Manages Sessions Today

### 1.1 Session Architecture

Aegis manages **isolated Claude Code sessions** in tmux windows:

```
SessionManager
├── sessions: Map<id, SessionInfo>
│   ├── id (UUID)
│   ├── windowId (tmux @N)
│   ├── windowName (cc-{shortid})
│   ├── workDir
│   ├── claudeSessionId (CC's session ID from hook)
│   ├── jsonlPath (transcript file)
│   ├── status: UIState
│   ├── byteOffset, monitorOffset (JSONL cursors)
│   ├── permissionMode
│   ├── activeSubagents?: Set<string>  ← tracks CC-native teammates
│   └── ccPid?: number  ← for swarm matching
```

**Key capabilities:**
- Create/kill sessions via tmux
- Send messages with delivery verification
- Read JSONL transcripts with incremental parsing
- Detect UI state (working, idle, permission_prompt, etc.)
- Handle permissions via API (approve/reject)
- Session reuse for idle sessions on same workDir

### 1.2 Swarm Monitor (Passive Discovery)

Aegis has a **SwarmMonitor** that discovers CC's native teammate sessions:

```typescript
SwarmMonitor
├── discovers sockets: /tmp/tmux-claude-swarm-{pid}
├── lists windows in swarm sockets
├── matches parent session by ccPid
├── emits events: teammate_spawned, teammate_finished
└── aggregates status: all_idle | some_working | all_dead
```

**Limitation:** SwarmMonitor is **passive** — it discovers CC-native teams but cannot SPAWN or MANAGE them. It's observability-only.

### 1.3 Pipeline System (Sequential Dependencies)

Aegis has a **PipelineManager** for sequential stages:

```typescript
PipelineManager
├── pipelines: Map<id, PipelineState>
├── stages: Array<{ name, status, dependsOn, sessionId }>
├── advancePipeline() — start stages whose deps are met
├── pollPipelines() — detect idle = completed
└── detectCycles() — validate DAG
```

**Limitation:** Pipelines are **sequential**, not parallel. Each stage gets ONE session. No task distribution to multiple workers.

### 1.4 Configuration

```typescript
Config
├── port, host, authToken
├── tmuxSession
├── stateDir (~/.aegis)
├── defaultPermissionMode: "bypassPermissions"
├── defaultSessionEnv: Record<string, string>
├── stallThresholdMs: 120000
└── allowedWorkDirs: string[]
```

**Missing:** No team-specific config (worker count, agent types, task routing rules).

---

## 2. OMC Architecture — Staged Pipeline, Workers, Handoff

### 2.1 Pipeline Stages

OMC defines a **canonical staged pipeline**:

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

| Stage | Purpose | Agents |
|-------|---------|--------|
| **team-plan** | Decompose task into subtasks, create dependency graph | explore (haiku), planner (opus), architect |
| **team-prd** | Clarify requirements, acceptance criteria | analyst (opus), critic |
| **team-exec** | Execute tasks in parallel | executor (sonnet), debugger, designer, test-engineer |
| **team-verify** | Verify completion with evidence | verifier (sonnet), security-reviewer, code-reviewer (opus) |
| **team-fix** | Fix defects from verification | executor, debugger |

### 2.2 Worker Spawning

OMC supports **three worker types**:

| Type | Runtime | Communication | Use Case |
|------|---------|---------------|----------|
| **claude_worker** | CC Task tool | SendMessage (real-time) | Iterative coordination |
| **codex_worker** | Codex CLI in tmux | Inbox/Outbox files | Architecture review |
| **gemini_worker** | Gemini CLI in tmux | Inbox/Outbox files | UI/design, docs |

**Spawning protocol:**
1. Lead creates team via `TeamCreate`
2. Lead decomposes task into N subtasks
3. Lead creates tasks via `TaskCreate` with dependencies
4. Lead **pre-assigns owners** to avoid race conditions
5. Lead spawns N workers via `Task(subagent_type, team_name, name)`
6. Workers claim pre-assigned tasks, execute, report completion

### 2.3 Worker Preamble Injection

Each worker receives a **generated preamble**:

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

### 2.4 Communication — Inbox/Outbox + SendMessage

**For CLI workers (Codex/Gemini):**
```
~/.claude/teams/{team}/
├── inbox/{worker}.jsonl      # Lead → Worker
├── outbox/{worker}.jsonl     # Worker → Lead
└── signals/{worker}.shutdown # Shutdown signal
```

**For Claude workers:**
- Native `SendMessage` API (real-time messaging)
- `TaskList` / `TaskUpdate` for task awareness

### 2.5 Handoff Documents

Between stages, OMC writes **handoff documents**:

```markdown
## Handoff: team-plan → team-prd
- **Decided**: [key decisions made in this stage]
- **Rejected**: [alternatives considered and why rejected]
- **Risks**: [identified risks for the next stage]
- **Files**: [key files created or modified]
- **Remaining**: [items left for the next stage]
```

This preserves context across phase transitions.

### 2.6 Shutdown Protocol (Blocking)

```
Lead                              Worker
  │                                 │
  │  shutdown_request               │
  ├────────────────────────────────>│
  │                                 │ Complete current task
  │                                 │ Write final status
  │  shutdown_response              │
  │<────────────────────────────────┤
  │  {approve: true}                │
  │                                 │ Exit process
  │                                 X
  │  TeamDelete
  ├──────────────────────────────────> cleanup state
```

**Key rule:** Never kill workers without graceful acknowledgment.

### 2.7 Health Monitoring

- **Heartbeat files:** `.omc/state/team/{team}/{worker}/heartbeat.json`
- **Status files:** `.omc/state/team/{team}/{worker}/status.json`
- **Watchdog policy:**
  - Task stuck >5 min → status check
  - Task stuck >10 min → reassign
  - Worker fails 2+ tasks → stop assigning

---

## 3. Gap Analysis

### 3.1 What Aegis Has (OMC Doesn't)

| Feature | Aegis | OMC |
|---------|-------|-----|
| HTTP REST API | ✅ 21 endpoints | ❌ Slash commands only |
| MCP Server | ✅ 21 tools + 4 resources | ❌ Internal tools only |
| SSE Event Streaming | ✅ Per-session events | ❌ None |
| Permission Remote Approval | ✅ API-based | ❌ TTY-based |
| Web Dashboard | ✅ Built-in | ❌ HUD statusline only |
| Session Reuse | ✅ Auto-reuse idle | ❌ No explicit reuse |
| Remote-Friendly | ✅ No tmux dependency | ⚠️ tmux-heavy |

### 3.2 What OMC Has (Aegis Doesn't)

| Feature | OMC | Aegis |
|---------|-----|-------|
| Team API | ✅ TeamCreate/TaskCreate | ❌ Single sessions only |
| Staged Pipeline | ✅ plan→prd→exec→verify→fix | ⚠️ Sequential only (no parallel) |
| Worker Preamble | ✅ Auto-generated protocol | ❌ None |
| Inter-Worker Messaging | ✅ Inbox/Outbox + SendMessage | ❌ No messaging |
| Task Distribution | ✅ Pre-assignment, claim, complete | ❌ No task concept |
| Handoff Documents | ✅ Stage-to-stage context | ❌ None |
| Graceful Shutdown | ✅ Request/response protocol | ❌ Kill-only |
| Mixed-CLI Workers | ✅ Claude + Codex + Gemini | ❌ Claude only |
| Agent Specialization | ✅ 32 roles with model routing | ❌ Generic sessions |
| Heartbeat Monitoring | ✅ Per-worker health | ⚠️ Per-session only |
| Tiered Verification | ✅ Architect/critic review | ❌ No verification stage |

### 3.3 Architectural Differences

| Aspect | OMC | Aegis |
|--------|-----|-------|
| **Deployment** | CC plugin (inside CC) | Standalone server (outside CC) |
| **Interface** | Slash commands + magic keywords | HTTP API + MCP |
| **Control Flow** | CC → OMC (push) | External → Aegis → CC (pull) |
| **State Source** | CC context + .omc/ files | tmux capture + JSONL transcript |
| **Runtime** | tmux panes (heavy) | tmux windows (lighter) |

### 3.4 Core Gap

**Aegis has no concept of:**
- **Team** — a group of coordinated workers
- **Task** — a unit of work assignable to a worker
- **Role** — specialized agent types (planner, executor, verifier)
- **Handoff** — context preservation across phases
- **Worker Protocol** — consistent lifecycle (claim → work → complete → report)

---

## 4. Proposed Architecture

### 4.1 Team API

```typescript
// POST /v1/teams
interface CreateTeamRequest {
  name: string;
  description: string;
  workerCount: number;
  workerType: 'claude' | 'codex' | 'gemini' | 'mixed';
  workDir: string;
  pipeline: 'staged' | 'parallel' | 'custom';
  stages?: StageConfig[];
  permissionMode?: string;
  maxFixLoops?: number;  // default: 3
}

interface Team {
  id: string;
  name: string;
  status: 'initializing' | 'planning' | 'executing' | 'verifying' | 'fixing' | 'completed' | 'failed';
  currentStage: string;
  workers: WorkerInfo[];
  tasks: TaskInfo[];
  handoffs: HandoffDocument[];
  createdAt: number;
  updatedAt: number;
}

interface WorkerInfo {
  id: string;
  name: string;
  role: 'lead' | 'executor' | 'verifier' | 'planner' | 'reviewer';
  sessionId?: string;  // Aegis session ID
  status: 'idle' | 'working' | 'blocked' | 'done' | 'failed';
  assignedTasks: string[];
  heartbeat: { lastAt: number; turnCount: number; alive: boolean };
}

interface TaskInfo {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'claimed' | 'in_progress' | 'completed' | 'failed';
  owner?: string;  // worker ID
  blockedBy: string[];  // task IDs
  stage: string;
  artifacts?: string[];  // file paths created
}

// GET /v1/teams/:id
// DELETE /v1/teams/:id (graceful shutdown)
// POST /v1/teams/:id/tasks (create task)
// POST /v1/teams/:id/messages (broadcast to workers)
```

### 4.2 Pipeline Stages

```typescript
interface StageConfig {
  name: string;
  agentType: 'haiku' | 'sonnet' | 'opus' | 'codex' | 'gemini';
  promptTemplate: string;  // Markdown with {{placeholders}}
  timeout?: number;
  entryCriteria?: (team: Team) => boolean;
  exitCriteria?: (team: Team) => boolean;
}

// Default staged pipeline
const DEFAULT_STAGED_PIPELINE: StageConfig[] = [
  {
    name: 'plan',
    agentType: 'opus',
    promptTemplate: PLAN_PROMPT,
    exitCriteria: (team) => team.tasks.filter(t => t.status === 'pending').length > 0,
  },
  {
    name: 'exec',
    agentType: 'sonnet',
    promptTemplate: EXEC_PROMPT,
    entryCriteria: (team) => team.currentStage === 'plan' && team.tasks.some(t => t.status === 'pending'),
  },
  {
    name: 'verify',
    agentType: 'sonnet',
    promptTemplate: VERIFY_PROMPT,
    entryCriteria: (team) => team.tasks.every(t => t.status === 'completed' || t.status === 'failed'),
  },
  {
    name: 'fix',
    agentType: 'sonnet',
    promptTemplate: FIX_PROMPT,
    entryCriteria: (team) => team.tasks.some(t => t.status === 'failed'),
  },
];
```

### 4.3 Worker Protocol

```typescript
// Generated preamble for each worker
function generateWorkerPreamble(team: Team, worker: WorkerInfo): string {
  return `
You are a TEAM WORKER in team "${team.name}". Your name is "${worker.name}".
Your role: ${worker.role}. You report to the team lead ("team-lead").

== WORK PROTOCOL ==
1. CLAIM: Check your assigned tasks. You own tasks: ${worker.assignedTasks.join(', ')}
2. WORK: Execute the task using your tools
3. REPORT: When done, write to ~/.aegis/teams/${team.id}/outbox/${worker.id}.jsonl:
   {"type": "task_complete", "taskId": "<id>", "artifacts": [...]}
4. BLOCKED: If blocked, write:
   {"type": "task_blocked", "taskId": "<id>", "reason": "..."}
5. NEXT: After reporting, check for more tasks
6. SHUTDOWN: When you receive {"type": "shutdown_request"}, respond with:
   {"type": "shutdown_response", "approve": true}

== COMMUNICATION ==
- Inbox: ~/.aegis/teams/${team.id}/inbox/${worker.id}.jsonl
- Outbox: ~/.aegis/teams/${team.id}/outbox/${worker.id}.jsonl
- Heartbeat: Write to ~/.aegis/teams/${team.id}/heartbeat/${worker.id}.json every 30s:
  {"timestamp": ${Date.now()}, "turnCount": N, "status": "working"|"idle"}

Current stage: ${team.currentStage}
Task description: ${team.description}
`;
}

// Worker lifecycle
interface WorkerLifecycle {
  // 1. Spawn: create session with preamble
  spawn(teamId: string, worker: WorkerInfo): Promise<SessionInfo>;
  
  // 2. Monitor: heartbeat checks
  checkHeartbeat(workerId: string): Promise<{ alive: boolean; lastAt: number }>;
  
  // 3. Message: write to inbox
  sendTaskAssignment(workerId: string, taskId: string): Promise<void>;
  
  // 4. Collect: read from outbox
  collectMessages(workerId: string): Promise<WorkerMessage[]>;
  
  // 5. Shutdown: graceful termination
  requestShutdown(workerId: string): Promise<void>;
  awaitShutdownConfirmation(workerId: string, timeout: number): Promise<boolean>;
}
```

### 4.4 Task Routing

```typescript
interface TaskRouter {
  // Pre-assignment: avoid race conditions
  assignTasks(team: Team): Map<string, string[]>;  // workerId → taskIds
  
  // Capability matching
  matchTaskToWorker(task: TaskInfo, workers: WorkerInfo[]): WorkerInfo | null;
  
  // Reassignment on failure
  reassignFailedTask(task: TaskInfo, workers: WorkerInfo[]): void;
  
  // Load balancing
  getLeastLoadedWorker(workers: WorkerInfo[]): WorkerInfo | null;
}

// Default routing strategy
class DefaultTaskRouter implements TaskRouter {
  assignTasks(team: Team): Map<string, string[]> {
    const assignments = new Map<string, string[]>();
    const pendingTasks = team.tasks.filter(t => t.status === 'pending');
    const availableWorkers = team.workers.filter(w => w.status === 'idle');
    
    // Pre-assign in round-robin fashion
    for (let i = 0; i < pendingTasks.length; i++) {
      const worker = availableWorkers[i % availableWorkers.length];
      if (!assignments.has(worker.id)) assignments.set(worker.id, []);
      assignments.get(worker.id)!.push(pendingTasks[i]!.id);
    }
    
    return assignments;
  }
  
  matchTaskToWorker(task: TaskInfo, workers: WorkerInfo[]): WorkerInfo | null {
    // Priority: role match → least loaded → first available
    const roleMatch = workers.filter(w => 
      (task.stage === 'verify' && w.role === 'verifier') ||
      (task.stage === 'exec' && w.role === 'executor')
    );
    
    if (roleMatch.length > 0) {
      return this.getLeastLoadedWorker(roleMatch);
    }
    
    return this.getLeastLoadedWorker(workers);
  }
  
  getLeastLoadedWorker(workers: WorkerInfo[]): WorkerInfo | null {
    return workers.reduce((min, w) => 
      (!min || w.assignedTasks.length < min.assignedTasks.length) ? w : min
    , null as WorkerInfo | null);
  }
  
  reassignFailedTask(task: TaskInfo, workers: WorkerInfo[]): void {
    // Exclude current owner, assign to next available
    const candidates = workers.filter(w => w.id !== task.owner);
    const newOwner = this.getLeastLoadedWorker(candidates);
    if (newOwner) {
      task.owner = newOwner.id;
      task.status = 'pending';
    }
  }
}
```

### 4.5 State Persistence

```
.aegis/teams/{teamId}/
├── state.json                 # Team state (stage, status, fixLoopCount)
├── workers/
│   └── {workerId}/
│       ├── status.json        # Worker status
│       └── heartbeat.json     # Last heartbeat timestamp
├── tasks/
│   └── {taskId}.json          # Task definition and status
├── handoffs/
│   ├── plan.md                # Plan stage handoff
│   ├── exec.md                # Exec stage handoff
│   └── verify.md              # Verify stage handoff
├── inbox/
│   └── {workerId}.jsonl       # Lead → Worker messages
├── outbox/
│   └── {workerId}.jsonl       # Worker → Lead messages
└── artifacts/                 # Task outputs (files created)
```

---

## 5. Aegis Advantage — HTTP API + Dashboard

### 5.1 Why Aegis Wins

**Aegis exposes orchestration via HTTP API**, enabling:

1. **External orchestration** — AI orchestrators, CI/CD pipelines, webhooks can create teams
2. **Dashboard visibility** — Web UI shows team status, worker health, task progress
3. **MCP integration** — Claude Code can create teams via MCP tools
4. **SSE streaming** — Real-time events for team lifecycle, task completion
5. **Remote management** — No tmux dependency for control plane

### 5.2 API Design

```yaml
# Team CRUD
POST   /v1/teams                    # Create team with workers
GET    /v1/teams                    # List all teams
GET    /v1/teams/:id                # Get team status
DELETE /v1/teams/:id                # Graceful shutdown

# Task Management
POST   /v1/teams/:id/tasks          # Create task
PATCH  /v1/teams/:id/tasks/:taskId  # Update task (claim, complete, fail)
GET    /v1/teams/:id/tasks          # List tasks

# Worker Management
GET    /v1/teams/:id/workers        # List workers
POST   /v1/teams/:id/workers/:workerId/messages  # Send message to worker

# Messaging
POST   /v1/teams/:id/broadcast      # Broadcast to all workers

# Events
GET    /v1/teams/:id/events         # SSE stream for team events
```

### 5.3 Dashboard Enhancement

Current dashboard shows **sessions**. Enhance to show **teams**:

```
┌─────────────────────────────────────────────────────────┐
│ Aegis Dashboard                                          │
├─────────────────────────────────────────────────────────┤
│ Teams (3 active)                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ fix-auth-bugs — EXECUTING (stage: exec)             │ │
│ │ Workers: 3/4 active                                 │ │
│ │ Tasks: 8/12 completed                               │ │
│ │ Stage: exec → verify (eta: 5 min)                   │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Sessions (5 active)                                     │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

### 5.4 MCP Tools

Add team-related MCP tools:

```typescript
// aegis_team_create
{
  name: 'aegis_team_create',
  description: 'Create a coordinated team of workers for parallel task execution',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      workerCount: { type: 'number', default: 2 },
      workerType: { type: 'string', enum: ['claude', 'codex', 'gemini', 'mixed'] },
      description: { type: 'string' },
    },
    required: ['name', 'description'],
  },
}

// aegis_team_status — Get team status and progress
// aegis_team_list_tasks — List tasks for a team
// aegis_team_send_message — Send message to specific worker
// aegis_team_shutdown — Gracefully shutdown team
```

---

## 6. Migration Path

### Phase 1: Foundation (v0.4.x) — 5 days

**Goal:** Add core primitives without breaking existing API.

| Task | Description | Effort |
|------|-------------|--------|
| **TeamState** | Define Team, Worker, Task interfaces | 0.5d |
| **TeamManager** | CRUD for teams, in-memory state | 1d |
| **WorkerSession** | Extend SessionInfo with teamId, workerId | 0.5d |
| **TaskRouter** | Basic round-robin assignment | 1d |
| **API Endpoints** | POST/GET/DELETE /v1/teams | 1d |
| **Tests** | Unit tests for TeamManager, TaskRouter | 1d |

**Deliverable:** `POST /v1/teams` creates a team with N workers (all Claude, no stages yet).

### Phase 2: Worker Protocol (v0.5.0) — 5 days

**Goal:** Workers communicate with lead via inbox/outbox.

| Task | Description | Effort |
|------|-------------|--------|
| **Preamble Generation** | Generate worker context with protocol | 0.5d |
| **Inbox/Outbox** | JSONL file-based messaging | 1d |
| **Heartbeat Monitor** | Periodic worker health checks | 1d |
| **Message Collection** | Read outbox, process worker messages | 1d |
| **Shutdown Protocol** | Request/response graceful termination | 1d |
| **Tests** | Integration tests for worker lifecycle | 0.5d |

**Deliverable:** Workers report task completion via outbox, lead collects messages.

### Phase 3: Staged Pipeline (v0.5.1) — 5 days

**Goal:** Implement plan → exec → verify → fix pipeline.

| Task | Description | Effort |
|------|-------------|--------|
| **Stage Definitions** | Default 4-stage pipeline | 0.5d |
| **Stage Transitions** | Entry/exit criteria, state machine | 1.5d |
| **Handoff Documents** | Write/read handoffs between stages | 1d |
| **Lead Logic** | Decompose task, create subtasks, route | 1d |
| **Fix Loop** | Bounded retry with maxFixLoops | 0.5d |
| **Tests** | End-to-end pipeline test | 0.5d |

**Deliverable:** `POST /v1/teams` with `pipeline: "staged"` executes the full pipeline.

### Phase 4: Dashboard + MCP (v0.5.2) — 3 days

**Goal:** Visibility and external integration.

| Task | Description | Effort |
|------|-------------|--------|
| **Dashboard Teams View** | Team cards with worker/task status | 1.5d |
| **SSE Events** | Team lifecycle events | 0.5d |
| **MCP Tools** | aegis_team_create, aegis_team_status | 1d |

**Deliverable:** Dashboard shows teams, MCP tools can create teams.

### Phase 5: Mixed-CLI Workers (v0.6.0) — 5 days

**Goal:** Support Codex and Gemini workers.

| Task | Description | Effort |
|------|-------------|--------|
| **CLI Worker Spawner** | Spawn Codex/Gemini in tmux | 1.5d |
| **Binary Detection** | Detect available CLIs | 0.5d |
| **Role-Based Routing** | Route tasks to appropriate CLI | 1d |
| **Cross-CLI Teams** | Mixed Claude + Codex + Gemini | 1d |
| **Tests** | Integration tests with mock CLIs | 1d |

**Deliverable:** `workerType: "mixed"` spawns heterogeneous team.

---

## 7. Effort Estimate

| Phase | Version | Effort | Dependencies |
|-------|---------|--------|--------------|
| Phase 1: Foundation | v0.4.x | 5 days | None |
| Phase 2: Worker Protocol | v0.5.0 | 5 days | Phase 1 |
| Phase 3: Staged Pipeline | v0.5.1 | 5 days | Phase 2 |
| Phase 4: Dashboard + MCP | v0.5.2 | 3 days | Phase 3 |
| Phase 5: Mixed-CLI Workers | v0.6.0 | 5 days | Phase 4 |
| **Total** | | **23 days** | |

**Assumptions:**
- Single developer (Hephaestus + CC sessions)
- Aegis production running for dogfooding
- No external dependencies (all in-repo)
- Tests written alongside features

**Risk buffer:** Add 30% → **30 days (~6 weeks)**

---

## 8. Risk Assessment

### 8.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **tmux race conditions** | Medium | High | Pre-assignment (OMC pattern), locking for state writes |
| **Worker deadlock** | Medium | Medium | Timeout + reassignment, bounded fix loops |
| **Context overflow in lead** | High | High | Handoff documents, task summarization |
| **Heartbeat false positives** | Medium | Low | Hysteresis (2+ missed beats before reassign) |
| **JSONL file corruption** | Low | Medium | Atomic writes (temp + rename), backup on read |
| **Cross-CLI compatibility** | High | Medium | Abstraction layer, feature detection |

### 8.2 Product Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **API complexity explosion** | High | High | Keep primitives minimal, compose in client |
| **Dashboard clutter** | Medium | Low | Tabbed view (Sessions vs Teams) |
| **User confusion (team vs session)** | Medium | Medium | Clear docs, distinct naming convention |
| **OMC feature drift** | Medium | Low | Monitor OMC releases, adopt selectively |

### 8.3 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Resource exhaustion (N workers)** | Medium | High | Configurable maxWorkers, resource quotas |
| **Orphaned workers on crash** | High | Medium | Orphan scan on startup, systemd cleanup |
| **State file bloat** | Medium | Low | TTL for completed teams, archival |
| **SSE connection limits** | Low | Low | Already mitigated (sseMaxConnections) |

### 8.4 Mitigation Strategies

1. **Pre-assignment (OMC pattern):** Assign owners before spawning to avoid race conditions
2. **Graceful shutdown:** Never kill without confirmation, timeout + force after 30s
3. **Handoff documents:** Preserve context across stages, survive lead restart
4. **Heartbeat + watchdog:** Detect stuck workers early, reassign before blocking pipeline
5. **Bounded fix loops:** maxFixLoops (default: 3) prevents infinite retry
6. **Orphan scan:** On startup, kill processes for teams not in state file

---

## Appendix A: Event Schema

```typescript
// SSE events for team lifecycle
type TeamEvent =
  | { type: 'team_created'; teamId: string; name: string; workerCount: number }
  | { type: 'team_stage_changed'; teamId: string; from: string; to: string }
  | { type: 'worker_spawned'; teamId: string; workerId: string; role: string }
  | { type: 'worker_heartbeat'; teamId: string; workerId: string; status: string }
  | { type: 'worker_finished'; teamId: string; workerId: string; reason: string }
  | { type: 'task_claimed'; teamId: string; taskId: string; workerId: string }
  | { type: 'task_completed'; teamId: string; taskId: string; artifacts: string[] }
  | { type: 'task_failed'; teamId: string; taskId: string; error: string }
  | { type: 'handoff_written'; teamId: string; stage: string; path: string }
  | { type: 'team_completed'; teamId: string; summary: TeamSummary }
  | { type: 'team_failed'; teamId: string; reason: string };
```

---

## Appendix B: Configuration Extensions

```typescript
// Add to config.ts
interface Config {
  // ... existing fields ...
  
  // Team defaults
  defaultTeamWorkers: number;           // default: 2
  defaultTeamWorkerType: 'claude' | 'mixed';  // default: 'claude'
  maxTeamWorkers: number;               // default: 10
  teamHeartbeatIntervalMs: number;      // default: 30000
  teamWorkerStallMs: number;            // default: 300000 (5 min)
  teamMaxFixLoops: number;              // default: 3
  teamShutdownTimeoutMs: number;        // default: 30000
}

// aegis.config.json example
{
  "defaultTeamWorkers": 3,
  "defaultTeamWorkerType": "claude",
  "maxTeamWorkers": 8,
  "teamHeartbeatIntervalMs": 30000,
  "teamWorkerStallMs": 300000,
  "teamMaxFixLoops": 3,
  "teamShutdownTimeoutMs": 30000
}
```

---

## Appendix C: OMC Patterns — Adopt vs Avoid

### ✅ Adopt

| Pattern | Why |
|---------|-----|
| Staged pipeline with handoffs | Proven to work, explicit phase transitions |
| Pre-assignment to avoid races | Simple, effective |
| Worker preamble injection | Consistent protocol, self-documenting |
| Inbox/Outbox for CLI workers | Simple file-based communication |
| Graceful shutdown protocol | Prevents orphaned processes |
| Heartbeat + watchdog | Detect stuck workers early |
| Tiered verification | Cost optimization, quality gate |
| Bounded fix loops | Prevents infinite retry |

### ⚠️ Evaluate Carefully

| Pattern | Consideration |
|---------|---------------|
| tmux as primary runtime | Good for local, complex for remote — Aegis already uses tmux windows |
| File-based state | Simple but race-prone — use locking |
| Claude Code native teams | Tied to CC implementation — Aegis abstracts this |

### ❌ Avoid

| Pattern | Why |
|---------|-----|
| Magic keywords in hooks | Not customizable, conflicts possible |
| Broadcast messaging | O(N) cost, easy to abuse — use targeted messages |
| SQLite for state | OMC removed it — native files are simpler |

---

## Appendix D: Related Documents

| Document | Location | Purpose |
|----------|----------|---------|
| OMC Orchestration Analysis | `references/omc-analysis-orchestration.md` | Deep-dive into OMC team system |
| OMC vs Aegis Comparison | `references/omc-analysis-vs-aegis.md` | Feature-by-feature comparison |
| Aegis Session Source | `/home/bubuntu/projects/aegis/src/session.ts` | Current session management |
| Aegis Pipeline Source | `/home/bubuntu/projects/aegis/src/pipeline.ts` | Current sequential pipelines |
| Aegis Swarm Monitor | `/home/bubuntu/projects/aegis/src/swarm-monitor.ts` | Passive team discovery |

---

*End of Brief — Generated 2026-04-01 by Hephaestus Subagent*
