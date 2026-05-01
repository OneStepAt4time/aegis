# @onestepat4time/aegis-client

Official TypeScript client for [Aegis](https://github.com/OneStepAt4time/aegis) — generated from the OpenAPI 3.1 specification.

Covers all 53 REST endpoints with full TypeScript type safety.

## Install

```bash
npm install @onestepat4time/aegis-client
```

## Quick Start

### Class-based API (backward compatible)

```typescript
import { AegisClient } from '@onestepat4time/aegis-client';

const client = new AegisClient('http://localhost:9100', 'your-token');

// List all sessions
const sessions = await client.listSessions();

// Create a new session
const { id } = await client.createSession({
  workDir: '/path/to/project',
  name: 'my-session',
});

// Send a message
await client.sendMessage(id, 'Implement feature X');

// Get session metrics
const metrics = await client.getSessionMetrics(id);
```

### Function-based API (recommended for new code)

```typescript
import {
  createConfig,
  listSessions,
  createSession,
  sendMessage,
} from '@onestepat4time/aegis-client';

// Configure once
createConfig({
  baseUrl: 'http://localhost:9100',
  auth: 'your-token',
});

// Use SDK functions directly
const { data } = await listSessions();
const created = await createSession({ body: { workDir: '/path/to/project' } });
await sendMessage({ path: { id: created.id }, body: { text: 'Hello!' } });
```

## Regenerating

When `openapi.yaml` changes at the repo root:

```bash
cd packages/client
npm run generate
npm run build
```

Before opening a PR, verify the checked-in generated client matches the root
OpenAPI contract:

```bash
npm run sdk:ts:check
```

## Versioning

| Version | Notes |
|---------|-------|
| `0.4.x` | OpenAPI-generated SDK (this version) |
| `0.3.x` | Hand-written client (deprecated) |

The class-based `AegisClient` API is backward compatible with v0.3.x. The function-based SDK is the recommended approach for new code.

## License

MIT
