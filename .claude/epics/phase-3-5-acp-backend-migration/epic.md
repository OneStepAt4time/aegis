# EPIC: Phase 3.5 — ACP Backend Migration & Native Control Plane UI

**Phase:** Proposed 3.5 — Backend Migration
**Status:** Active after activation PR merge
**Activation gate:** M0 spike work, implementation work, and PRs may start only
after the maintainer-approved activation PR for
[#2575](https://github.com/OneStepAt4time/aegis/issues/2575) merges to
`develop` and the immediate child issues are moved out of `status: not-active`.
**Parent roadmap:** [ROADMAP.md](../../../ROADMAP.md)
**Current positioning:** [ADR-0023](../../../docs/adr/0023-positioning-claude-code-control-plane.md)
**Tracking issue:** [#2574](https://github.com/OneStepAt4time/aegis/issues/2574)
**Activation issue:** [#2575](https://github.com/OneStepAt4time/aegis/issues/2575)
**Child issue range:** [#2575](https://github.com/OneStepAt4time/aegis/issues/2575)–[#2627](https://github.com/OneStepAt4time/aegis/issues/2627).
**Strategic fit:** Aegis remains the self-hosted control plane of Claude Code: a
bridge, not an agent framework or LLM orchestrator. This epic replaces the
terminal transport implementation while preserving Aegis's REST, MCP, dashboard,
audit, RBAC, and team-control-plane identity.

---

## 1. Executive Summary

Aegis currently controls Claude Code through tmux windows, terminal screen
capture, send-keys input, JSONL transcript discovery, and VT100/TUI parsing. That
implementation served the first product phases, but it is now the dominant source
of platform fragility: terminal parsing breaks on Claude Code UI changes,
Windows support requires psmux-specific behavior, realtime output depends on
`pipe-pane`, approval flows rely on sending keypresses, and public contracts leak
tmux concepts such as windows and panes.

This epic replaces the tmux runtime with an ACP-based backend using
`@agentclientprotocol/claude-agent-acp`. The migration is intentionally not a
thin adapter swap. The new architecture is a layered control plane:

1. **SessionService** owns Aegis session semantics, state transitions, RBAC,
   pause/intervention behavior, driver/observer control, and public API shapes.
2. **Postgres** is the team/enterprise source of truth for session identity,
   normalized events, chat snapshots, action queues, pause/intervention state,
   and retention-ready records.
3. **Redis** is required for team/enterprise realtime coordination: presence,
   driver locks, pub/sub fanout, distributed rate limits, action wakeups, and
   warm-pool coordination. Redis is never the source of truth.
4. **AcpBackend** is the runtime adapter that spawns and supervises
   `claude-agent-acp`, maps ACP JSON-RPC notifications into Aegis domain events,
   and sends normalized actions to Claude Code.
5. **Dashboard and MCP** become ACP-native control surfaces: chat-first
   interaction, structured tool cards, approval modals, raw terminal debug tab,
   and team/operator timeline.

The cutover is a **major breaking release**. Aegis keeps the `/v1` namespace but
removes tmux/window/pane contract fields and endpoint semantics in that major
release. OpenAPI, TypeScript SDK, Python SDK, MCP tools, dashboard types, docs,
doctor checks, and deployment guides are regenerated or rewritten in the same
release train.

---

## 2. Non-Negotiable Decisions

These decisions are locked for this epic unless maintainers explicitly reopen
them before activation.

1. **ACP is the only shipped backend after cutover.** A transitional backend flag
   may exist only in the worktree/dev branch before M5. No long-lived
   `AEGIS_BACKEND` product mode ships after cutover.
2. **The cutover is breaking.** tmux-centric public fields and endpoints are not
   preserved as compatibility aliases.
3. **The API namespace remains `/v1`.** The major release changes the `/v1`
   contract rather than introducing `/v2/acp`.
4. **`claude-agent-acp` is installed with Aegis.** It is an npm dependency of
   Aegis. `AEGIS_ACP_BIN` remains available for operators who need a custom
   binary or fork.
5. **Postgres is required for team/enterprise deployments.** It stores durable
   ACP state. File-backed local development may remain supported.
6. **Redis is required for team/enterprise realtime coordination.** It is not
   required for local development. Redis stores only volatile coordination data.
7. **Raw terminal parity is a cutover gate.** If ACP's terminal extension cannot
   cover input echo, resize, reconnect, and debugging parity, M4/M5 cannot
   proceed.
8. **No M0 spike before activation.** Even feasibility work waits for maintainer
   approval because this is outside the currently active Phase 3 checklist.
9. **The dashboard is not a terminal mirror.** It becomes a native ACP control
   plane with chat, terminal-debug, and operator timeline views.
10. **Driver/observer semantics are security semantics.** They are governed by
    RBAC, audit, idempotency, explicit transfer/revocation, and pause/intervention
    state.

---

## 3. Current AS-IS Coupling to Remove

The migration must account for the current tmux coupling rather than deleting
files opportunistically.

| Surface | Current tmux dependency | Cutover direction |
|---|---|---|
| `src/tmux.ts` | `new-session`, `new-window`, `send-keys`, `capture-pane`, `pipe-pane`, health checks, retry serialization | Deleted after ACP cutover |
| `src/session.ts` | stores `windowId`, `windowName`; creates/kills windows; sends input; captures pane for approvals and health | Moves to `SessionService` + ACP runtime actions |
| `src/monitor.ts` | polls pane/window health; detects tmux crash; marks dead windows | Consumes normalized event stream and durable action/event state |
| `src/terminal-parser.ts` | infers Claude Code TUI states from captured terminal text | Retired; replaced by ACP event/state mapping |
| `src/vt100-screen.ts` | normalizes ANSI terminal buffer for parser | Retired unless raw terminal debug path needs sanitized display helpers |
| `src/pty-stream.ts` | `pipe-pane` + FIFO realtime streaming | Retired or replaced by ACP terminal extension streaming |
| `src/ws-terminal.ts` | WebSocket wrapper around tmux pane stream and resize | Rewritten around ACP terminal/debug channel |
| REST `/pane` | returns raw terminal pane | Removed |
| REST `/bash` diff | diffs terminal capture | Removed or replaced by ACP tool/result event model |
| MCP `capture_pane` | pane snapshot | Removed |
| MCP descriptions | mention tmux send-keys and tmux windows | Rewritten with ACP semantics |
| OpenAPI/SDK | exposes `windowId`, `windowName`, `windowExists`, `paneCommand`, `tmux` health | Breaking schema cleanup |
| Dashboard | compares/renders window IDs and names | Migrates to ACP session identity and event model |
| Doctor/deploy/docs | require tmux/psmux | require ACP dependency, Postgres/Redis profile checks |

---

## 4. Goals

1. Replace the tmux runtime with ACP across lifecycle, prompts, approvals,
   streaming output, raw terminal debugging, cancellation, health, and recovery.
2. Establish a backend-independent `SessionService` that owns Aegis domain
   semantics and exposes stable APIs to routes, MCP, dashboard, pipelines, audit,
   metrics, and monitor.
3. Add durable team/enterprise storage for ACP session identity, event history,
   chat snapshots, action queue, pause/intervention state, and replay.
4. Add Redis-backed realtime coordination for team/enterprise deployments while
   preserving Redis-free local development.
5. Remove tmux/window/pane contracts from REST, OpenAPI, SDKs, MCP tools,
   dashboard types, health, docs, doctor, Helm, examples, and tests.
6. Ship a native ACP dashboard model with three coordinated views:
   **Chat**, **Terminal**, and **Timeline**.
7. Preserve existing Aegis auth/RBAC/tenant boundaries and apply them to driver,
   observer, approval, pause, resume, and intervention actions.
8. Preserve custom-model and BYO LLM workflows through environment passthrough,
   `.claude/settings.local.json`, and `AEGIS_ACP_BIN` override support.
9. Keep pipelines working above the backend by verifying event/terminal contract
   parity for batch and multi-stage workflows.

---

## 5. Non-Goals

1. Do not build an agent framework or competing runtime. Claude Code remains the
   target runtime.
2. Do not add SaaS, billing, metering product features, or open-core edition
   flags.
3. Do not introduce a long-lived backend selection product mode.
4. Do not add Aegis-driven Claude login/logout flows. This epic may add a
   read-only Claude connection/status surface, but not auth lifecycle control.
5. Do not make Redis the source of truth.
6. Do not require Redis or Postgres for local development.
7. Do not preserve tmux-specific public endpoints as aliases after the breaking
   cutover.
8. Do not change Aegis bearer auth, dashboard OIDC, OAuth device flow, key
   rotation, or tenant authorization except where ACP control actions need to use
   those existing systems.

---

## 6. Target Architecture

### 6.1 Layered Control Plane

```text
Public surfaces
  REST /v1/*
  MCP acp_* tools
  SSE / WebSocket events
  Dashboard ACP UI
        |
        v
SessionService
  Aegis session state machine
  stable identity model
  RBAC and audit attribution
  driver/observer policy
  pause/intervention policy
  action idempotency
        |
        +---------------------------+
        |                           |
        v                           v
Durable state                  Realtime coordination
  Postgres AcpSessionStore       Redis presence
  Postgres AcpEventStore         Redis driver locks
  Postgres AcpActionQueue        Redis pub/sub or streams
  Postgres AcpChatCache          Redis distributed rate limits
  Postgres pause/intervention    Redis queue wakeups
        |
        v
AcpBackend
  claude-agent-acp child process
  JSON-RPC stdio adapter
  ACP event normalization
  ACP terminal extension bridge
  restart/backoff supervision
        |
        v
Claude Code / Claude Agent SDK
```

### 6.2 Runtime Boundary

`AcpBackend` must not own product semantics. It owns only:

- child process spawn, restart, and shutdown;
- JSON-RPC request/response lifecycle;
- ACP notification decoding;
- ACP action sending;
- terminal extension bridging;
- low-level timeout and protocol error handling.

`SessionService` owns:

- public session state;
- identity mapping;
- action ordering and idempotency;
- authorization;
- audit;
- pause/resume/intervention;
- driver/observer control;
- conversion from normalized ACP events into Aegis domain state.

### 6.3 Deployment Profiles

| Profile | Target | Durable state | Realtime coordination | Supported use |
|---|---|---|---|---|
| Local dev | laptop, tests, smoke | file-backed state and event files | in-memory fanout/locks | single process, non-production |
| Team | shared deployment | Postgres | Redis | production baseline |
| Enterprise | shared deployment with strict operations | Postgres | Redis | production baseline, future HA-ready |

Team/enterprise deployments require both Postgres and Redis after ACP cutover.
The local-dev profile exists for developer ergonomics and CI smoke tests, not as
the recommended shared production profile.

---

## 7. Core Domain Model

### 7.1 Identity Model

Aegis must never expose upstream ACP identifiers as the primary public identity.

| Identifier | Owner | Public? | Notes |
|---|---|---:|---|
| `aegisSessionId` | Aegis | Yes | Stable primary API/MCP/dashboard ID |
| `acpSessionId` | ACP adapter/upstream | No, except diagnostics | Internal mapping, may change across adapter versions |
| `claudeSessionId` | Claude Code / Agent SDK | No, except diagnostics | Used only when available and useful for resume/debug |
| `transcriptId` | Aegis | Yes | Stable durable conversation transcript/cache ID |
| `actionId` | Aegis | Yes | Idempotency key for mutating control actions |
| `eventId` | Aegis | Yes | Monotonic durable event sequence |

### 7.2 Session State Machine

The ACP backend retires terminal-derived `UIState` as the source of truth. Aegis
keeps a backend-neutral session state machine.

```text
starting
  -> ready
  -> running
  -> awaiting_approval
  -> paused
  -> intervention
  -> running
  -> completed

Failure and control branches:
  running -> cancelled
  running -> failed
  running -> disconnected -> recovering -> running
  running -> disconnected -> failed
  awaiting_approval -> approval_timeout -> paused|failed
```

States are derived from normalized ACP/Aegis events, action queue state, child
process health, and pause/intervention policy.

### 7.3 Normalized Event Model

ACP notifications map to Aegis domain events before reaching public consumers.

| ACP input | Aegis event |
|---|---|
| text delta | `message.delta` |
| thinking | `thinking.delta` |
| message usage | `usage.updated` |
| tool call started | `tool.started` |
| tool result | `tool.completed` |
| approval request | `approval.requested` |
| approval response | `approval.responded` |
| turn end | `turn.completed` |
| terminal output | `terminal.output` |
| protocol/agent error | `session.error` |
| child exit | `backend.disconnected` or `backend.failed` |
| driver claim/release | `driver.claimed`, `driver.released`, `driver.revoked` |
| pause/resume | `session.paused`, `session.resumed` |
| intervention | `intervention.started`, `intervention.completed` |

All public realtime surfaces consume Aegis events, not raw ACP payloads. Raw ACP
payloads may be retained in diagnostics when safe and redacted.

---

## 8. Storage Architecture

### 8.1 Postgres Source of Truth

Team/enterprise deployments require a durable database-backed state layer.

Proposed tables:

| Table | Purpose |
|---|---|
| `acp_sessions` | Aegis session identity, ACP/Claude mappings, tenant, owner key, current state, model/provider metadata |
| `acp_session_runtime` | current runtime status, child process metadata, health timestamps, restart counters |
| `acp_events` | append-only normalized event log with monotonic per-session sequence |
| `acp_event_payloads` | optional large/redacted payload storage if event rows need to stay small |
| `acp_chat_snapshots` | dashboard render snapshots for fast reload/pagination |
| `acp_actions` | durable idempotent action queue for prompt, approval, pause, resume, cancel, driver transfer |
| `acp_driver_claims` | current and historical driver ownership records |
| `acp_pause_interventions` | pause/intervention reason, actor, pending actions, resume metadata |
| `acp_transcripts` | transcript sink metadata and file/blob pointer |
| `acp_terminal_frames` | optional terminal debug frames if terminal replay needs durable support |

Postgres is required for:

- replay after server restart;
- dashboard pagination and chat cache;
- audit attribution for human and agent actions;
- pause/intervention recovery;
- idempotency across retries;
- team/enterprise retention/export/delete workflows.

### 8.2 Redis Realtime Coordination

Team/enterprise deployments require Redis for volatile distributed coordination.

Redis responsibilities:

- `aegis:acp:presence:<sessionId>` — connected subscribers and role metadata;
- `aegis:acp:driver-lock:<sessionId>` — exclusive driver claim with TTL;
- `aegis:acp:events:<sessionId>` — pub/sub or stream fanout for live event delivery;
- `aegis:acp:actions:wakeup` — action queue wakeups;
- `aegis:acp:ratelimit:*` — distributed send/approval/subscribe rate limits;
- `aegis:acp:warm-pool:*` — optional child-process warm-pool coordination.

Redis must never contain the only copy of user-visible history, actions, or
state. If Redis is lost, Aegis can reconstruct durable state from Postgres and
clients can reconnect.

### 8.3 Local Development Storage

Local development may use:

- file-backed session metadata;
- append-only local event files;
- in-memory fanout;
- in-memory locks;
- no Redis;
- no Postgres unless explicitly configured.

Local mode must exercise the same TypeScript interfaces as the team/enterprise
profile so behavior is testable without external services.

---

## 9. Control Semantics

### 9.1 Driver and Observer Model

One session has at most one driver at a time and any number of observers.

| Role | Capabilities |
|---|---|
| Driver | send prompts, request cancel, request pause/resume when authorized |
| Observer | read chat, timeline, terminal, transcript, metrics |
| Operator | revoke stale driver, force pause, inspect health, transfer control if authorized |
| Admin | operator capabilities plus configuration and emergency control |

Rules:

1. A driver claim requires the existing Aegis `send` permission.
2. Approval responses require existing `approve`/`reject` permissions.
3. A driver cannot approve a tool if they lack approval permission.
4. Driver transfer is explicit and audit-logged.
5. Driver timeout is configurable and backed by Redis in team/enterprise mode.
6. Admin/operator takeover is explicit and audit-logged.
7. Every mutating action records actor, key ID, tenant ID, role, previous state,
   next state, and action ID.

### 9.2 Pause and Intervention

Pause/intervention is a first-class control-plane capability.

| Action | Behavior |
|---|---|
| `pause` | prevents new driver actions from being sent to ACP; event ingestion continues |
| `intervention.start` | allows an authorized human/operator to inspect state and prepare guidance |
| `intervention.submit` | records human guidance or pending decision as an idempotent action |
| `resume` | releases queued actions according to policy and emits `session.resumed` |
| `cancel` | cancels or terminates runtime work according to ACP capability and Aegis policy |

Pause is not a Redis-only state. It must be durable in Postgres. Redis only helps
notify live clients and enforce distributed coordination.

### 9.3 Action Queue

All mutating runtime operations flow through `AcpActionQueue`.

Action types:

- `prompt.send`;
- `approval.respond`;
- `driver.claim`;
- `driver.release`;
- `driver.transfer`;
- `driver.revoke`;
- `session.pause`;
- `session.resume`;
- `session.cancel`;
- `terminal.input`;
- `terminal.resize`.

Action states:

- `queued`;
- `leased`;
- `sent`;
- `acknowledged`;
- `failed`;
- `cancelled`;
- `superseded`;
- `expired`.

Every action has an idempotency key. Duplicate submissions return the existing
action result.

---

## 10. Public Contract Changes

### 10.1 REST

The ACP cutover keeps `/v1` and uses a major release to change the schema.

Removed:

- `SessionInfo.windowId`;
- `SessionInfo.windowName`;
- `SessionHealth.windowExists`;
- `SessionHealth.paneCommand`;
- `HealthResponse.tmux`;
- `GET /v1/sessions/:id/pane`;
- tmux/pane semantics from bash/discover-command flows.

Added or changed:

- `SessionInfo.backend = "acp"`;
- `SessionInfo.displayName`;
- `SessionInfo.state`;
- `SessionInfo.driver`;
- `SessionInfo.paused`;
- `SessionInfo.model`;
- `SessionInfo.provider`;
- `SessionInfo.transcriptId`;
- `SessionHealth.backend`;
- `SessionHealth.acp`;
- `SessionHealth.postgres`;
- `SessionHealth.redis`;
- session event replay endpoint backed by `AcpEventStore`;
- action submission endpoints for prompt, approval, pause, resume, cancel, and
  driver control.

### 10.2 MCP

tmux-centric tools are removed and ACP-native tools are added.

Proposed MCP tools:

- `acp_create_session`;
- `acp_send_prompt`;
- `acp_subscribe`;
- `acp_get_events`;
- `acp_get_chat`;
- `acp_respond_approval`;
- `acp_claim_driver`;
- `acp_release_driver`;
- `acp_transfer_driver`;
- `acp_pause_session`;
- `acp_resume_session`;
- `acp_cancel_session`;
- `acp_get_timeline`;
- `acp_get_terminal_debug`;

Removed MCP tools/resources:

- `capture_pane`;
- tmux wording in `send_message`, `send_bash`, `kill_session`;
- pane resource semantics.

Existing non-tmux MCP tools may remain if their semantics remain valid.

### 10.3 OpenAPI and SDKs

The major cutover release must regenerate:

- `openapi.yaml`;
- TypeScript SDK;
- Python SDK;
- dashboard types;
- MCP tools reference.

The PR series must include a migration guide that maps old tmux/pane concepts to
new ACP concepts.

---

## 11. Dashboard Product Model

The ACP dashboard is a native session control plane, not a terminal mirror.

### 11.1 Session Detail Navigation

Proposed tabs:

- `Overview`;
- `Chat`;
- `Terminal`;
- `Timeline`;
- `Transcript`;
- `Settings`.

### 11.2 Control Rail

Every session detail view shows a persistent control rail:

- current state;
- driver/observer role;
- claim/release/transfer controls;
- pause/resume/intervention controls;
- active tool;
- pending approval;
- model/provider;
- token usage;
- backend health;
- last error;
- tenant/owner metadata when authorized.

### 11.3 Chat View

Default human interaction surface:

- streamed assistant text;
- thinking blocks;
- tool-call cards;
- tool-result cards;
- file diff cards;
- approval modals;
- token meter;
- driver prompt input;
- pause/resume affordance.

### 11.4 Terminal View

Debugging surface:

- raw terminal output if ACP terminal extension supports it;
- terminal input and resize for authorized driver;
- read-only mode for observers;
- clear indication that terminal is diagnostic, not the primary control model.

Raw terminal parity blocks M5.

### 11.5 Timeline View

Team/operator audit surface:

- driver claimed/released/transferred/revoked;
- prompt submitted;
- tool started/completed/failed;
- approval requested/responded/timed out;
- session paused/resumed;
- intervention started/completed;
- child process restart;
- ACP protocol errors;
- Redis/Postgres health transitions;
- actor and tenant attribution.

---

## 12. Error Taxonomy and Health

The tmux-specific `tmux_crash` alert type is retired or superseded during the
major cutover.

New failure classes:

- `acp_child_crash`;
- `acp_protocol_error`;
- `acp_request_timeout`;
- `acp_terminal_unavailable`;
- `claude_auth_error`;
- `provider_rate_limit`;
- `provider_api_error`;
- `approval_timeout`;
- `driver_disconnected`;
- `action_queue_stalled`;
- `event_store_failed`;
- `redis_unavailable`;
- `postgres_unavailable`;
- `transcript_sink_failed`;
- `chat_cache_rebuild_failed`.

Health surfaces must distinguish:

- local backend process health;
- ACP child process health;
- Claude/provider auth health;
- Postgres source-of-truth health;
- Redis realtime coordination health;
- event lag;
- action queue lag;
- subscriber fanout health.

---

## 13. Decision Gates

| Gate | Name | Required before | Pass criteria |
|---|---|---|---|
| G0 | Phase 3.5 activation | Any M0 or implementation work | Maintainer-approved issue and activation PR |
| G1 | ACP feasibility verdict | M1 starts | ADR documents green/yellow/red result; red blocks epic |
| G2 | Storage profile approval | Team/enterprise work starts | Postgres and Redis profiles accepted by maintainers |
| G3 | Breaking API approval | Public contract PRs merge | Major release policy, migration guide, SDK plan approved |
| G4 | Raw terminal parity | M5 cutover | ACP terminal extension passes echo/input/resize/reconnect tests |
| G5 | Soak completion | tmux deletion | Worktree runs real workloads with no blocking regressions |
| G6 | Final gate | PRs to develop | `npm run gate` and pre-PR hygiene pass |

---

## 14. Milestones

### M0 — ACP Feasibility Spike

Goal: prove ACP can support Aegis's replacement requirements before architecture
work begins.

Scope:

- run `claude-agent-acp` from Aegis-controlled child process;
- create, resume, and cancel a real session;
- stream text, thinking, tool calls, tool results, approvals, and end-turn events;
- validate raw terminal extension capabilities;
- validate custom model and BYO LLM environment passthrough;
- validate token/cost data availability;
- capture raw ACP fixtures and normalized event fixtures;
- produce ADR-0024 with green/yellow/red verdict.

Pass criteria:

- real Claude API call succeeds;
- custom model matrix passes for Anthropic plus at least two configured providers;
- token/cost data can feed the transcript/cost model within accepted tolerance;
- approval request/response works without terminal keypress emulation;
- raw terminal extension supports input echo, resize, reconnect, and debug output;
- fixtures are committed for future deterministic tests.

### M1 — Control Plane Foundation

Goal: build the state and control layer before relying on ACP runtime details.

Scope:

- `src/services/session/SessionService.ts`;
- `src/services/session/SessionStateMachine.ts`;
- `src/services/session/SessionIdentity.ts`;
- `src/services/acp/AcpEventStore.ts`;
- `src/services/acp/AcpActionQueue.ts`;
- `src/services/acp/AcpChatCache.ts`;
- `src/services/acp/AcpPauseInterventionStore.ts`;
- `src/services/acp/AcpRealtimeBus.ts`;
- Postgres-backed implementations;
- file/in-memory local-dev implementations;
- Redis interface and team/enterprise implementation;
- contract tests for storage/action/state behavior.

### M2 — ACP Runtime and Fanout

Goal: connect the control plane to `claude-agent-acp`.

Scope:

- `src/backends/acp/AcpBackend.ts`;
- `src/backends/acp/AcpChildProcess.ts`;
- `src/backends/acp/AcpJsonRpcClient.ts`;
- `src/backends/acp/AcpEventMapper.ts`;
- `src/backends/acp/AcpTerminalBridge.ts`;
- `src/backends/acp/AcpFanout.ts`;
- Redis-backed pub/sub fanout;
- local in-memory fanout;
- restart/backoff behavior;
- action queue worker;
- golden event tests.

### M3 — Breaking Public Contracts

Goal: remove tmux/pane/window contracts and expose ACP-native contracts.

Scope:

- REST route shape updates;
- OpenAPI regeneration;
- TypeScript/Python SDK regeneration;
- MCP `acp_*` tools;
- removal of tmux wording from public docs and tool descriptions;
- migration guide;
- dashboard type migration.

### M4 — Dashboard ACP UI

Goal: ship the native control plane UI.

Scope:

- Chat view;
- Terminal debug view;
- Timeline view;
- control rail;
- approval modal;
- driver/observer controls;
- pause/resume/intervention controls;
- token meter;
- model/provider status;
- Playwright coverage for all ACP event types.

### M5 — Cutover and tmux Retirement

Goal: remove tmux completely.

Scope:

- drain active tmux sessions or require zero active tmux sessions before cutover;
- remove tmux runtime code;
- remove terminal parser and VT100-only parser paths;
- remove tmux tests and mocks;
- update doctor checks;
- update README, deployment, Windows setup, Helm, ADRs, and lifecycle docs;
- run final gate;
- publish major release notes.

---

## 15. GitHub Issue Catalog

The issue catalog has been created and linked from the tracking issue. Each
issue references this epic file and carries the appropriate phase label.

### EPIC tracking issue

**Title:** `EPIC: Phase 3.5 — ACP Backend Migration & Native Control Plane UI`
**Labels:** `epic`, `phase-3.5`, `enhancement`
**Body must include:**

- link to this epic file;
- explicit activation gate;
- statement that no work starts before activation PR;
- milestone list M0-M5;
- breaking-release warning;
- Postgres+Redis team/enterprise requirement;
- local-dev no-Redis profile;
- raw terminal parity gate.

### Activation and governance

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-001 | `Activate Phase 3.5 ACP backend migration` | `needs-human`, `phase-3.5`, `governance` | none |
| ACP-002 | `Write ADR-0024 ACP feasibility spike verdict` | `docs`, `adr`, `phase-3.5` | ACP-001 |
| ACP-003 | `Approve major breaking release plan for ACP cutover` | `needs-human`, `release`, `breaking-change` | ACP-001 |

### M0 spike

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-010 | `Spike claude-agent-acp child process lifecycle` | `spike`, `phase-3.5`, `backend` | ACP-001 |
| ACP-011 | `Spike ACP event stream coverage and fixture capture` | `spike`, `backend`, `test` | ACP-010 |
| ACP-012 | `Spike ACP approval request/response parity` | `spike`, `security`, `backend` | ACP-010 |
| ACP-013 | `Spike ACP terminal extension parity` | `spike`, `dashboard`, `backend` | ACP-010 |
| ACP-014 | `Spike custom model and BYO LLM passthrough` | `spike`, `byo-llm`, `backend` | ACP-010 |
| ACP-015 | `Spike token and cost telemetry compatibility` | `spike`, `analytics`, `backend` | ACP-011 |

### M1 control plane foundation

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-020 | `Define ACP-native session identity model` | `backend`, `api`, `phase-3.5` | ACP-002 |
| ACP-021 | `Implement SessionService and ACP state machine skeleton` | `backend`, `refactor` | ACP-020 |
| ACP-022 | `Implement Postgres AcpSessionStore` | `backend`, `postgres` | ACP-021 |
| ACP-023 | `Implement Postgres AcpEventStore` | `backend`, `postgres` | ACP-021 |
| ACP-024 | `Implement Postgres AcpActionQueue with idempotency` | `backend`, `postgres` | ACP-021 |
| ACP-025 | `Implement AcpChatCache snapshots` | `backend`, `dashboard`, `postgres` | ACP-023 |
| ACP-026 | `Implement pause and intervention persistence` | `backend`, `security`, `postgres` | ACP-024 |
| ACP-027 | `Define Redis realtime coordination interfaces` | `backend`, `redis` | ACP-021 |
| ACP-028 | `Implement Redis presence, driver locks, and pub/sub` | `backend`, `redis` | ACP-027 |
| ACP-029 | `Implement local-dev file and memory storage profile` | `backend`, `developer-experience` | ACP-022, ACP-023, ACP-024 |

### M2 ACP runtime and fanout

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-040 | `Add claude-agent-acp npm dependency and binary resolution` | `backend`, `dependencies` | ACP-002 |
| ACP-041 | `Implement AcpChildProcess supervision` | `backend`, `reliability` | ACP-040 |
| ACP-042 | `Implement AcpJsonRpcClient over stdio` | `backend`, `protocol` | ACP-041 |
| ACP-043 | `Implement ACP event mapper to Aegis domain events` | `backend`, `api`, `test` | ACP-042, ACP-023 |
| ACP-044 | `Implement AcpBackend session lifecycle` | `backend` | ACP-042, ACP-021 |
| ACP-045 | `Implement AcpFanout local and Redis-backed delivery` | `backend`, `redis`, `realtime` | ACP-028, ACP-043 |
| ACP-046 | `Implement action queue worker for ACP runtime actions` | `backend`, `reliability` | ACP-024, ACP-044 |
| ACP-047 | `Implement ACP terminal bridge` | `backend`, `dashboard`, `terminal` | ACP-013, ACP-044 |
| ACP-048 | `Add golden ACP event contract tests` | `test`, `backend` | ACP-043, ACP-046 |

### M3 breaking contracts

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-060 | `Remove tmux fields from shared API contracts` | `api`, `breaking-change` | ACP-003, ACP-020 |
| ACP-061 | `Update REST session routes for ACP-native contracts` | `api`, `backend` | ACP-060, ACP-044 |
| ACP-062 | `Remove pane capture and tmux-specific REST endpoints` | `api`, `breaking-change` | ACP-060 |
| ACP-063 | `Add ACP session event replay endpoints` | `api`, `backend` | ACP-023, ACP-061 |
| ACP-064 | `Add ACP control action endpoints` | `api`, `security` | ACP-024, ACP-061 |
| ACP-065 | `Replace MCP tmux tools with ACP-native tools` | `mcp`, `breaking-change` | ACP-061 |
| ACP-066 | `Regenerate OpenAPI and SDKs for ACP major release` | `api`, `sdk`, `release` | ACP-060, ACP-061, ACP-065 |
| ACP-067 | `Write ACP migration guide for REST, MCP, SDK, and dashboard users` | `docs`, `breaking-change` | ACP-066 |

### M4 dashboard

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-080 | `Build ACP dashboard session shell and control rail` | `dashboard`, `frontend` | ACP-061 |
| ACP-081 | `Build ACP chat view with text, thinking, and token usage` | `dashboard`, `frontend` | ACP-080, ACP-025 |
| ACP-082 | `Build tool-call and diff cards` | `dashboard`, `frontend` | ACP-081 |
| ACP-083 | `Build ACP approval modal` | `dashboard`, `security`, `frontend` | ACP-064, ACP-081 |
| ACP-084 | `Build driver and observer controls` | `dashboard`, `security`, `frontend` | ACP-028, ACP-064, ACP-080 |
| ACP-085 | `Build pause, resume, and intervention UI` | `dashboard`, `security`, `frontend` | ACP-026, ACP-064, ACP-080 |
| ACP-086 | `Build raw terminal debug tab` | `dashboard`, `terminal`, `frontend` | ACP-047, ACP-080 |
| ACP-087 | `Build operator timeline view` | `dashboard`, `audit`, `frontend` | ACP-023, ACP-080 |
| ACP-088 | `Add Playwright coverage for ACP dashboard views` | `test`, `dashboard` | ACP-081, ACP-083, ACP-086, ACP-087 |

### M5 cutover and deletion

| ID | Title | Labels | Depends on |
|---|---|---|---|
| ACP-100 | `Complete ACP worktree soak and cutover sign-off` | `release`, `needs-human` | ACP-088 |
| ACP-101 | `Drain active tmux sessions before ACP cutover` | `backend`, `release` | ACP-100 |
| ACP-102 | `Delete tmux runtime code` | `backend`, `breaking-change` | ACP-101 |
| ACP-103 | `Delete terminal parser and VT100-only parser paths` | `backend`, `breaking-change` | ACP-102 |
| ACP-104 | `Delete tmux tests, mocks, and fixtures` | `test`, `breaking-change` | ACP-102, ACP-103 |
| ACP-105 | `Update doctor, deployment, Helm, and Windows setup for ACP` | `docs`, `deploy`, `developer-experience` | ACP-102 |
| ACP-106 | `Update README, CLAUDE, AGENTS, ROADMAP, SECURITY, and CONTRIBUTING` | `docs`, `policy` | ACP-105 |
| ACP-107 | `Run final gate and pre-PR hygiene for ACP major cutover` | `release`, `test` | ACP-106 |

---

## 16. Acceptance Criteria

The epic is complete only when all of the following are true:

1. Aegis starts and creates ACP-backed sessions without tmux or psmux installed.
2. Local development works without Redis or Postgres.
3. Team/enterprise profile requires and validates Postgres + Redis.
4. ACP sessions support create, resume, prompt, approval, pause, intervention,
   cancel, terminal debug, and replay.
5. Dashboard Chat, Terminal, and Timeline views work from the same normalized
   event stream.
6. MCP `acp_*` tools work end-to-end.
7. OpenAPI, TypeScript SDK, and Python SDK reflect the ACP major contract.
8. No production code imports `src/tmux.ts`, `src/terminal-parser.ts`,
   `src/vt100-screen.ts`, or `src/pty-stream.ts`.
9. `git grep -n "tmux" -- src dashboard packages scripts templates charts deploy`
   returns no runtime references.
10. README, external deployment, Windows setup, doctor, Helm, and lifecycle docs
    no longer list tmux or psmux as prerequisites.
11. Raw terminal parity tests pass.
12. Golden event tests pass.
13. Cost/token regression tests pass within the approved tolerance.
14. `npm run gate` passes on macOS, Linux, and Windows.
15. Maintainers approve the major breaking release.

---

## 17. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| ACP does not support required lifecycle behavior | High | M0 green/yellow/red feasibility gate |
| Raw terminal extension lacks parity | High | G4 blocks M5 |
| Token/cost data cannot be reconstructed | High | M0 and M3 cost regression gates |
| Driver/observer creates security bypass | High | RBAC, audit, action queue, explicit tests |
| Redis becomes accidental source of truth | High | Postgres-only durable state rule |
| Postgres schema becomes too ACP-specific | Medium | Store normalized Aegis events, retain raw ACP only as optional diagnostics |
| Local-dev diverges from team profile | Medium | Shared interfaces and contract tests across implementations |
| Breaking API surprises SDK users | High | Major release, migration guide, generated SDKs, maintainer approval |
| Worktree grows too large to review | Medium | Issue catalog split into small PRs |
| Upstream ACP package changes schema | Medium | Pin dependency, schema fixture tests, bump gauntlet |
| Redis outage drops live subscriptions | Medium | Reconnect from Postgres event store |
| Action queue duplicates prompts or approvals | High | Idempotency keys and durable action states |
| Existing tmux sessions are lost unexpectedly | Medium | M5 drain issue and explicit operator communication |

---

## 18. Open Questions for Maintainers

1. Which exact major version line should carry the ACP breaking cutover?
2. Which third-party providers are mandatory in the custom-model matrix?
3. What is the accepted token/cost tolerance for non-Anthropic providers?
4. Should terminal debug history be durable in Postgres or live-only with replay
   from chat/events?
5. What retention defaults should apply to ACP event history and chat snapshots?
6. Should admin/operator takeover require a dedicated permission beyond current
   `send`/`approve`/`kill` permissions?
