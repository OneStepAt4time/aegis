---
name: server-decomposition
status: in-progress
created: 2026-04-14T15:58:00Z
updated: 2026-04-14T16:35:00Z
progress: 0%
prd: .claude/prds/server-decomposition.md
github: https://github.com/OneStepAt4time/aegis/issues/1756
---

# Epic: Server Decomposition

Break server.ts (~2500 lines) into 8 Fastify route plugins.

## Tasks
1. Extract auth routes → src/routes/auth.ts
2. Extract hook routes → src/routes/hooks.ts
3. Extract channel routes → src/routes/channels.ts
4. Extract metrics routes → src/routes/metrics.ts
5. Extract config routes → src/routes/config.ts
6. Extract memory routes → src/routes/memory.ts
7. Extract pipeline routes → src/routes/pipelines.ts
8. Extract session routes → src/routes/sessions.ts (largest, last)

## Pre-requisite: DONE
- #1698 route middleware extraction (PR #1774 merged)
