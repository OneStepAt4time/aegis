# Memory Bridge Design

**Date:** 2026-04-03
**Issue:** #783
**Status:** Approved

## Overview

A cross-session key-value memory store for Aegis. Sessions can read/write persistent memory entries via REST API, and new sessions can auto-inject resolved memory values into their initial prompt.

## Data Model

```typescript
interface MemoryEntry {
  value: string;
  namespace: string;      // parsed from key "ns/key" → ns
  key: string;            // full key "ns/key"
  created_at: number;     // epoch ms
  updated_at: number;     // epoch ms
  expires_at?: number;    // epoch ms, undefined = no expiry
}
```

Key format: `namespace/key` (e.g. `session/abc123/context`, `user/preferences`). The first `/` separates namespace from key name.

Validation rules:
- Key must contain exactly one `/` separator (no nested paths)
- Namespace and key name must be non-empty
- No `..` segments
- Max key length: 256 chars
- Max value size: 100KB

## Architecture

Standalone `MemoryBridge` class, following the pattern of `AuthManager` and `MetricsCollector`.

### MemoryBridge Class (`src/memory-bridge.ts`)

```typescript
class MemoryBridge {
  private store: Map<string, MemoryEntry>;
  private persistPath: string | null;
  private reaperTimer: NodeJS.Timeout | null;

  constructor(persistPath: string | null, reaperIntervalMs?: number)
  set(key: string, value: string, ttlSeconds?: number): MemoryEntry
  get(key: string): MemoryEntry | null
  delete(key: string): boolean
  list(prefix?: string): MemoryEntry[]
  load(): Promise<void>
  save(): Promise<void>
  startReaper(): void
  stopReaper(): void
  resolveKeys(keys: string[]): Map<string, string>
}
```

### Storage

- In-memory: `Map<string, MemoryEntry>` keyed by full key string
- Persistence: JSON file at `{stateDir}/memory.json` using atomic write (write `.tmp` then `rename`)
- Save is debounced (1s) to batch rapid writes

### TTL & Expiry

- Lazy eviction: `get()` deletes and returns null for expired entries
- Active reaper: configurable interval (default 60s) purges all expired entries
- `ttlSeconds` param on `set()` computes `expires_at = Date.now() + ttlSeconds * 1000`

## REST API

Registered via `registerMemoryRoutes(app, bridge)`:

| Method | Path | Body/Params | Response |
|--------|------|-------------|----------|
| POST   | `/v1/memory` | `{ key, value, ttl? }` | `{ ok: true, entry }` |
| GET    | `/v1/memory/:key` | URL-encoded key in path | `{ entry }` or 404 |
| GET    | `/v1/memory` | `?prefix=ns/` query param | `{ entries: [...] }` |
| DELETE | `/v1/memory/:key` | URL-encoded key in path | `{ ok: true }` or 404 |

The `:key` path parameter must be URL-encoded (e.g. `session%2Fabc123%2Fcontext`).

### Error Responses

| Condition | Status | Body |
|-----------|--------|------|
| Feature disabled | 501 | `{ error: "Memory bridge is not enabled" }` |
| Invalid key format | 400 | `{ error: "...", details?: [...] }` |
| Key not found | 404 | `{ error: "Key not found: ..." }` |
| Value too large (>100KB) | 413 | `{ error: "Value exceeds maximum size" }` |

## Session Injection

When `POST /v1/sessions` includes `memoryKeys: string[]`:

1. `SessionManager` calls `memoryBridge.resolveKeys(memoryKeys)`
2. If any values found, prepend formatted block to prompt:
   ```
   [Memory context]
   ns/key1: value1
   ns/key2: value2

   <original prompt>
   ```
3. If no values resolved, send prompt unchanged
4. Missing keys are silently skipped (no error)

## Configuration

New config section:

```typescript
memory: {
  enabled: false,              // opt-in, backward compatible
  persistFile: 'memory.json',  // filename in stateDir, null to disable
  reaperIntervalMs: 60000,     // expired entry cleanup interval
}
```

Environment variable overrides:
- `AEGIS_MEMORY_ENABLED` → `memory.enabled`
- `AEGIS_MEMORY_PERSIST_FILE` → `memory.persistFile`
- `AEGIS_MEMORY_REAPER_INTERVAL_MS` → `memory.reaperIntervalMs`

## Integration Points

| File | Changes |
|------|---------|
| `src/memory-bridge.ts` | New file — MemoryBridge class + route registration |
| `src/config.ts` | Add `memory` config section with defaults + env overrides |
| `src/server.ts` | Create MemoryBridge if enabled, register routes, pass to SessionManager |
| `src/session.ts` | Accept optional MemoryBridge, use in `sendInitialPrompt()` |
| `src/validation.ts` | Add Zod schemas for memory API requests |
| `src/__tests__/memory-bridge.test.ts` | Tests for core operations, TTL, persistence, API |

## Test Plan

Tests in `src/__tests__/memory-bridge.test.ts`:

1. **Core operations:** set, get, delete, list with prefix filtering
2. **TTL expiry:** entries expire correctly, lazy eviction, reaper cleanup
3. **Persistence:** save to JSON file, load from JSON file, atomic write
4. **Key validation:** reject invalid formats, accept valid ones
5. **resolveKeys:** returns map of found keys, skips missing/expired
6. **Injection formatting:** correct prepend format, no-op when empty
7. **API routes:** POST/GET/DELETE with valid/invalid inputs
8. **Edge cases:** empty store, overwrite existing key, TTL=0

## Backward Compatibility

- Feature is disabled by default (`memory.enabled: false`)
- No changes to existing API behavior when disabled
- Memory routes return 501 when disabled
- No new required dependencies
