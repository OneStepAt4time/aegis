# CONTEXT.md — Aegis Architectural Decisions

_Source of truth for all architectural decisions. Read before touching any code._

---

## What is Aegis?

An HTTP bridge that manages interactive Claude Code sessions via the ACP (Agent Control Protocol) runtime. It lets AI orchestrators programmatically create, monitor, refine, and control coding sessions.

## Stack

| Layer | Tech | Note |
|-------|------|------|
| Runtime | Node.js 22+ | TypeScript strict |
| HTTP | Fastify 5 | Async, schema validation |
| Sessions | ACP (`claude-agent-acp`) | JSON-RPC over stdio |
| Tests | Vitest 4 | Comprehensive test suite |
| Notifications | Telegram + Webhooks | Bidirectional |

## Branching Strategy — GitHub Flow

```
main (stable, tagged releases)
  └── develop (integration branch)
        └── feature/name | fix/name (short-lived, PR only)
              └── PR → CI → squash merge → develop → release branch → main
```

### Rules
1. **main = stable** — every commit is deployable
2. **PR mandatory** — no direct push to main or develop
3. **Squash merge** — clean linear history
4. **Semantic versioning** — vMAJOR.MINOR.PATCH
5. **CI on every PR** — tsc + vitest + build + gate
6. **Delete branch after merge**

### Branch naming
```
feature/prompt-delivery-confirmation
fix/acp-session-lifecycle
chore/rename-manus-to-aegis
```

### Commit messages
```
feat: add prompt delivery confirmation (M1)
fix: ACP session lifecycle race condition
chore: rename manus references to aegis
test: add session health check tests
```

## Architecture

```
src/
├── server.ts          # Fastify HTTP server + routes
├── session.ts         # Session lifecycle (create/send/read/kill)
├── services/
│   └── acp/           # ACP runtime (child process management, JSON-RPC)
├── monitor.ts         # Background polling + event detection
├── transcript.ts      # JSONL transcript parser
├── config.ts          # Config loading + defaults
├── hook.ts            # Claude Code hook integration
└── channels/          # Notification channels
    ├── telegram.ts    # Telegram bot (bidirectional)
    ├── webhook.ts     # Generic webhook POST
    ├── manager.ts     # Channel routing
    └── types.ts       # Shared types
```

### Key Design Decisions
- **ACP as session runtime** — Claude Code's native Agent Control Protocol, no tmux dependency
- **JSONL transcript** — Claude Code's native output format, parsed incrementally
- **No database** — state in memory + JSON files. Aegis is a bridge, not a platform.

## Anti-Patterns (DO NOT)

- ❌ Add a database — Aegis is stateless by design
- ❌ Parse terminal output with LLMs — use regex, be deterministic
- ❌ Block on ACP commands — always async with timeouts
- ❌ Install new dependencies without justification (keep deps minimal)

## Conventions

### TypeScript
- Strict mode, no `any`
- Type imports on separate lines (`import type { X }`)
- All functions must have return types

### Testing
- Every new feature needs tests
- Test ACP contract edge cases
- Mock ACP child processes in tests, never hit real Claude Code

---

_Last updated: 6 May 2026 — updated for ACP runtime (tmux removed)_
