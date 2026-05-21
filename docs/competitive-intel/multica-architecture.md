# Multica Architecture Analysis

> Generated 2026-05-22 by Hermes. Source: Multica v0.3.5 source code.

## 1. Server Architecture

### Overview
Go monolith + TypeScript/React frontend (Next.js/Electron). Classic layered: **HTTP Router → Middleware → Handler → Service → Storage (Postgres + Redis)**.

### Entry Point
`server/cmd/server/main.go`:
1. Connects PostgreSQL (`DATABASE_URL`)
2. In-process event bus (`events.New()`)
3. Realtime WebSocket hub for browser clients
4. Daemon WebSocket hub for agent daemons
5. Optional Redis for multi-node fanout, caching, rate limiting
6. Background workers: runtime sweeper, heartbeat scheduler, autopilot scheduler, autopilot failure monitor, DB stats logger
7. HTTP server on PORT (default 8080)
8. Graceful shutdown (drain HTTP → stop scheduler → stop metrics)

### Router
Chi router with middleware stack:
- **Global**: RequestID → ClientMetadata → RequestLogger → HTTPMetrics → Recoverer → CSP → CORS → Auth (per group)
- **Route groups**:
  - `/health`, `/readyz` — unauthenticated
  - `/ws` — browser WebSocket (JWT/PAT/cookie auth)
  - `/auth/*` — public, rate-limited
  - `/api/webhooks/*` — public webhook ingress (token-authenticated)
  - `/api/daemon/*` — daemon API (`DaemonAuth` middleware)
  - `/api/*` — authenticated user API (Auth + workspace membership)

### Handler Layer
~70 handler files (one per domain). Central `Handler` struct holds all dependencies. Uses sqlc-generated queries.

### Service Layer
- **TaskService** — Task lifecycle: enqueue, claim, start, complete, fail, cancel, auto-retry
- **AutopilotService** — Scheduled automation with cron/webhook triggers
- **EmailService** — Via Resend or SMTP
- **AgentReadiness** — Shared readiness gate for autopilot, squad leader, issue assignment

### Storage
- PostgreSQL via pgxpool with sqlc-generated queries (~30 query files)
- Redis (optional) — caching, rate limiting, realtime relay, liveness stores
- S3 / Local file storage for attachments

### Event System
In-process synchronous pub/sub. ~60 event types. Listeners registered in main.go.

## 2. Agent Lifecycle

### Registration
Agents are workspace-scoped entities. Created via `POST /api/agents`. Fields: name, description, instructions, runtime_mode, runtime_id, custom_env, custom_args, mcp_config, model, thinking_level, max_concurrent_tasks, visibility, owner_id, linked skills.

### Runtime Binding
Runtime = physical execution environment registered by daemon (`POST /api/daemon/register`). Fields: provider (claude, codex, gemini, etc.), status (online/offline/starting), last_seen_at. Runtime sweeper marks runtimes offline after grace period.

### Execution Backend
Unified `Backend` interface for spawning coding agents. Supports 11 types: claude, codex, copilot, opencode, openclaw, hermes, gemini, pi, cursor, kimi, kiro. Each wraps the CLI binary and streams events through Go channels.

### Task Lifecycle (Core Loop)
1. **Enqueue** — via issue assignment, @mention, squad leader, chat, quick create. Status: → queued
2. **Claim** — Daemon polls. Checks concurrency limits, claims highest-priority task. Empty-claim Redis cache. Status: queued → dispatched
3. **Start** — Status: dispatched → running
4. **Complete/Fail/Cancel** — Auto-creates agent comment, reconciles status, broadcasts events. Status: running → completed | failed | cancelled
5. **Auto-Retry** — Creates child task for retryable failures (runtime_offline, timeout, codex_semantic_inactivity)
6. **Progress Streaming** — Daemon sends task:message events → WebSocket broadcast

## 3. Squads

### Data Model
Squads table: id, workspace_id, name, description, leader_agent_id, strategy (round_robin | least_busy | manual), status. Members via squad_members join table.

### Leader Dispatch
When issue assigned to squad: leader agent receives briefing with all member capabilities, evaluates which member should handle it, returns member ID. Server creates task for chosen member.

### Strategy
- **round_robin** — cycle through members
- **least_busy** — pick member with fewest active tasks
- **manual** — leader decides every time

## 4. Skills System

### Storage
Skills table: id, workspace_id, name, description, content (SKILL.md body), config (JSONB). Skill files table for multi-file skills.

### Lifecycle
1. Created manually or auto-created from agent task output
2. Assigned to agents via agent_skills join table
3. Skills injected into agent prompt at execution time
4. Importable from URLs (ClawHub, skills.sh, GitHub)

## 5. Auth Model

### Methods
- Magic Link (Email OTP): 6-digit code, 10-min expiry, 60s cooldown
- Google OAuth: authorization code flow
- JWT: HS256, configurable TTL (default 30 days)
- PATs: `mul_` prefix, SHA-256 hashed at rest, expirable
- Daemon Tokens: `mdt_` prefix, SHA-256 hashed at rest

### Properties
- CSRF protection: HMAC double-submit cookie
- Constant-time comparison
- HttpOnly + Secure + SameSite=Strict cookies
- PAT cache with TTL clamped to expiry

## 6. Real-time / WebSocket

### Browser WebSocket Hub
Redis Streams-based sharded relay for multi-node deployment. Three modes: sharded (default), dual, legacy.

### Daemon WebSocket Hub
Persistent connections from daemon processes. Task wakeup via `daemon:task_available` frames.

### Runtime Liveness
Heartbeat tracking + Redis-backed liveness store. Dead runtime detection via sweeper goroutine.

## 7. Autopilots

### Data Model
Autopilots table: id, workspace_id, title, description, agent_id, mode (create_issue | run_only). Triggers: cron schedule or webhook.

### Execution
Autopilot scheduler runs every minute. Dispatches runs, creates issues or direct tasks. Failure monitor auto-retries.
