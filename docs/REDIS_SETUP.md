# Redis Setup Guide

> Issue #1948 — Redis-backed state for Aegis horizontal scaling.

This guide covers setting up Redis as the shared state store for multi-node Aegis deployments.

## Quick Start

```bash
# 1. Install Redis (or use a managed service)
# Debian/Ubuntu:
sudo apt install redis-server

# macOS:
brew install redis

# 2. Start Redis
redis-server

# 3. Configure Aegis
export AEGIS_STATE_STORE=redis
export AEGIS_REDIS_URL=redis://localhost:6379

# 4. Start Aegis
ag start
```

## Deployment Modes

### Standalone (single Redis instance)

Suitable for small deployments (2–5 Aegis nodes). Simplest to operate.

```bash
# /etc/redis/redis.conf
bind 0.0.0.0
port 6379
maxmemory 256mb
maxmemory-policy allkeys-lru
```

Connect Aegis:

```bash
AEGIS_REDIS_URL=redis://redis-host:6379
```

### Redis Sentinel (high availability)

Recommended for production. Sentinel provides automatic failover if the primary dies.

```ini
# sentinel.conf (on each Sentinel node)
sentinel monitor aegis redis-primary 6379 2
sentinel down-after-milliseconds aegis 5000
sentinel failover-timeout aegis 10000
sentinel parallel-syncs aegis 1
```

Connect Aegis via Sentinel:

```bash
AEGIS_REDIS_URL=sentinel://sentinel1:26379,sentinel2:26379,sentinel3:26379?name=aegis
```

> **Note:** Sentinel URL support requires an ioredis client (see below).

### Redis Cluster (sharded)

For large deployments with high throughput. Data is sharded across multiple nodes.

```bash
# Create a minimal 6-node cluster (3 primaries + 3 replicas)
redis-cli --cluster create \
  node1:6379 node2:6379 node3:6379 \
  node4:6379 node5:6379 node6:6379 \
  --cluster-replicas 1
```

Connect Aegis:

```bash
AEGIS_REDIS_URL=redis://node1:6379
```

> **Note:** Full cluster support with slot-aware routing requires ioredis. See the client section below.

## Redis Client

Aegis uses a thin Redis client abstraction (`RedisStateStore` accepts any client matching the interface). Two popular options:

### Option A: ioredis (recommended)

Full-featured: Sentinel, Cluster, pipeline, Lua scripts, automatic reconnect.

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import { RedisStateStore } from './services/state/RedisStateStore.js';

const client = new Redis('redis://localhost:6379');
const store = new RedisStateStore(client);
await store.start();
```

### Option B: @redis/client

Official Node.js client. Simpler API, no built-in Sentinel/Cluster support.

```bash
npm install redis
```

```typescript
import { createClient } from 'redis';
import { RedisStateStore } from './services/state/RedisStateStore.js';

const client = createClient({ url: 'redis://localhost:6379' });
const store = new RedisStateStore(client);
await store.start();
```

## Authentication

### Password authentication

```bash
AEGIS_REDIS_URL=redis://:your-password@redis-host:6379
```

### TLS (Redis 6+ with ACL)

```bash
AEGIS_REDIS_URL=rediss://redis-host:6380
```

### Redis ACL (Redis 6+)

```redis
# Create a dedicated user for Aegis
ACL SETUSER aegis on >strong-password ~aegis:* +@all -@dangerous
```

```bash
AEGIS_REDIS_URL=redis://aegis:strong-password@redis-host:6379
```

## Memory Sizing

Each Aegis session uses approximately 1–2 KB in Redis. Estimate:

| Sessions | Memory |
|----------|--------|
| 50 | ~100 KB |
| 500 | ~1 MB |
| 5,000 | ~10 MB |

Redis overhead (connections, fragmentation) adds 10–20 MB baseline. A 256 MB Redis instance handles thousands of sessions comfortably.

## Persistence

Aegis session state is ephemeral — it can be reconstructed from tmux if lost. However, for faster recovery after Redis restarts, enable RDB snapshots:

```redis
# /etc/redis/redis.conf
save 900 1
save 300 10
save 60 10000
```

For maximum durability, use AOF:

```redis
appendonly yes
appendfsync everysec
```

## Monitoring

### Health check endpoint

Aegis exposes store health at `/v1/health`:

```bash
curl -s http://localhost:9100/v1/health | jq .
```

The response includes `stateStore.healthy: true/false` when Redis is configured.

### Redis metrics

Monitor these Redis metrics for Aegis:

| Metric | Alert threshold |
|--------|----------------|
| `used_memory` | > 80% of maxmemory |
| `connected_clients` | > 80% of maxclients |
| `keyspace_hits / keyspace_misses` | miss rate > 10% |
| `instantaneous_ops_per_sec` | baseline + unexpected spike |

```bash
redis-cli info memory
redis-cli info clients
redis-cli info stats
```

## Troubleshooting

### "Redis ping failed" in health check

1. Check Redis is running: `redis-cli ping`
2. Check network connectivity from Aegis node: `nc -zv redis-host 6379`
3. Check authentication: `redis-cli -a your-password ping`
4. Check AEGIS_REDIS_URL is correct

### Sessions not appearing on other nodes

1. Confirm `AEGIS_STATE_STORE=redis` is set on **all** nodes
2. Confirm all nodes point to the **same** Redis instance
3. Check Redis keys: `redis-cli keys 'aegis:*'`
4. Check the sessions set: `redis-cli smembers aegis:sessions`

### High latency on session operations

1. Check Redis latency: `redis-cli --latency`
2. Check if Redis is swapping: `redis-cli info memory | grep used_memory`
3. Consider moving Redis closer to Aegis nodes (same datacenter/AZ)
4. Enable Redis pipeline for batch operations (future improvement)

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `AEGIS_STATE_STORE` | `file` | Backend: `file` (default) or `redis` |
| `AEGIS_REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `AEGIS_REDIS_KEY_PREFIX` | `aegis` | Prefix for all Redis keys |
