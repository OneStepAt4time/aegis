# Architecture

Aegis is built around a layered architecture: a CLI entrypoint, a Fastify HTTP server, a tmux-based session manager, and an MCP server for agent integration.

## Module Overview

```
src/
├── cli.ts                    # CLI entrypoint — parses args, starts server or MCP
├── startup.ts                # Server bootstrap — PID file, graceful shutdown
├── container.ts              # Lightweight DI container + lifecycle orchestration
├── server.ts                 # Fastify HTTP server — all REST routes
├── config.ts                 # Configuration loading from env + config file
├── auth.ts                   # Backward-compatible auth re-export (services/auth)
│
├── session.ts                # Session lifecycle — create, send, kill, state tracking
├── session-cleanup.ts        # Idle session reaping and resource cleanup
├── tmux.ts                   # tmux operations — windows, panes, send-keys
├── terminal-parser.ts        # Detect Claude Code UI state from terminal output
├── vt100-screen.ts            # Pure TS VT100/ANSI terminal emulator (screen buffer)
├── pty-stream.ts              # Real-time PTY output streaming via tmux pipe-pane + FIFO
├── channels/                  # Notification channels (event fan-out)
│   ├── manager.ts            # Event fan-out to all active channels
│   ├── telegram.ts           # Telegram bot — bidirectional (approve/reject from chat)
│   ├── slack.ts              # Slack incoming webhooks — session alerts
│   ├── email.ts             # SMTP email alerts — stall/dead/error to ops
│   ├── webhook.ts           # Generic HTTP webhooks — configurable per-endpoint
│   └── types.ts             # Channel interface, SessionEvent types
├── transcript.ts             # JSONL transcript parsing — entries, token usage
├── jsonl-watcher.ts          # File watcher for Claude Code JSONL output
│
├── mcp/                       # MCP server modules (split by concern)
│   ├── server.ts             # MCP server setup + transport
│   ├── client.ts             # AegisClient HTTP wrapper (remote mode)
│   ├── embedded.ts           # In-process backend
│   ├── tools/                # MCP tool modules (session, pipeline, monitoring, management)
│   ├── prompts.ts            # MCP prompt definitions
│   ├── resources.ts          # MCP resource handlers
│   └── auth.ts               # Per-tool RBAC enforcement
├── tool-registry.ts          # CC tool usage tracking + per-session metrics
├── handshake.ts              # Client capability negotiation
│
├── pipeline.ts               # Batch session creation and multi-stage orchestration
├── swarm-monitor.ts          # Parallel session swarm coordination
├── template-store.ts         # Reusable session templates with variable substitution
├── continuation-pointer.ts   # Resume sessions from checkpointed state
├── question-manager.ts       # Pending user question lifecycle management
│
├── monitor.ts                # Session state monitoring — stall detection, events
├── events.ts                 # SSE event types (session + global)
├── sse-writer.ts             # SSE response streaming
├── sse-limiter.ts            # SSE rate limiting per client
├── ws-terminal.ts            # WebSocket terminal relay (PTY streaming + catchup)
│
├── permission-guard.ts       # Permission request interception and routing
├── services/
│   ├── auth/
│   │   ├── AuthManager.ts    # API key management and bearer token classification
│   │   ├── RateLimiter.ts    # Route-level IP and auth-failure rate limiting
│   │   ├── types.ts          # Auth manager and API key types
│   │   └── index.ts          # Auth service exports
│   ├── state/
│   │   ├── state-store.ts    # Pluggable session state store interface
│   │   ├── JsonFileStore.ts  # Default: file-backed state persistence
│   │   ├── RedisStateStore.ts # Redis-backed state for horizontal scaling
│   │   ├── PostgresStore.ts  # PostgreSQL-backed state with connection pooling
│   │   ├── store-factory.ts  # Factory: creates StateStore from config
│   │   └── index.ts          # State store module re-exports
│   └── permission/
│       ├── evaluator.ts      # Permission profile evaluation logic
│       ├── types.ts          # Permission evaluator input/output types
│       └── index.ts          # Permission evaluator exports
├── permission-request-manager.ts  # Permission request queue and lifecycle
├── permission-routes.ts      # REST endpoints for approve/reject/list permissions
│
├── memory-bridge.ts          # Scoped memory API — attach notes to sessions
├── memory-routes.ts          # REST endpoints for memory CRUD
├── metrics.ts                # Token usage tracking and cost estimation
├── screenshot.ts             # URL screenshot capture via Playwright
│
├── hooks.ts                  # Hook route registration (Fastify plugin)
├── hook.ts                   # Hook command builder — pre/post session lifecycle
├── hook-settings.ts          # Hook configuration parsing and validation
│
├── api-contracts.ts          # Shared Zod schemas and TypeScript types for API I/O
├── api-error-envelope.ts     # Standardized error response format
├── error-categories.ts       # Error classification taxonomy
├── validation.ts             # Request validation helpers
├── safe-json.ts              # Safe JSON parsing with Zod schema support
├── ssrf.ts                   # SSRF protection for URL-based operations
├── path-utils.ts             # Cross-platform path normalization
├── file-utils.ts             # File system helpers (lock files, temp dirs)
├── process-utils.ts          # Process discovery and management
├── retry.ts                  # Generic retry with exponential backoff
├── suppress.ts               # Log suppression for noisy operations
├── logger.ts                 # Structured logging
├── diagnostics.ts            # Health check and diagnostic data collection
├── fault-injection.ts        # Testing helper for simulating failures
├── shutdown-utils.ts         # Graceful shutdown coordination
├── signal-cleanup-helper.ts  # Signal handler cleanup on exit
├── verification.ts           # External verification integration
└── worktree-lookup.ts        # Git worktree discovery

packages/
├── client/                    # Official TypeScript SDK (OpenAPI-generated, published to npm)
│   └── src/
│       ├── AegisClient.ts     # Backward-compatible wrapper class (v0.3.x API)
│       ├── index.ts           # Public exports (class + SDK functions + types)
│       └── generated/         # Auto-generated from openapi.yaml (do not edit)
│           ├── sdk.gen.ts     # 53 endpoint functions
│           ├── types.gen.ts   # Request/response types
│           ├── client.gen.ts  # HTTP client setup
│           └── core/          # Auth, serialization, SSE utilities
└── python-client/             # Official Python SDK (OpenAPI-generated)
    └── src/aegis_python_client/
        ├── client.py           # AegisClient class (53 methods, urllib-based)
        ├── models.py           # Pydantic v2 models (33 types)
        └── __init__.py         # Package exports

dashboard/                     # React dashboard (served by Fastify static)
├── src/
│   ├── App.tsx               # Main app with routing and auth
│   ├── pages/
│   │   ├── LoginPage.tsx     # Token auth login screen
│   │   ├── SessionListPage.tsx  # Live session list with filtering
│   │   ├── AuditPage.tsx     # Audit trail with pagination + filters
│   │   └── NotFoundPage.tsx  # 404 handler
│   ├── api/
│   │   └── client.ts         # Typed fetch wrapper for Aegis REST API
│   └── components/           # Shared UI components

## Dashboard Architecture

### Technology Stack

- **Framework:** React 18 + TypeScript
- **Build:** Vite
- **Routing:** React Router v6 (client-side SPA routing)
- **State:** Zustand (global state management)
- **Styling:** CSS design tokens + CSS Modules
- **API:** REST API via typed `client.ts` wrapper

### SPA Layout

```
App.tsx (Router)
├── ProtectedRoute (auth guard)
│   └── Layout (sidebar + main content)
│       ├── Header (theme toggle, user info)
│       ├── Sidebar (nav: Overview, Sessions, Pipelines, Audit, Users)
│       └── Outlet (page content)
│           ├── OverviewPage
│           ├── SessionHistoryPage
│           ├── SessionDetailPage
│           ├── PipelinesPage
│           ├── PipelineDetailPage
│           ├── AuditPage
│           ├── UsersPage
│           ├── AuthKeysPage
│           └── SettingsPage
└── LoginPage (unauthenticated)
```

### Design Token System

Aegis uses CSS custom properties for consistent theming. Design tokens are defined in `dashboard/src/index.css`:

| Token Category | Examples |
|---|---|
| **Colors** | `--color-bg-primary`, `--color-bg-secondary`, `--color-text-primary`, `--color-text-secondary` |
| **Borders** | `--border-radius-sm`, `--border-radius-md`, `--border-radius-lg` |
| **Spacing** | `--space-xs`, `--space-sm`, `--space-md`, `--space-lg` |
| **Typography** | `--font-family`, `--font-size-sm`, `--font-size-base`, `--font-size-lg` |

Dark/light theme is supported via CSS variables. The `useTheme` hook manages theme state with localStorage persistence and `prefers-color-scheme` system detection. Theme is applied via `data-theme` attribute on `<html>`.

See: PR #1816 (dark/light theme toggle)

### Component System

| Component | Purpose | Key Features |
|---|---|---|
| `Layout` | App shell with sidebar | Navigation, breadcrumb slot, session status |
| `ProtectedRoute` | Auth guard | Redirects to `/login` if unauthenticated |
| `ToastContainer` | User feedback | Auto-dismiss, type icons, progress bar, clear-all |
| `ConfirmDialog` | Destructive action confirmation | Accessible, focus trap |
| `ErrorBoundary` | React error boundary | Catch JS errors, display fallback UI |
| `MetricCard` | KPI display | Sparkline mini-charts, trend indicators |
| `SessionTable` | Session list | Sortable headers, pagination |
| `EmptyState` | Empty data states | Consistent styling across pages |

See: PRs #1779 (session history), #1785 (sparklines), #1796 (toast improvements), #1789 (empty states), #1807 (breadcrumb)

### SSE Integration

The dashboard receives real-time updates via Server-Sent Events (SSE). Key hooks:

- **`useSseAwarePolling`** — Polls `/v1/sessions` on an interval, pauses when tab is hidden to save resources
- **`useSessionPolling`** — Session-specific polling with SSE awareness
- **`useKeyboardShortcuts`** — Global keyboard navigation (`?`, `Ctrl+K`, `G+O/S/P/A/U`)

SSE events stream from `/v1/sessions/:id/events`. The dashboard displays a live status indicator (green "Live" or amber "Polling") on the Overview page.

See: PRs #1812 (SSE live updates), #1816 (theme toggle)

### API Client

All dashboard API calls go through `dashboard/src/api/client.ts`, a typed fetch wrapper:

```typescript
// Example
const sessions = await client.sessions.list({ status: 'idle' })
const session = await client.sessions.get(sessionId)
await client.sessions.send(sessionId, { content: 'refactor the auth module' })
```

### Key Dashboard Pages

| Page | Route | Features |
|---|---|---|
| Overview | `/dashboard/overview` | Metric cards with sparklines, live session count, health status |
| Sessions | `/dashboard/sessions` | Search, date range filter, sortable table, CSV export |
| Session Detail | `/dashboard/sessions/:id` | Transcript viewer, action buttons, pane/screenshot, breadcrumb |
| Pipelines | `/dashboard/pipelines` | Pipeline list, status, create modal |
| Audit | `/dashboard/audit` | Filterable audit log, pagination |
| Settings | `/dashboard/settings` | Theme, page size, auto-refresh toggle |

See: PRs #1779 (search/filter), #1782 (keyboard shortcuts), #1791 (CSV export), #1807 (breadcrumb)

## Core Layers

### 1. Entry & Configuration

| Module | Purpose |
|---|---|
| `cli.ts` | Parses CLI arguments, delegates to `server.ts` or `mcp-server.ts` |
| `startup.ts` | Writes PID file, registers signal handlers, coordinates shutdown |
| `config.ts` | Loads config from `aegis.config.json` and environment variables |
| `services/auth/AuthManager.ts` | Manages API keys and classifies bearer tokens for route protection |

### 2. Session Management

| Module | Purpose |
|---|---|
| `session.ts` | Core session lifecycle: create, send messages, kill, state tracking |
| `session-cleanup.ts` | Reaps idle sessions and frees resources |
| `tmux.ts` | Low-level tmux operations: create windows, send-keys, capture output |
| `terminal-parser.ts` | Detects Claude Code's UI state (working, idle, permission prompt, etc.) from terminal text |
| `vt100-screen.ts` | Pure TypeScript VT100/ANSI terminal emulator — in-memory screen buffer for clean state detection |
| `pty-stream.ts` | Real-time PTY output streaming via tmux `pipe-pane` + FIFO (replaces 500ms polling) |
| `transcript.ts` | Parses Claude Code's JSONL output into structured entries with token usage |
| `jsonl-watcher.ts` | Watches JSONL files for new entries in real time |

### 3. Agent Integration (MCP)

The MCP server is split into focused modules under `src/mcp/`:

| Module | Purpose |
|---|---|
| `mcp/server.ts` | MCP server setup, transport, and tool registration (~56 lines) |
| `mcp/client.ts` | `AegisClient` HTTP wrapper for remote MCP mode (~265 lines) |
| `mcp/embedded.ts` | Embedded backend — in-process tool execution (~271 lines) |
| `mcp/tools/session-tools.ts` | Session lifecycle tools: create, kill, send_message, etc. (~296 lines) |
| `mcp/tools/pipeline-tools.ts` | Pipeline and batch tools: create_pipeline, batch_create_sessions (~86 lines) |
| `mcp/tools/monitoring-tools.ts` | Observability tools: health, metrics, latency, diagnostics (~142 lines) |
| `mcp/tools/management-tools.ts` | Management tools: auth keys, templates, config (~81 lines) |
| `mcp/prompts.ts` | MCP prompt definitions for Claude Code (~141 lines) |
| `mcp/resources.ts` | MCP resource handlers for dynamic data (~113 lines) |
| `mcp/auth.ts` | Per-tool RBAC enforcement and MCP error formatting |
| `tool-registry.ts` | CC tool usage tracking and per-session/introspection metrics |

#### Threat model: MCP prompts

The MCP prompts (`implement_issue`, `review_pr`, `debug_session`) interpolate
user-controlled values into instructions that a host model may act on. Treat
those arguments as untrusted command surfaces, not benign display strings.

- Reject inline tool-invocation markers such as `<tool_use>`, JSON
  `type: "tool_use"` payloads, and raw MCP tool names like
  `approve_permission`, `send_bash`, or `kill_session`.
- Reject control characters, newlines, bidi overrides, zero-width code points,
  and code-fence markers that can hide or reshape instructions.
- Constrain identifiers (`issueNumber`, `prNumber`, `sessionId`, `repoOwner`,
  `repoName`) to narrow formats instead of escaping arbitrary text.
- Reject `workDir` values containing path traversal segments (`..`) or prompt
  injection markers rather than silently rewriting them.

### 4. Orchestration

| Module | Purpose |
|---|---|
| `pipeline.ts` | Batch session creation and multi-stage orchestration (sequential or parallel stages). State persisted to StateStore — survives restarts. |
| `swarm-monitor.ts` | Coordinates parallel session swarms with status aggregation |

### 5. Session State Persistence

Aegis supports pluggable session state backends via the `StateStore` interface (#1937). The default file-based store is suitable for single-node deployments; Redis and PostgreSQL backends enable horizontal scaling.

| Module | Purpose |
|---|---|
| `services/state/state-store.ts` | Abstract interface: `load()`, `save()`, `getSession()`, `putSession()`, `deleteSession()`, `listSessionIds()` |
| `services/state/JsonFileStore.ts` | Default file-backed implementation — reads/writes `state.json` |
| `services/state/RedisStateStore.ts` | Redis-backed implementation for multi-node horizontal scaling |
| `services/state/PostgresStore.ts` | PostgreSQL implementation with connection pooling, JSONB storage, and transactional saves |
| `services/state/store-factory.ts` | Factory function: creates the correct `StateStore` based on `AEGIS_SESSION_STORE` env var |

Backend selection via environment:

| `AEGIS_SESSION_STORE` | Backend | Required env vars |
|---|---|---|
| `file` (default) | Local filesystem | `AEGIS_STATE_DIR` |
| `redis` | Redis | `AEGIS_REDIS_URL` |
| `postgres` | PostgreSQL | `AEGIS_POSTGRES_URL` |

### 6. Templates

| Module | Purpose |
|---|---|
| `template-store.ts` | Reusable session templates with variable substitution (PRD, environment, prompts) |
| `continuation-pointer.ts` | Checkpoints and resumes sessions from saved state |
| `question-manager.ts` | Manages pending user questions with TTL and lifecycle |

### 7. Monitoring & Events

| Module | Purpose |
|---|---|
| `monitor.ts` | Session state monitor — detects stalls, tracks status transitions |
| `events.ts` | Defines SSE event types for session and global events |
| `sse-writer.ts` | Streams SSE events to HTTP clients |
| `sse-limiter.ts` | Rate-limits SSE connections per client |
| `ws-terminal.ts` | Relays terminal output over WebSocket using real-time PTY streaming |
| `tracing.ts` | OpenTelemetry tracing — spans for HTTP routes, session create/kill, tmux operations, channel delivery |

#### OpenTelemetry Tracing

Aegis emits distributed traces via OTLP HTTP when enabled (`AEGIS_OTEL_ENABLED=true`). Spans flow through the full request path:

- **HTTP routes** — auto-instrumented via `@opentelemetry/instrumentation-fastify`
- **Session lifecycle** — `session.create`, `session.kill` spans with `tmux.create_window`/`tmux.kill_window` sub-spans
- **Channel delivery** — `channel.deliver` spans in `ChannelManager.fanOut()`
- **Log correlation** — structured logs include `trace_id` and `span_id` when tracing is active

See [deployment.md](./deployment.md#opentelemetry-tracing) for configuration and quick-start guides.

### 8. Permissions

| Module | Purpose |
|---|---|
| `permission-guard.ts` | Intercepts permission requests and routes to evaluator |
| `services/permission/evaluator.ts` | Evaluates permission requests against profiles |
| `permission-request-manager.ts` | Queues and tracks pending permission requests |
| `permission-routes.ts` | REST endpoints: approve, reject, list pending permissions |

### 9. Memory & Metrics

| Module | Purpose |
|---|---|
| `memory-bridge.ts` | Scoped memory API — attach notes and context to sessions |
| `memory-routes.ts` | REST endpoints for memory CRUD (`/v1/memory/*`) |
| `metrics.ts` | Token usage tracking, cost estimation, and session statistics |
| `screenshot.ts` | Captures URL screenshots via Playwright |

### 10. Hooks

| Module | Purpose |
|---|---|
| `hooks.ts` | Fastify plugin that registers hook routes |
| `hook.ts` | Builds hook commands for pre/post session lifecycle events |
| `hook-settings.ts` | Parses and validates hook configuration |

### 11. Shared Utilities

| Module | Purpose |
|---|---|
| `api-contracts.ts` | Zod schemas and TypeScript types for all API request/response shapes |
| `api-error-envelope.ts` | Standardized error response format `{ error, code, details }` |
| `error-categories.ts` | Error classification taxonomy |
| `validation.ts` | Request validation helpers using Zod |
| `safe-json.ts` | Safe JSON parsing with optional Zod schema validation |
| `ssrf.ts` | SSRF protection for URL-based operations |
| `path-utils.ts` | Cross-platform path normalization (Windows/Unix) |
| `file-utils.ts` | File system helpers — lock files, temp directories |
| `process-utils.ts` | Process discovery and management (PID lookup, tree) |
| `retry.ts` | Generic retry with exponential backoff |
| `suppress.ts` | Log suppression for noisy operations |
| `logger.ts` | Structured logging with trace ID correlation |
| `tracing.ts` | OpenTelemetry distributed tracing — spans for HTTP, session lifecycle, tmux, channel delivery |
| `diagnostics.ts` | Health check and diagnostic data collection |
| `fault-injection.ts` | Testing helper for simulating failures |
| `shutdown-utils.ts` | Graceful shutdown coordination |
| `signal-cleanup-helper.ts` | Signal handler cleanup on process exit |
| `verification.ts` | External verification integration |
| `worktree-lookup.ts` | Git worktree discovery for session workDir |

## Request Flow

```
Client (curl / MCP / Dashboard)
  │
  ▼
server.ts (Fastify, port 9100)
  │
  ├─ services/auth/AuthManager.ts (bearer token validation)
  │
  ├─ api-contracts.ts (request validation)
  │
  ├─ session.ts (session operations)
  │     │
  │     ├─ tmux.ts (tmux window management)
  │     ├─ terminal-parser.ts (UI state detection via VT100Screen)
  │     ├─ pty-stream.ts (real-time PTY output streaming)
  │     ├─ transcript.ts (JSONL parsing)
  │     └─ permission-guard.ts (approval flow)
  │
  ├─ services/state/ (pluggable session persistence)
  │     └─ swarm-monitor.ts (parallel coordination)
  │
  ├─ monitor.ts (state tracking + events)
  │     └─ events.ts → sse-writer.ts (SSE streaming)
  │
  └─ mcp/ (MCP protocol, stdio)
        ├─ server.ts (setup + transport)
        ├─ tools/ (session, pipeline, monitoring, management)
        ├─ prompts.ts
        ├─ resources.ts
        └─ auth.ts (RBAC enforcement)
```

## Service lifecycle dependency graph

Issue #1622 introduces explicit service registration and dependency-driven startup/shutdown in `src/container.ts`.

```text
tmuxManager
stateStore
  └─ sessionManager
      ├─ channelManager
      └─ sessionMonitor
authManager
```

| Service | Depends on | Startup action | Shutdown action |
|---|---|---|---|
| `tmuxManager` | — | `tmux.ensureSession()` | no-op |
| `sessionManager` | `tmuxManager`, `stateStore` | `sessions.load()` | `sessions.save()` |
| `stateStore` | — | `store.start()` | `store.stop()` |
| `authManager` | — | `auth.load()` | no-op |
| `channelManager` | `sessionManager` | `channels.init(handleInbound)` | `channels.destroy()` |
| `sessionMonitor` | `tmuxManager`, `sessionManager`, `channelManager` | `monitor.start()` | `monitor.stop()` |

Startup follows topological order from the dependency graph. Graceful shutdown runs in the reverse order with per-service timeout protection.
