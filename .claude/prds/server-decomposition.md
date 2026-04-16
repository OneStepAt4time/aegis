---
name: server-decomposition
description: Decompose server.ts (2500 lines) into Fastify route plugins for maintainability and testability
status: completed
created: 2026-04-14T15:58:00Z
---

# PRD: Server Decomposition

## Problem
`src/server.ts` is ~2500 lines — a god object containing all route handlers, middleware, startup logic, and channel registration. This makes it:
- Impossible to test in isolation
- Hard to review (PRs touch too many lines)
- Difficult for multiple agents to work on concurrently

## Solution
Extract route handlers into Fastify plugins under `src/routes/`, each <200 lines. Target: `server.ts` becomes ~150 lines (registration only).

## Target Structure
1. `src/routes/sessions.ts` — session CRUD + send + transcript
2. `src/routes/pipelines.ts` — pipeline management
3. `src/routes/metrics.ts` — metrics/health/prometheus
4. `src/routes/hooks.ts` — webhook/hook event receiver
5. `src/routes/auth.ts` — auth verify + RBAC
6. `src/routes/channels.ts` — channel integration routes
7. `src/routes/memory.ts` — memory/context routes
8. `src/routes/config.ts` — configuration routes

## Constraints
- Zero API/behavior changes
- Each plugin <200 lines
- Each PR <500 lines
- Order: auth → hooks → channels → metrics → config → memory → pipelines → sessions
- All tests pass after each PR
- Worktree-only development

## Success Criteria
- server.ts <200 lines
- Each route module has integration tests
- Real coverage >60% for server.ts functions
- CI green after every PR

## Related Issues
- #1756 — parent issue
- #1697 — MCP decoupling (parallel track)
- #1698 — route middleware extraction (DONE)
