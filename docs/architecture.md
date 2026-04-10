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
├── tmux-capture-cache.ts     # Cached terminal capture to reduce tmux overhead
├── terminal-parser.ts        # Detect Claude Code UI state from terminal output
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
├── mcp-server.ts             # MCP server (stdio) — 25 tools, 4 resources, 3 prompts
├── tool-registry.ts          # MCP tool registration and dispatch
├── handshake.ts              # Client capability negotiation
│
├── pipeline.ts               # Batch session creation and multi-stage orchestration
├── consensus.ts              # Multi-agent consensus review (correctness, security, perf)
├── swarm-monitor.ts          # Parallel session swarm coordination
│
├── model-router.ts           # Tiered model routing (fast, standard, power)
├── template-store.ts         # Reusable session templates with variable substitution
├── continuation-pointer.ts   # Resume sessions from checkpointed state
├── question-manager.ts       # Pending user question lifecycle management
│
├── monitor.ts                # Session state monitoring — stall detection, events
├── events.ts                 # SSE event types (session + global)
├── sse-writer.ts             # SSE response streaming
├── sse-limiter.ts            # SSE rate limiting per client
├── ws-terminal.ts            # WebSocket terminal relay
│
├── permission-guard.ts       # Permission request interception and routing
├── services/
│   ├── auth/
│   │   ├── AuthManager.ts    # API key management and bearer token classification
│   │   ├── RateLimiter.ts    # Route-level IP and auth-failure rate limiting
│   │   ├── types.ts          # Auth manager and API key types
│   │   └── index.ts          # Auth service exports
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
└── client/                    # Official TypeScript client SDK (published to npm)
    └── src/
        ├── AegisClient.ts     # HTTP API client class
        ├── types.ts           # All API contract types (SessionInfo, UIState, etc.)
        └── index.ts           # Public package exports

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
```

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
| `tmux-capture-cache.ts` | Caches terminal captures to reduce tmux invocations |
| `terminal-parser.ts` | Detects Claude Code's UI state (working, idle, permission prompt, etc.) from terminal text |
| `transcript.ts` | Parses Claude Code's JSONL output into structured entries with token usage |
| `jsonl-watcher.ts` | Watches JSONL files for new entries in real time |

### 3. Agent Integration (MCP)

| Module | Purpose |
|---|---|
| `mcp-server.ts` | MCP stdio server — exposes 25 tools, 4 resources, 3 prompts to Claude Code and other MCP hosts |
| `tool-registry.ts` | Registers and dispatches MCP tool calls |
| `handshake.ts` | Client capability negotiation on connection |

### 4. Orchestration

| Module | Purpose |
|---|---|
| `pipeline.ts` | Batch session creation and multi-stage orchestration (sequential or parallel stages) |
| `consensus.ts` | Multi-agent consensus review — routes requests to evaluate correctness, security, or performance |
| `swarm-monitor.ts` | Coordinates parallel session swarms with status aggregation |

### 5. Intelligence & Templates

| Module | Purpose |
|---|---|
| `model-router.ts` | Routes tasks to model tiers: `fast`, `standard`, `power` |
| `template-store.ts` | Reusable session templates with variable substitution (PRD, environment, prompts) |
| `continuation-pointer.ts` | Checkpoints and resumes sessions from saved state |
| `question-manager.ts` | Manages pending user questions with TTL and lifecycle |

### 6. Monitoring & Events

| Module | Purpose |
|---|---|
| `monitor.ts` | Session state monitor — detects stalls, tracks status transitions |
| `events.ts` | Defines SSE event types for session and global events |
| `sse-writer.ts` | Streams SSE events to HTTP clients |
| `sse-limiter.ts` | Rate-limits SSE connections per client |
| `ws-terminal.ts` | Relays terminal output over WebSocket |

### 7. Permissions

| Module | Purpose |
|---|---|
| `permission-guard.ts` | Intercepts permission requests and routes to evaluator |
| `services/permission/evaluator.ts` | Evaluates permission requests against profiles |
| `permission-request-manager.ts` | Queues and tracks pending permission requests |
| `permission-routes.ts` | REST endpoints: approve, reject, list pending permissions |

### 8. Memory & Metrics

| Module | Purpose |
|---|---|
| `memory-bridge.ts` | Scoped memory API — attach notes and context to sessions |
| `memory-routes.ts` | REST endpoints for memory CRUD (`/v1/memory/*`) |
| `metrics.ts` | Token usage tracking, cost estimation, and session statistics |
| `screenshot.ts` | Captures URL screenshots via Playwright |

### 9. Hooks

| Module | Purpose |
|---|---|
| `hooks.ts` | Fastify plugin that registers hook routes |
| `hook.ts` | Builds hook commands for pre/post session lifecycle events |
| `hook-settings.ts` | Parses and validates hook configuration |

### 10. Shared Utilities

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
| `logger.ts` | Structured logging |
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
  │     ├─ terminal-parser.ts (UI state detection)
  │     ├─ transcript.ts (JSONL parsing)
  │     └─ permission-guard.ts (approval flow)
  │
  ├─ pipeline.ts (batch orchestration)
  │     ├─ consensus.ts (multi-agent review)
  │     └─ swarm-monitor.ts (parallel coordination)
  │
  ├─ monitor.ts (state tracking + events)
  │     └─ events.ts → sse-writer.ts (SSE streaming)
  │
  └─ mcp-server.ts (MCP protocol, stdio)
        └─ tool-registry.ts (tool dispatch)
```

## Service lifecycle dependency graph

Issue #1622 introduces explicit service registration and dependency-driven startup/shutdown in `src/container.ts`.

```text
tmuxManager
  └─ sessionManager
      ├─ channelManager
      └─ sessionMonitor
authManager
```

| Service | Depends on | Startup action | Shutdown action |
|---|---|---|---|
| `tmuxManager` | — | `tmux.ensureSession()` | no-op |
| `sessionManager` | `tmuxManager` | `sessions.load()` | `sessions.save()` |
| `authManager` | — | `auth.load()` | no-op |
| `channelManager` | `sessionManager` | `channels.init(handleInbound)` | `channels.destroy()` |
| `sessionMonitor` | `tmuxManager`, `sessionManager`, `channelManager` | `monitor.start()` | `monitor.stop()` |

Startup follows topological order from the dependency graph. Graceful shutdown runs in the reverse order with per-service timeout protection.
