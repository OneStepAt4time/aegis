# Aegis C4 Architecture

> **C4 Model (Simon Brown)** — Level 1: System Context → Level 2: Containers → Level 3: Components → Level 4: Code (Classes)
>
> This document complements the module-level [`architecture.md`](./architecture.md) with structural diagrams of each abstraction level. It is grounded in the current codebase on `develop` (ADR-0034 positioning) and validated against live ADRs.

---

## C1: System Context

### Aegis as the ACP Runtime Control Plane

```text
                    ┌──────────────────────────────────────────────────┐
                    │                  Aegis (System)                     │
                    │    Control Plane for ACP-Compatible Agent CLIs    │
                    │                                                    │
                    │   ┌──────────────────────────────────────────┐   │
                    │   │  REST API  │  SSE  │  MCP  │  WebSocket  │   │
                    │   │  Dashboard  │  CLI  │  Telegram  │  Slack  │  │
                    │   └──────────────────────────────────────────┘   │
                    │                                                    │
                    │   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
                    │   │ Claude   │   │  Kimi    │   │  Gemini  │   │
                    │   │  Code    │   │  Code    │   │   CLI    │   │
                    │   └──────────┘   └──────────┘   └──────────┘   │
                    └──────────────────┬──────────┬───────────────────┘
                                       │          │
                                       │          │
    ┌────────────┐   ┌──────────┐   │   ┌──────────┐   ┌──────────┐
    │   Human    │   │   Other  │   │   │   LLM    │   │  GitHub  │
    │  Developer │   │   Agent  │   │   │Provider  │   │  (Repo)  │
    │ (Operator) │   │ (MCP)    │   │   │ (BYO)    │   │          │
    └─────┬──────┘   └────┬─────┘   │   └────┬─────┘   └────┬─────┘
          │               │         │        │               │
          │               │         │        │               │
          │               │         │        │               │
    ┌─────┴──────┐   ┌────┴─────┐   │   ┌────┴─────┐   ┌────┴─────┐
    │  Telegram  │   │   MCP    │   │   │ Anthropic│   │   Git    │
    │  (Mobile)  │   │  Client  │   │   │  Z.ai    │   │ (File I/O)│
    │  Dashboard │   │          │   │   │ OpenAI   │   │          │
    │   (Web)    │   │          │   │   │  Moonshot│   │          │
    └────────────┘   └──────────┘   │   └──────────┘   └──────────┘
```

### C1 Narrative

Aegis is the **control plane for ACP-compatible coding-agent CLIs** (ADR-0034). It does not implement AI reasoning; it provides the **infrastructure** around session management, permission governance, audit, and multi-channel orchestration (ADR-0006).

**Key interactions:**

| Actor | Role | How they connect |
|---|---|---|
| **Human Developer** | Operator — creates sessions, approves permissions, monitors dashboard | REST API, Dashboard (SPA), Telegram bot, Slack |
| **Other Agent (MCP)** | External AI agent that delegates tasks via MCP protocol | MCP stdio client (e.g., Claude Desktop) |
| **Claude Code / Kimi Code / Gemini CLI** | ACP-speaking runtime children | Child process (JSON-RPC over stdio) |
| **LLM Provider** | Supplies model inference; auth/cost owned by the user | BYO — env passthrough (e.g., `ANTHROPIC_API_KEY`, `KIMI_API_KEY`) |
| **GitHub** | Repo context for sessions; tool execution (git read/write) | Local filesystem + git CLI invoked by agent child |
| **File System / State Dir** | Persistent state, audit logs, transcripts, metrics | `AEGIS_STATE_DIR` (default: `~/.aegis`) |

**Scope boundaries (ADR-0029):**
- **In scope:** Solo developer / small team (1–100 agents). Self-hosted or local.
- **Out of scope (deferred):** SSO/OIDC, multi-tenancy, Redis coordination, K8s, SOC2, billing. These are Phase 4 features that ship only when a paying enterprise customer signs.

---

## C2: Container Diagram

### Aegis Containers

```text
                    ┌─────────────────────────────────────────────────────┐
                    │                       Aegis System                     │
                    │    (Node.js 22+ Fastify server, self-hosted)          │
                    ├─────────────────────────────────────────────────────┤
                    │                                                      │
                    │  ┌──────────────────────────────────────────┐       │
                    │  │  [CLI Client]   ag / aegis                │       │
                    │  │  ├─ init, run, doctor, templates         │       │
                    │  │  └─ HTTP client to local server           │       │
                    │  └──────────────────────────────────────────┘       │
                    │                                                      │
                    │  ┌──────────────────────────────────────────┐       │
                    │  │  [Fastify HTTP Server]   Port 9100       │       │
                    │  │  ├─ REST API (65+ endpoints)            │       │
                    │  │  ├─ SSE / WebSocket streaming            │       │
                    │  │  ├─ Auth (API keys + OIDC)              │       │
                    │  │  ├─ Rate limiting + CORS                │       │
                    │  │  └─ Static file serve (Dashboard SPA)   │       │
                    │  └──────────────────────────────────────────┘       │
                    │                         │                              │
                    │        ┌────────────────┼────────────────┐             │
                    │        │                │                │             │
                    │  ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐      │
                    │  │ [MCP      │   │ [ACP      │   │ [State    │      │
                    │  │  Server]  │   │  Backend] │   │  Store]   │      │
                    │  │  stdio    │   │  Child    │   │  File/    │      │
                    │  │  JSON-RPC │   │  process  │   │  Redis/   │      │
                    │  │  24 tools │   │  JSON-RPC │   │  Postgres │      │
                    │  └───────────┘   │  (Claude, │   └───────────┘      │
                    │                  │  Kimi,    │                     │
                    │                  │  Gemini)  │                     │
                    │                  └───────────┘                     │
                    │                                                      │
                    │  ┌──────────────────────────────────────────┐       │
                    │  │  [React Dashboard SPA]  (Vite build)      │       │
                    │  │  ├─ Overview / Sessions / Audit / Pipelines│      │
                    │  │  ├─ Real-time SSE + WebSocket            │       │
                    │  │  ├─ Design tokens (CSS variables)        │       │
                    │  │  └─ Zustand state + React Router          │       │
                    │  └──────────────────────────────────────────┘       │
                    │                                                      │
                    │  ┌──────────────────────────────────────────┐       │
                    │  │  [Channel Manager]                         │       │
                    │  │  ├─ Telegram bot (bidirectional)          │       │
                    │  │  ├─ Slack / Webhook / Email               │       │
                    │  │  └─ SSE bridge (global + per-session)     │       │
                    │  └──────────────────────────────────────────┘       │
                    │                                                      │
                    └─────────────────────────────────────────────────────┘
```

### C2 Container Details

| Container | Technology | Purpose | Key Inbound | Key Outbound |
|---|---|---|---|---|
| **Fastify HTTP Server** | Fastify 5.x, Node.js 22 | Central API gateway, auth, routing, static file serving | REST, SSE, WS, Dashboard static | ACP Backend, State Store, Channel Manager, MCP Server (via `AegisClient`) |
| **ACP Backend** | `claude-agent-acp` (npm), child_process | Spawns and manages ACP-speaking CLI runtimes (JSON-RPC over stdio) | Fastify (session creation, send, kill) | Claude Code / Kimi Code / Gemini CLI child processes; LLM provider (via env passthrough) |
| **MCP Server** | `@modelcontextprotocol/sdk` | Standard MCP server exposing Aegis as 24 tools to external MCP clients | stdio (JSON-RPC) | Fastify HTTP (via `AegisClient` wrapper) |
| **React Dashboard** | React 18 + Vite + Tailwind + Zustand | PWA dashboard for session management, audit, monitoring | Browser (HTTP/SSE/WS) | Fastify REST API |
| **CLI Client** | Node.js `process.argv`, `node-fetch` | Local `ag` / `aegis` binary — server bootstrap + one-shot session commands | Terminal (stdin) | Fastify REST API |
| **State Store** | File / Redis / PostgreSQL (pluggable) | Session persistence, audit logs, metrics, metering | Fastify (reads/writes) | Filesystem / Redis / Postgres |
| **Channel Manager** | Node.js EventEmitter | Fan-out for notifications to Telegram, Slack, Webhook, Email | Session events, monitor alerts | Telegram Bot API, Slack webhooks, SMTP, HTTP webhooks |

### C2 Key Technical Properties

1. **Single-process Node.js server** — Fastify + all services run in one process. No separate worker nodes (Phase 3, ADR-0029).
2. **ACP as the wire protocol** — All agent runners speak JSON-RPC 2.0 over stdio (ADR-0032, ADR-0034). One transport (`NdjsonRpcTransport`) covers Claude Code, Kimi Code, and Gemini CLI.
3. **BYO LLM** — Aegis passes through env vars (`ANTHROPIC_API_KEY`, `KIMI_API_KEY`, etc.) but never proxies, caches, or owns LLM cost (ADR-0034 §6).
4. **MCP is an outbound client, not a server** — The MCP server process connects to Aegis via HTTP (`AegisClient`), not the other way around. This is the "remote MCP" pattern.
5. **Dashboard is a static SPA** — Served by Fastify's `@fastify/static`. No SSR. All state comes from the REST API.
6. **State Store is pluggable** — Default `JsonFileStore` (single-node). `RedisStateStore` and `PostgresStore` available for horizontal scaling (Phase 3, not default).

---

## C3: Component Diagram (Fastify Server)

### Components within the Fastify HTTP Server

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Fastify HTTP Server (Port 9100)                      │
│                                                                                │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │  Route Handlers  │    │  Auth / RBAC     │    │  Validation      │       │
│  │  (22 route      │    │  AuthManager     │    │  Zod schemas     │       │
│  │   modules)       │    │  API keys,       │    │  api-contracts   │       │
│  │                  │    │  bearer tokens,  │    │  error-envelope  │       │
│  │  sessions.ts     │    │  OIDC,           │    │  ssrf guard      │       │
│  │  session-*.ts    │    │  permission      │    │  path-utils      │       │
│  │  auth.ts         │    │  profiles        │    │  rate-limit      │       │
│  │  pipelines.ts    │    │                  │    │                  │       │
│  │  health.ts       │    │  └─ middleware/  │    │  └─ middleware/  │       │
│  │  ...             │    │  └─ boot/        │    │  └─ boot/        │       │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘       │
│           │                      │                      │                       │
│           ▼                      ▼                      ▼                       │
│  ┌────────────────────────────────────────────────────────────────────┐        │
│  │                         Session Manager                             │        │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │        │
│  │  │  Session     │  │  Permission  │  │  Pipeline    │               │        │
│  │  │  Lifecycle   │  │  Guard       │  │  Manager     │               │        │
│  │  │  (create,    │  │  (approve,   │  │  (batch      │               │        │
│  │  │  send, kill) │  │  reject,     │  │  create,     │               │        │
│  │  │  transcript  │  │  queue)      │  │  stages)     │               │        │
│  │  └──────────────┘  └──────────────┘  └──────────────┘               │        │
│  └────────────────────────────────────────────────────────────────────┘        │
│           │                                                                     │
│           ├─────────────────────┬─────────────────────┬─────────────────────┐   │
│           │                     │                     │                     │   │
│  ┌────────┴────────┐   ┌────────┴────────┐   ┌────────┴────────┐   ┌────────┴────────┐
│  │   ACP Backend   │   │   Monitor       │   │   Channel Mgr   │   │   State Store   │
│  │  ┌─────────────┐│   │  ┌─────────────┐│   │  ┌─────────────┐│   │  ┌─────────────┐│
│  │  │  AcpBackend ││   │  │  SessionMonitor│  │  │  Telegram   ││   │  │  JsonFileStore││
│  │  │  (child     ││   │  │  (stall       ││   │  │  Slack      ││   │  │  (default)  ││
│  │  │  process)   ││   │  │  detection,   ││   │  │  Webhook    ││   │  │  RedisStore   ││
│  │  │  JSON-RPC   ││   │  │  events)      ││   │  │  Email      ││   │  │  PostgresStore││
│  │  │  client)    ││   │  │  Metering     ││   │  │  SSE bridge ││   │  └─────────────┘│
│  │  └─────────────┘│   │  └─────────────┘│   │  └─────────────┘│   └─────────────────┘
│  └─────────────────┘   └─────────────────┘   └─────────────────┘
│                                                                                │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐         │
│  │  Audit Logger    │    │  Metrics         │    │  Memory Bridge   │         │
│  │  (structured)    │    │  (Prometheus,    │    │  (scoped notes) │         │
│  │  └─ audit.ts     │    │  │  OTel traces) │    │  └─ memory-routes│         │
│  │  └─ boot/        │    │  └─ metrics.ts   │    │                  │         │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘         │
│                                                                                │
│  ┌──────────────────┐    ┌──────────────────┐                                 │
│  │  OpenAPI Spec    │    │  ServiceContainer│                                 │
│  │  (generated from │    │  (lifecycle mgmt)│                                 │
│  │  Zod schemas)    │    │  └─ container.ts │                                 │
│  │  └─ openapi.ts   │    │  └─ boot/        │                                 │
│  └──────────────────┘    └──────────────────┘                                 │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### C3 Component Details

#### Route Layer (22 modules, 65+ endpoints)

| Route Module | Endpoints | Purpose |
|---|---|---|
| `health.ts` | `GET /v1/health`, `GET /v1/swarm` | Health probes |
| `auth.ts` | `POST /v1/auth/verify`, key CRUD | API key management |
| `sessions.ts` | `POST /v1/sessions`, `GET /v1/sessions`, `GET /v1/sessions/:id` | Session CRUD |
| `session-actions.ts` | `POST /v1/sessions/:id/send`, `POST /v1/sessions/:id/kill` | Session control |
| `session-approval.ts` | `POST /v1/sessions/:id/approve`, `POST /v1/sessions/:id/reject` | Permission approval |
| `session-data.ts` | `GET /v1/sessions/:id/transcript`, `GET /v1/sessions/:id/export` | Transcript & export |
| `events.ts` | `GET /v1/events`, `GET /v1/sessions/:id/sse` | SSE streaming |
| `pipelines.ts` | `POST /v1/pipelines`, `GET /v1/pipelines` | Batch orchestration |
| `templates.ts` | `POST /v1/templates`, `GET /v1/templates` | Session templates |
| `analytics.ts` | `GET /v1/analytics`, `GET /v1/cost` | Cost & usage analytics |
| `budgets/routes.ts` | `GET /v1/budgets`, `POST /v1/budgets` | Cost alerts (ADR-0031) |
| `audit.ts` | `GET /v1/audit` | Audit log query |
| `control-actions.ts` | `POST /v1/sessions/:id/control` | CC-specific controls |
| `driver-controls.ts` | `POST /v1/driver/*` | Runner driver controls |
| `terminal.ts` | `WS /v1/sessions/:id/terminal` | WebSocket terminal relay |
| `oidc-auth.ts` | `GET /v1/auth/oidc/*` | OIDC SSO (Phase 3) |
| `device-auth.ts` | `POST /v1/auth/device/*` | OAuth2 device flow (RFC 8628) |
| `usage.ts` | `GET /v1/usage` | Usage metering |
| `cost.ts` | `GET /v1/cost` | Cost breakdown |
| `quick-approve-reject.ts` | `POST /v1/quick-approve` | Dashboard quick actions |
| `openapi/index.ts` | `GET /v1/openapi` | OpenAPI spec (ADR-0018) |
| `hooks.ts` | `POST /v1/hooks/:eventName` | Claude Code hook bridge |
| `memory-routes.ts` | `GET/POST/DELETE /v1/memory/:key` | Scoped memory |

#### Session Manager

The `SessionManager` class (`session.ts`) is the central coordinator. It delegates:

- **Lifecycle** → `AcpBackend` (spawn, send, kill via JSON-RPC)
- **Permissions** → `PermissionGuard` + `PermissionRequestManager` (queue + approve/reject)
- **Transcripts** → `SessionTranscripts` + `JsonlWatcher` (file watching + parsing)
- **Persistence** → `SessionPersistenceService` (state to StateStore)
- **Approval Flow** → `SessionApprovalService` + `SessionPermissionService`
- **Stall Detection** → `StallDetector` (typed events + recovery)
- **Metering** → `MeteringService` (token/cost per session)

#### ACP Backend (`services/acp/`)

```text
AcpBackend
├── AcpChildProcess   — spawn CC/Kimi/Gemini via child_process
├── JsonRpcClient     — JSON-RPC 2.0 over stdio
├── AcpSessionService — session state machine
├── AcpTerminalBridge — VT100 terminal output streaming
├── EventMapper       — ACP notifications → Aegis events
├── EventStore        — append-only event log
├── ActionQueue       — outbound actions (send, approve, reject)
├── ActionWorker      — queue processor
├── LocalStorageProfile — file-based persistence (default)
├── Postgres adapters  — optional Postgres stores (Phase 3.5)
└── BinaryResolver    — resolve `claude`/`kimi`/`gemini` from PATH
```

#### Channel Manager (`channels/`)

| Channel | Direction | Purpose |
|---|---|---|
| **Telegram** | Bidirectional | Approve/reject from phone; session status alerts |
| **Slack** | Outbound | Webhook alerts to Slack channels |
| **Email** | Outbound | SMTP alerts for stall/dead sessions |
| **Webhook** | Outbound | Configurable HTTP POST per endpoint |
| **SSE** | Outbound | Server-Sent Events (global + per-session) |

#### Auth / RBAC (`services/auth/`)

```text
AuthManager
├── AuthManager.ts      — API key CRUD, bearer classification
├── RateLimiter.ts      — Per-IP + per-key sliding-window rate limit
├── QuotaManager.ts     — Per-key send quotas
├── OIDCManager.ts      — Dashboard SSO (OIDC)
├── Permission profiles — Read/Write/Admin per API key
└── Session ownership   — ownerKeyId per session, enforced on action routes
```

#### State Store (`services/state/`)

```text
StateStore (interface)
├── JsonFileStore   — default, single-node
├── RedisStateStore — optional, horizontal scaling
├── PostgresStore   — optional, Phase 3.5
└── store-factory.ts — creates from AEGIS_SESSION_STORE env
```

#### Service Container (`container.ts` + `boot/`)

Lifecycle-managed services with dependency graph (Issue #1622):

```text
acpBackend
├── stateStore
│   └── sessionManager
│       ├── channelManager
│       └── sessionMonitor
└── authManager
```

Startup: topological order. Shutdown: reverse order with timeout protection.

---

## C4: Code / Class Diagram (Key Modules)

### 4.1 Session Lifecycle (Core Classes)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              Session Domain                                 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   SessionManager                                                            │
│   ────────────────                                                         │
│   - state: SessionState                                                      │
│   - persistence: SessionPersistenceService                                 │
│   - permissionService: SessionPermissionService                            │
│   - approvalService: SessionApprovalService                                │
│   + createSession(config): SessionInfo                                       │
│   + sendMessage(id, msg): Promise<void>                                    │
│   + killSession(id): Promise<void>                                          │
│   + approvePermission(id, decision): Promise<void>                        │
│   + listSessions(): SessionInfo[]                                            │
│   + getSession(id): SessionInfo | undefined                                │
│   + setAcpEventStore(store): void                                           │
│                                                                             │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐             │
│   │ SessionInfo  │      │ SessionState │      │ PermissionDecision│        │
│   │ ──────────── │      │ ──────────── │      │ ──────────────── │        │
│   │ id: string   │      │ sessions:    │      │ approved: boolean│        │
│   │ workDir: string│    │ Record<string│      │ reason?: string  │        │
│   │ status: Status│     │   SessionInfo>│     │ timestamp: string│        │
│   │ ownerKeyId: string│  │              │      └────────────────┘        │
│   │ tenantId: string │   └──────────────┘                                 │
│   └──────────────┘                                                         │
│                                                                             │
│   ┌──────────────┐      ┌──────────────┐      ┌──────────────┐             │
│   │ SessionPerm..│      │ SessionAppr..│      │ SessionTrans..│             │
│   │ Service      │      │ ovalService  │      │ cripts        │             │
│   │ ──────────── │      │ ──────────── │      │ ────────────  │             │
│   │ + resolve()  │      │ + flow()     │      │ + read()      │             │
│   │ + normalize()│      │ + check()    │      │ + export()    │             │
│   └──────────────┘      └──────────────┘      └──────────────┘             │
│                                                                             │
│   ┌──────────────┐      ┌──────────────┐                                  │
│   │ StallDetector│      │ MeteringServ..│                                  │
│   │ ──────────── │      │ ────────────  │                                  │
│   │ + detect()   │      │ + record()    │                                  │
│   │ + emitTyped()│      │ + getSummary()│                                  │
│   └──────────────┘      └──────────────┘                                  │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Runner Abstraction (Multi-Agent — ADR-0032)

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              Runner Domain                                  │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   AgentRunner (interface)                                                    │
│   ─────────────────                                                          │
│   + name: string                                                             │
│   + start(sessionId, config): Promise<RunnerStartResult>                     │
│   + sendInput(handle, input): Promise<RunnerSendResult>                      │
│   + readOutput(handle): AsyncIterable<OutputChunk>                           │
│   + kill(handle, options?): Promise<RunnerKillResult>                        │
│   + isAlive(handle): boolean                                                 │
│   + getHandle(sessionId): ProcessHandle | undefined                         │
│                                                                             │
│   ┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐│
│   │  ClaudeCodeRunner  │    │  KimiRunner        │    │  GeminiCliRunner   ││
│   │  (ACP, production) │    │  (ACP, planned)    │    │  (ACP, planned)    ││
│   │  ────────────────  │    │  ────────────────  │    │  ────────────────  ││
│   │  spawn: claude     │    │  spawn: kimi acp   │    │  spawn: gemini     ││
│   │  protocol: ACP     │    │  protocol: ACP     │    │  protocol: ACP     ││
│   │  transport:        │    │  transport:        │    │  transport:        ││
│   │    NdjsonRpcTr..   │    │    NdjsonRpcTr..   │    │    NdjsonRpcTr..   ││
│   └────────────────────┘    └────────────────────┘    └────────────────────┘│
│                                                                             │
│   RunnerRegistry (interface)                                                 │
│   InMemoryRunnerRegistry (implements)                                        │
│   ─────────────────────                                                      │
│   - runners: Map<string, AgentRunner>                                      │
│   - defaultRunner: AgentRunner                                               │
│   + register(runner): void                                                   │
│   + get(name): AgentRunner | undefined                                       │
│   + listNames(): string[]                                                    │
│   + getDefault(): AgentRunner                                              │
│                                                                             │
│   ┌────────────────────┐                                                     │
│   │ AcpBackend         │                                                     │
│   │ ────────────       │  ← Currently spawns directly; Phase 3.6 wires      │
│   │ - sessionService   │     through AgentRunner abstraction               │
│   │ - jsonRpcClient    │                                                     │
│   │ + createSession()  │                                                     │
│   │ + sendMessage()    │                                                     │
│   │ + shutdownSession()│                                                     │
│   └────────────────────┘                                                     │
│                                                                             │
│   ┌────────────────────┐                                                   │
│   │ NdjsonRpcTransport │  ← Reused across all ACP runners (ADR-0032 §4.3) │
│   │ ────────────────     │                                                   │
│   │ - childProcess       │                                                   │
│   │ + request(method)    │                                                   │
│   │ + notify(method)     │                                                   │
│   │ + onNotification(cb) │                                                   │
│   └────────────────────┘                                                   │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 MCP Tool Registry

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              MCP Domain                                     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   McpServer (from @modelcontextprotocol/sdk)                                 │
│   ──────────────────────────────────────                                   │
│   + name: 'aegis'                                                            │
│   + version: string                                                          │
│                                                                             │
│   ┌────────────────────┐                                                     │
│   │ createMcpServer()  │  ← McpServer + StdioServerTransport                │
│   │ startMcpServer()   │  ← stdio entrypoint                                │
│   └────────────────────┘                                                     │
│                                                                             │
│   ┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐│
│   │ registerSessionTools│   │ registerAcpTools() │   │ registerMonitoring..││
│   │ (session-tools.ts) │   │ (acp-tools.ts)      │   │ (monitoring-tools..)││
│   │ ───────────────────│   │ ───────────────────│   │ ───────────────────││
│   │ create_session     │   │ acp_status_sync    │   │ server_health      ││
│   │ send_message       │   │ acp_event_stream   │   │ capture_pane       ││
│   │ kill_session       │   │ acp_action_queue   │   │ get_session_metrics││
│   │ get_status         │   │ acp_terminal_bridge│   │ get_session_summary││
│   │ get_transcript     │   │                    │   │ get_session_latency││
│   │ approve/reject     │   │                    │   │ get_swarm          ││
│   │ interrupt/escape   │   │                    │   │                    ││
│   └────────────────────┘    └────────────────────┘    └────────────────────┘│
│                                                                             │
│   ┌────────────────────┐    ┌────────────────────┐                           │
│   │ registerPipeline.. │    │ registerManagement..│                          │
│   │ (pipeline-tools.ts)│    │ (management-tools..)│                          │
│   │ ───────────────────│    │ ───────────────────│                          │
│   │ batch_create_sess..│    │ state_set/get/del │                          │
│   │ create_pipeline    │    │ auth_key CRUD      │                          │
│   │ list_pipelines     │    │ template CRUD      │                          │
│   └────────────────────┘    └────────────────────┘                           │
│                                                                             │
│   ┌────────────────────┐                                                   │
│   │ AegisClient (mcp/client.ts)                                              │
│   │ ────────────────────                                                     │
│   │ HTTP wrapper: REST calls → McpServer backend                             │
│   │ Used by: remote MCP mode (stdio → HTTP bridge)                           │
│   └────────────────────┘                                                     │
│                                                                             │
│   ┌────────────────────┐                                                   │
│   │ IAegisBackend (interface)                                                │
│   │ ─────────────────────────                                                │
│   │ Abstract contract: both AegisClient (remote) and                         │
│   │ EmbeddedBackend (in-process) implement this                             │
│   └────────────────────┘                                                     │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.4 Channel Notification Architecture

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              Channel Domain                                 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ChannelManager                                                             │
│   ──────────────                                                             │
│   - channels: Channel[]                                                      │
│   + fanOut(event): Promise<void>                                             │
│   + init(handleInbound): Promise<void>                                       │
│   + destroy(): Promise<void>                                                 │
│                                                                             │
│   ┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐│
│   │ TelegramChannel    │    │ SlackChannel       │    │ WebhookChannel     ││
│   │ (telegram.ts)      │    │ (slack.ts)         │    │ (webhook.ts)       ││
│   │ ─────────────────  │    │ ─────────────────  │    │ ─────────────────  ││
│   │ + sendMessage()    │    │ + sendMessage()    │    │ + sendMessage()    ││
│   │ + handleCommand()  │    │                    │    │ + retry delivery   ││
│   │ + approve/reject   │    │                    │    │ + HMAC signing     ││
│   │   from inline KB   │    │                    │    │                    ││
│   └────────────────────┘    └────────────────────┘    └────────────────────┘│
│                                                                             │
│   ┌────────────────────┐    ┌────────────────────┐                         │
│   │ EmailChannel       │    │ SSEChannel         │                         │
│   │ (email.ts)         │    │ (sse-writer.ts)    │                         │
│   │ ─────────────────  │    │ ─────────────────  │                         │
│   │ + sendMessage()    │    │ + sendMessage()    │                         │
│   │                    │    │ + stream events      │                         │
│   └────────────────────┘    └────────────────────┘                         │
│                                                                             │
│   SessionEventBus (events.ts) — internal pub/sub for all session events     │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.5 Configuration & Boot Flow

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                              Boot Domain                                    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   cli.ts ──→ main() ──→ boot sequence (server-bootstrap.ts)                │
│                                                                             │
│   1. loadConfig() ──→ config/index.ts (Zod schemas per domain)            │
│      ├── auth.ts     │  API keys, tokens, OIDC                              │
│      ├── channels.ts │  Telegram, Slack, webhook, email                     │
│      ├── server.ts   │  Port, host, CORS, rate limits                       │
│      ├── sessions.ts │  Timeouts, stall thresholds, cleanup                │
│      └── budgets.ts  │  Alert thresholds, quotas                             │
│                                                                             │
│   2. bootAcp() ──→ ACP local profile + session service + backend            │
│                                                                             │
│   3. registerCoreServices() ──→ ServiceContainer                          │
│      ├── sessionManager  → start: load sessions + cleanup timer            │
│      ├── authManager     → start: load keys + auto-repair                  │
│      ├── channelManager  → start: init channels                             │
│      └── sessionMonitor  → start: begin polling                            │
│                                                                             │
│   4. registerRoutes() ──→ all 22 route modules + OpenAPI                   │
│                                                                             │
│   5. container.start(['sessionManager', 'sessionMonitor', ...])           │
│      → topological order via dependency graph                               │
│                                                                             │
│   6. listenWithRetry() ──→ Fastify.listen()                                 │
│                                                                             │
│   Graceful shutdown: SIGTERM → container.stop() → reverse topological order    │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flows

### 1. Session Creation → Approval → Completion

```text
Developer (Dashboard / CLI / Telegram)
    │
    ▼ POST /v1/sessions { prompt: "...", workDir: "/path" }
    │
Fastify Route (sessions.ts)
    │
    ▼ AuthManager.verify() → check API key + session ownership
    │
    ▼ SessionManager.createSession()
    │   ├── validateWorkDir() — check allowedWorkDirs
    │   ├── AcpBackend.createSession() → spawn child process
    │   │   ├── BinaryResolver.resolve("claude") → /usr/local/bin/claude
    │   │   ├── AcpChildProcess.spawn() → JSON-RPC handshake
    │   │   └── AcpSessionService.setState("idle")
    │   └── StateStore.save() → persist state.json
    │
    ▼ ChannelManager.fanOut("session.created")
    │   ├── Telegram: "Session created: ..."
    │   └── SSE: event to dashboard subscribers
    │
Developer (or Telegram) → POST /v1/sessions/:id/send
    │
    ▼ SessionManager.sendMessage()
    │   ├── AcpBackend.sendMessage() → JSON-RPC to child
    │   └── AcpEventStore.append() → event log
    │
Claude Code (child process) → tool_use (permission request)
    │
    ▼ AcpBackend.onNotification() → map to Aegis event
    │   ├── EventMapper → Aegis event type
    │   └── EventStore.append()
    │
    ▼ SessionManager.permissionGuard() → PermissionRequestManager.queue()
    │
    ▼ ChannelManager.fanOut("permission_request")
    │   ├── Telegram: inline keyboard [Approve] [Reject]
    │   └── Dashboard: toast notification
    │
Developer (Telegram / Dashboard) → POST /v1/sessions/:id/approve
    │
    ▼ SessionManager.approvePermission()
    │   ├── PermissionRequestManager.resolve()
    │   └── AcpBackend.approveAction() → JSON-RPC to child
    │
Claude Code → continues → tool_result → completion
    │
    ▼ AcpBackend.onNotification() → session.completed
    │
    ▼ ChannelManager.fanOut("session.completed")
    │   ├── Telegram: "Session completed: ..."
    │   └── SSE: final state update
    │
    ▼ StateStore.save() → updated state
    │
    ▼ AuditLogger.write() → structured audit entry
```

### 2. MCP Tool Invocation Flow

```text
Claude Desktop (MCP Host)
    │
    ▼ stdio JSON-RPC: tools/list
    │
McpServer (mcp/server.ts)
    │
    ▼ createMcpServerFromBackend(IAegisBackend)
    │   └── AegisClient (HTTP wrapper to Fastify)
    │
    ▼ GET /v1/sessions (via AegisClient)
    │
Fastify → Route → SessionManager → AcpBackend
    │
    ▼ Response → AegisClient → McpServer → Claude Desktop
    │
Claude Desktop → tools/call: create_session
    │
    ▼ POST /v1/sessions (via AegisClient)
    │
Fastify → SessionManager → AcpBackend → child process
    │
    ▼ Result → back through chain → Claude Desktop
```

---

## Deployment Views

### Solo Developer (Default)

```text
┌─────────────────────────────┐
│   Local Machine (Linux/Mac)│
│                             │
│   ┌─────────────────────┐  │
│   │  npx @onestepat4time│  │
│   │  /aegis             │  │
│   │                     │  │
│   │  Fastify (9100)     │  │
│   │  ├─ Dashboard SPA   │  │
│   │  ├─ ACP Backend     │  │
│   │  │   └─ claude     │  │  ← Child process
│   │  ├─ State: file    │  │
│   │  └─ Channels: TG   │  │
│   │                     │  │
│   │  ~/.aegis/         │  │
│   │  ├─ state.json     │  │
│   │  ├─ audit/         │  │
│   │  └─ metrics.json   │  │
│   └─────────────────────┘  │
│                             │
│   Browser → localhost:9100  │
│   Telegram → Bot API        │
└─────────────────────────────┘
```

### Docker (Single Container)

```text
┌─────────────────────────────┐
│   Docker Host               │
│                             │
│   ┌─────────────────────┐  │
│   │  aegis:latest         │  │
│   │  (node:22-bookworm)  │  │
│   │                     │  │
│   │  Port 9100 → 0.0.0.0│  │
│   │  USER aegis (uid 1001)│  │
│   │  ~/.aegis/ → volume   │  │
│   └─────────────────────┘  │
│                             │
│   docker run -p 9100:9100   │
│     -v aegis-data:/home/    │
│       aegis/.aegis          │
│     onestepat4time/aegis    │
└─────────────────────────────┘
```

---

## Architecture Decisions (C4 Rationale)

| Decision | C4 Impact | ADR |
|---|---|---|
| **Middleware, not framework** | Aegis does not appear in C1 as "AI" — it is infrastructure around agents | ADR-0006 |
| **ACP as wire protocol** | C2: One transport container (`NdjsonRpcTransport`) serves all runners; C4: `AgentRunner` interface reused | ADR-0032, ADR-0034 |
| **Solo-dev first** | C2: Single-process, file-based state by default; no K8s/RabbitMQ in C2 | ADR-0029 |
| **Multi-CLI runtime** | C2: Runner registry; C4: `AgentRunner` + stubs; Claude Code default, Kimi/Gemini planned | ADR-0032, ADR-0034 |
| **BYO LLM** | C1: LLM provider is external; Aegis passes env, never proxies | ADR-0034 |
| **MIT single edition** | C1: All features ship to all users; no `AEGIS_EDITION` flag | ADR-0034, ADR-0029 |
| **Server decomposition** | C3: Fastify plugins per concern; `boot/` modules for service wiring | ADR-0007 |
| **Pluggable state store** | C2: State Store container is abstract; file default, Redis/Postgres optional | ADR-0025 |
| **MCP remote client** | C2: MCP Server is an outbound client, not inbound server | — |
| **OpenAPI from Zod** | C3: `api-contracts.ts` is source of truth; spec auto-generated | ADR-0018 |
| **OpenTelemetry tracing** | C3: Spans on HTTP, session, tool, ACP, channel | ADR-0017 |
| **Session ownership authz** | C3: `ownerKeyId` per session; enforced in route guards | ADR-0019 |
| **Env-var denylist** | C3: `validateWorkDir` + env filtering at session create | ADR-0020 |
| **SSE drain timeouts** | C3: `sse-writer.ts` + `sse-limiter.ts` with idle timeout | ADR-0021 |
| **Sigstore attestations** | C1: npm package signed; CI verifies | ADR-0022 |
| **Dashboard token in memory** | C3: `DashboardSessionStore` — no localStorage | ADR-0024 |
| **Budget alerts API** | C3: `BudgetStore` + `BudgetEvaluator` + `BudgetNotifier` | ADR-0031 |
| **Network isolation by tier** | C1: Three deployment tiers (local, CI/CD, zero-trust) | ADR-0030 |

---

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-07-09 | Initial C4 document (C1–C4) covering all abstraction levels | Scribe |
| 2026-07-09 | Grounded in ADR-0034 (multi-CLI positioning), ADR-0032 (multi-agent architecture), ADR-0029 (solo-dev refocus), ADR-0006 (middleware) | Scribe |

---

> **Sources of truth:** This document is validated against the `develop` branch at commit `b9481130`. For module-level details, see [`architecture.md`](./architecture.md). For positioning and ADR index, see [`docs/adr/`](./adr/). For the roadmap, see [`ROADMAP.md`](../../ROADMAP.md).
