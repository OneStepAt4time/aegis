# Horizontal Scaling Architecture

> Issue #1948 — Scale Aegis horizontally behind a load balancer with Redis-backed state.

## Overview

Aegis is designed as a single-node application by default. All session state lives in memory and is persisted to a local JSON file (`~/.aegis/state.json`). For horizontal scaling — running multiple Aegis instances behind a load balancer — you need a shared state store so any node can serve any request.

This document describes the architecture for Redis-backed state, sticky routing, and the constraints imposed by tmux.

## Architecture

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │  (sticky route) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
       ┌──────┴──────┐ ┌────┴─────┐ ┌──────┴──────┐
       │  Aegis Node │ │ Aegis    │ │  Aegis Node │
       │  (tmux + CC)│ │ Node     │ │  (tmux + CC)│
       └──────┬──────┘ └────┬─────┘ └──────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────┴────────┐
                    │     Redis       │
                    │  (state store)  │
                    └─────────────────┘
```

### Key principle: tmux-socket affinity

Each Aegis node owns the tmux sessions running on that host. A session created on Node A has its Claude Code process running in Node A's tmux server. **You cannot move a running CC session between nodes.** This means the load balancer must route requests for a specific session to the node that owns it — this is called **sticky routing** or **session affinity**.

## State Store Interface

All session persistence goes through the `StateStore` interface (`src/services/state/state-store.ts`):

```typescript
interface StateStore {
  load(): Promise<SerializedSessionState>;
  save(state: SerializedSessionState): Promise<void>;
  getSession(id: string): Promise<SerializedSessionInfo | undefined>;
  putSession(id: string, session: SerializedSessionInfo): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listSessionIds(): Promise<string[]>;
  health(): Promise<ServiceHealth>;
}
```

Two implementations:

| Backend | Class | Key | When to use |
|---------|-------|-----|-------------|
| Local file | *(built into SessionManager)* | `state.json` | Single node (default) |
| Redis | `RedisStateStore` | `aegis:session:<id>` | Multi-node (opt-in) |

## Redis Data Model

Each session is stored as a Redis hash with a single field `data` containing the serialized JSON:

```
aegis:session:<session-id>  →  { "data": "<JSON>" }
```

A Redis set tracks all known session IDs:

```
aegis:sessions  →  { "uuid-1", "uuid-2", ... }
```

This design allows:
- **Per-session reads** without deserialising the entire state
- **Atomic single-session writes** (offset updates don't rewrite everything)
- **Fast session listing** via `SMEMBERS`

## Enabling Redis State

Set the environment variable:

```bash
AEGIS_STATE_STORE=redis
AEGIS_REDIS_URL=redis://redis.internal:6379
```

Additional configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_STATE_STORE` | `file` | Set to `redis` to enable Redis backend |
| `AEGIS_REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `AEGIS_REDIS_KEY_PREFIX` | `aegis` | Namespace prefix for all Redis keys |

## Sticky Routing

Since tmux sessions are local to a node, the load balancer must route requests for a specific session to the owning node. There are several strategies:

### Strategy 1: HTTP header (recommended)

Each Aegis node advertises its node ID. The load balancer reads the session ID from the URL path (`/v1/sessions/:id/...`) and looks up the owning node from a shared Redis field.

Add a custom HTTP header to each response:

```
X-Aegis-Node: node-3
```

The load balancer stores a mapping: `session-id → node-id` in Redis (`aegis:node:<session-id>`).

### Strategy 2: Cookie-based affinity

Use a load balancer (HAProxy, nginx, AWS ALB) that supports cookie-based sticky sessions:

```nginx
# nginx example
upstream aegis {
    ip_hash;  # or hash $arg_sessionId consistent;
    server aegis-1:9100;
    server aegis-2:9100;
    server aegis-3:9100;
}
```

### Strategy 3: DNS-based node discovery

Each Aegis node registers its hostname in Redis (`aegis:node-registry`). The client or a gateway resolves the node for a given session and proxies accordingly.

## Concurrency and Consistency

- **Writes are serialised.** `SessionManager` uses a save queue (promise chain) to prevent concurrent writes.
- **Redis MULTI/EXEC** can be used for atomic multi-key operations in future.
- **No distributed locking yet.** For Phase 4, consider `SET NX EX` for distributed locks if multiple nodes write to overlapping sessions.

## Failover and Recovery

When an Aegis node crashes:

1. Its tmux sessions die with it (tmux windows are local).
2. The session state remains in Redis.
3. Another node detects the dead sessions (via the reaper or health checks) and marks them.
4. Clients should handle 404/session-not-found and create new sessions on healthy nodes.

## What Does NOT Move to Redis

These remain local to each node:

- **tmux sessions** — cannot be shared across hosts
- **JSONL transcripts** — local files written by Claude Code
- **Hook settings temp files** — local filesystem
- **Permission guard patched files** — local filesystem
- **Process PIDs** (`ccPid`) — only meaningful on the local node

## Chaos Testing

The acceptance criteria include a chaos test: session state should survive random pod restarts when state is in Redis.

Test scenario:

1. Start 3 Aegis nodes behind a load balancer, all pointing to the same Redis.
2. Create sessions on each node.
3. Randomly kill and restart nodes.
4. Verify that:
   - Sessions from dead nodes are marked as dead
   - Sessions on surviving nodes remain operational
   - Redis state is consistent with actual tmux state after reconciliation

## Limitations (Phase 4 Preview)

This is an **opt-in** feature. Single-node mode remains the default and is fully supported. The Redis backend is invisible to users who don't enable it.

Current limitations:
- No automatic session migration between nodes
- No distributed lock for session creation (mutex is per-process)
- No Redis Cluster support in this iteration (single instance or Sentinel only)
- No Redis-based pub/sub for cross-node event propagation (events are local)

These will be addressed in subsequent iterations as demand requires.
