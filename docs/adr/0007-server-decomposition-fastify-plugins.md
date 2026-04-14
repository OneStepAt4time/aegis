# ADR-0007: Server Decomposition into Fastify Plugins

Status: Accepted
Date: 2026-04-13
Issue: #1756

## Context

`server.ts` has grown to ~2500 lines, making it difficult to:
- Navigate and understand the codebase
- Test individual route handlers in isolation
- Review PRs that touch multiple unrelated routes
- Onboard new contributors

The server handles authentication, session management, pipeline orchestration, alerting, memory bridge, MCP integration, and more — all in one file.

## Decision

Decompose `server.ts` into Fastify plugins using the [8-plugin architecture plan](./docs/architecture.md#server-decomposition):

```
src/server.ts          → ~50 lines (plugin registration only)
src/routes/sessions.ts → session CRUD + send/answer
src/routes/pipelines.ts → pipeline management
src/routes/memory.ts   → memory bridge endpoints
src/routes/alerting.ts → alert management
src/routes/auth.ts     → authentication + API keys
src/plugins/audit.ts   → audit logging plugin
src/plugins/sse.ts     → SSE connection management
```

### Constraints

- **Zero API/behavior changes** — all endpoint signatures must remain identical
- **Each plugin <200 lines** — enforce single responsibility
- **PRs <500 lines** — decompose incrementally
- **server.ts target <200 lines** — after decomposition
- **Backward compatible** — existing clients continue to work without changes

### Migration Strategy

1. Create new plugin files alongside `server.ts`
2. Move route handlers one plugin at a time
3. Register plugins in `server.ts` — no logic changes
4. Remove inline route handlers after migration
5. Delete `server.ts` when empty

## Consequences

Pros:
- Smaller, focused files are easier to understand and test
- Parallel development — different plugins can be owned by different agents
- Faster CI — plugins can be tested in isolation
- Better onboarding — new contributors read one plugin at a time

Cons:
- Risk of breaking API contracts during migration
- Requires discipline to keep plugins small
- Cross-plugin dependencies must be managed carefully

## Enforcement

- New routes go into appropriate plugin files — not `server.ts`
- Plugin files must stay under 200 lines
- PRs exceeding 500 lines should be split
- API signatures require review sign-off from Argus
