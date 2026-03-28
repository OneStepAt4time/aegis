# Issue #350: server.ts God Object Refactoring — Design Spec

**Date:** 2026-03-28
**Status:** Approved

## Problem

`server.ts` is 1684 lines with 55+ route registrations, mixing:
- Route handlers (session CRUD, auth, SSE, pipelines, misc)
- Middleware (auth, IP rate limiting, security headers)
- Background processes (session reaper, zombie reaper)
- Infrastructure (PID file, port recovery, graceful shutdown)
- 14 duplicated unversioned route registrations
- 7 `console.time/timeEnd` calls in production code
- 2 `as any` casts for channel method access

No test imports server.ts directly, making this safe to restructure.

## Solution

Extract into focused modules using Fastify's native plugin pattern (already used by `registerHookRoutes` and `registerWsTerminalRoute`). Introduce a `versionedRoute` decorator to eliminate route duplication.

## Target Structure

```
src/
  server.ts                  → createServer(config) factory + main(), ~200 lines
  routes/
    sessions.ts              → registerSessionRoutes(app, deps)
    auth.ts                  → registerAuthRoutes(app, deps)
    sse.ts                   → registerSSERoutes(app, deps)
    pipelines.ts             → registerPipelineRoutes(app, deps)
    misc.ts                  → registerMiscRoutes(app, deps)
  middleware/
    auth.ts                  → registerAuthMiddleware(app, authManager)
    security.ts              → registerSecurityHeaders(app)
    versioned.ts             → versionedRoute Fastify decorator plugin
  reaper.ts                  → reapStaleSessions(), reapZombieSessions()
  startup.ts                 → PID file, port recovery, graceful shutdown
```

## Shared Dependencies

```typescript
interface ServerDeps {
  sessions: SessionManager;
  tmux: TmuxManager;
  channels: ChannelManager;
  monitor: SessionMonitor;
  eventBus: SessionEventBus;
  sseLimiter: SSEConnectionLimiter;
  pipelines: PipelineManager;
  auth: AuthManager;
  metrics: MetricsCollector;
  swarmMonitor: SwarmMonitor;
  config: Config;
}
```

All route modules and reaper functions receive a typed `ServerDeps` object instead of accessing module-level globals.

## Module Details

### middleware/versioned.ts

Fastify plugin that decorates the instance with `versionedGet`, `versionedPost`, `versionedDelete` methods. Each registers both `/v1${path}` and `${path}` (unversioned), eliminating all 14 duplicated registrations.

```typescript
// Usage:
app.versionedGet('/sessions/:id', async (req, reply) => { ... });
// Registers: GET /v1/sessions/:id AND GET /sessions/:id
```

Routes that exist only under `/v1` (health, swarm, metrics, batch, pipelines) use regular `app.get/post` directly.

### middleware/auth.ts (~100 lines)

Extracts the `setupAuth()` function + IP rate limiting into a Fastify plugin:
- `ipRateLimits` Map + `checkIpRateLimit()` + `pruneIpRateLimits()`
- `onRequest` hook for token validation (Bearer, SSE token, API key)
- Per-IP rate limiting with configurable normal/master thresholds
- Exact-path auth skip list (health, dashboard, hooks, terminal)

### middleware/security.ts (~20 lines)

Extracts the `onSend` security headers hook:
- X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- Skips SSE responses (text/event-stream)
- `DASHBOARD_CSP` constant

### routes/sessions.ts (~350 lines)

Largest extraction. All session CRUD routes using `versionedRoute`:

| Method | Path | Notes |
|--------|------|-------|
| GET | /sessions | List with pagination + status filter |
| POST | /sessions | Create session |
| GET | /sessions/:id | Get session with actionHints |
| DELETE | /sessions/:id | Kill session |
| GET | /sessions/:id/health | Session health check |
| GET | /sessions/health | Bulk health (v1 only) |
| POST | /sessions/:id/send | Send message |
| GET | /sessions/:id/read | Read messages |
| POST | /sessions/:id/approve | Approve permission |
| POST | /sessions/:id/reject | Reject permission |
| POST | /sessions/:id/answer | Answer AskUserQuestion |
| POST | /sessions/:id/escape | Send Escape |
| POST | /sessions/:id/interrupt | Send Ctrl+C |
| GET | /sessions/:id/pane | Capture raw pane |
| POST | /sessions/:id/command | Slash command |
| POST | /sessions/:id/bash | Bash mode |
| GET | /sessions/:id/summary | Session summary |
| GET | /sessions/:id/transcript | Paginated transcript (v1 only) |
| POST | /sessions/:id/screenshot | Screenshot capture |
| GET | /sessions/:id/metrics | Per-session metrics (v1 only) |
| GET | /sessions/:id/latency | Latency metrics (v1 only) |
| POST | /sessions/:id/hooks/permission | Permission hook |
| POST | /sessions/:id/hooks/stop | Stop hook |

Includes helpers: `validateWorkDir()`, `addActionHints()`, `makePayload()`.

### routes/auth.ts (~50 lines)

| Method | Path |
|--------|------|
| POST | /v1/auth/keys |
| GET | /v1/auth/keys |
| DELETE | /v1/auth/keys/:id |
| POST | /v1/auth/sse-token |

### routes/sse.ts (~120 lines)

| Method | Path |
|--------|------|
| GET | /v1/events | Global SSE stream |
| GET | /v1/sessions/:id/events | Per-session SSE stream |

### routes/pipelines.ts (~50 lines)

| Method | Path |
|--------|------|
| POST | /v1/pipelines |
| GET | /v1/pipelines/:id |
| GET | /v1/pipelines |
| POST | /v1/sessions/batch | (Moved here from sessions) |

### routes/misc.ts (~60 lines)

| Method | Path |
|--------|------|
| GET | /v1/health + /health | Health check |
| GET | /v1/swarm | Swarm awareness |
| GET | /v1/metrics | Global metrics |
| GET | /v1/webhooks/dead-letter | Dead letter queue |
| GET | /v1/channels/health | Channel health |

### reaper.ts (~70 lines)

Pure functions receiving deps:
- `reapStaleSessions(deps, maxAgeMs)` — kills sessions exceeding age limit
- `reapZombieSessions(deps, reapDelayMs)` — kills zombie sessions
- Exports `ZOMBIE_REAP_DELAY_MS`, `ZOMBIE_REAP_INTERVAL_MS` constants

### startup.ts (~200 lines)

- `writePidFile(stateDir)` / `readPidFile(stateDir)` — PID file management
- `pidExists(pid)` / `isAncestorPid(pid)` — process checks
- `waitForPortRelease(port, maxWaitMs)` — port availability polling
- `killStalePortHolder(port)` — stale process cleanup with SIGTERM/SIGKILL
- `listenWithRetry(app, port, host, maxRetries)` — EADDRINUSE recovery
- `createGracefulShutdown(app, deps, intervals)` — shutdown handler factory

### server.ts (~200 lines)

```typescript
export async function createServer(config: Config): Promise<FastifyInstance> {
  const app = Fastify({ bodyLimit: 1048576, logger: { ... } });

  // Initialize deps
  const deps: ServerDeps = { ... };

  // Register middleware
  await app.register(registerVersionedRoute);
  await app.register(registerSecurityHeaders);
  registerAuthMiddleware(app, deps.auth);

  // Register routes
  registerSessionRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerSSERoutes(app, deps);
  registerPipelineRoutes(app, deps);
  registerMiscRoutes(app, deps);
  registerHookRoutes(app, deps);
  registerWsTerminalRoute(app, deps.sessions, deps.tmux, deps.auth);

  // Register plugins
  await app.register(fastifyWebsocket);
  await app.register(fastifyCors, { ... });

  return app;
}
```

## Cleanup Items

### Remove console.time/timeEnd

Replace the 7 `console.time`/`console.timeEnd` calls in POST /sessions with either:
- `performance.now()` timing logged via structured logging, or
- Simply remove them (they were debug instrumentation, not production metrics)

Decision: **Remove entirely.** The metrics system already tracks session creation timing.

### Fix `as any` casts

Replace with proper type narrowing:

```typescript
// Before
return (ch as any).getDeadLetterQueue();

// After
if (ch instanceof WebhookChannel) {
  return ch.getDeadLetterQueue();
}
```

```typescript
// Before
const health = (ch as any).getHealth?.();

// After
const health = ch instanceof WebhookChannel ? ch.getHealth?.() : undefined;
```

This requires importing `WebhookChannel` in the routes/misc module. If `getHealth` is used by other channel types, a `HealthProvider` interface should be defined and implemented.

## Testing Strategy

- No new test files needed — existing 1414 tests pass via route mocking
- `auth-bypass-349.test.ts` and `zombie-reaper.test.ts` can be updated to import from the new modules instead of duplicating logic
- All 62 test files must continue passing after each extraction step

## Execution Order

1. Create `middleware/versioned.ts` — the versionedRoute plugin
2. Extract `middleware/security.ts` — simplest, no dependencies
3. Extract `middleware/auth.ts` — auth + IP rate limiting
4. Extract `routes/misc.ts` — health, swarm, metrics, channels
5. Extract `routes/auth.ts` — key management routes
6. Extract `routes/sse.ts` — SSE streams
7. Extract `routes/pipelines.ts` — pipeline + batch routes
8. Extract `routes/sessions.ts` — largest, session CRUD + helpers
9. Extract `reaper.ts` — reaper functions
10. Extract `startup.ts` — PID file, port recovery, shutdown
11. Refactor `server.ts` — createServer factory + main()
12. Clean up — remove console.time/timeEnd, fix as any casts
13. Final verification — all 1414 tests pass, type-check clean
