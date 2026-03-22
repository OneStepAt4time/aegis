# CONTEXT.md — Aegis Architectural Decisions

_Source of truth for all architectural decisions. Read before touching any code._

---

## What is Aegis?

An HTTP bridge that manages interactive Claude Code sessions via tmux. It lets AI orchestrators programmatically create, monitor, refine, and control coding sessions.

## Stack

| Layer | Tech | Note |
|-------|------|------|
| Runtime | Node.js 22+ | TypeScript strict |
| HTTP | Fastify 5 | Async, schema validation |
| Sessions | tmux | One window per CC session |
| Parsing | Custom JSONL parser | Reads CC's native transcript format |
| Tests | Vitest 4 | 136 tests |
| Notifications | Telegram + Webhooks | Bidirectional |

## Branching Strategy — GitHub Flow

```
main (stable, tagged releases)
  └── feature/nome | fix/nome (short-lived, PR only)
        └── PR → CI → squash merge → delete branch → tag if release
```

### Rules
1. **main = stable** — every commit is deployable
2. **PR mandatory** — no direct push to main
3. **Squash merge** — clean linear history
4. **Semantic versioning** — vMAJOR.MINOR.PATCH
5. **CI on every PR** — tsc + vitest + build
6. **Delete branch after merge**

### Branch naming
```
feature/prompt-delivery-confirmation
fix/tmux-send-keys-race-condition
chore/rename-manus-to-aegis
```

### Commit messages
```
feat: add prompt delivery confirmation (M1)
fix: tmux send-keys Enter race condition
chore: rename manus references to aegis
test: add session health check tests
```

## Architecture

```
src/
├── server.ts          # Fastify HTTP server + routes
├── session.ts         # Session lifecycle (create/send/read/kill)
├── tmux.ts            # tmux commands (create-window, send-keys, capture-pane)
├── monitor.ts         # Background polling + event detection
├── transcript.ts      # JSONL transcript parser
├── terminal-parser.ts # Terminal state detection (idle/working/asking/stalled)
├── config.ts          # Config loading + defaults
├── hook.ts            # Claude Code hook (SessionStart → session_map.json)
└── channels/          # Notification channels
    ├── telegram.ts    # Telegram bot (bidirectional)
    ├── webhook.ts     # Generic webhook POST
    ├── manager.ts     # Channel routing
    └── types.ts       # Shared types
```

### Key Design Decisions
- **tmux as session container** — reliable, survives crashes, scriptable
- **JSONL transcript** — Claude Code's native output format, parsed incrementally
- **Terminal state machine** — regex-based detection of idle prompt, working indicator, permission prompts
- **No database** — state in memory + JSON files. Aegis is a bridge, not a platform.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /v1/sessions | Create session |
| GET | /v1/sessions | List sessions |
| GET | /v1/sessions/:id/read | Read transcript + status |
| POST | /v1/sessions/:id/send | Send message to CC |
| POST | /v1/sessions/:id/command | Send /slash command |
| POST | /v1/sessions/:id/bash | Send !bash command |
| POST | /v1/sessions/:id/approve | Approve permission prompt |
| POST | /v1/sessions/:id/reject | Reject permission prompt |
| POST | /v1/sessions/:id/escape | Send Escape key |
| POST | /v1/sessions/:id/interrupt | Send Ctrl+C |
| DELETE | /v1/sessions/:id | Kill session |

## Known Issues (Pre-v1.1)

### P0 — Prompt Delivery (M1)
tmux send-keys is fire-and-forget. ~20% of prompts don't arrive because:
- Enter key race condition (500ms delay helps but doesn't guarantee)
- CC might be in a state that doesn't accept input
- **Fix needed:** capture-pane verification after send-keys

### P1 — Session Health Check
No API to check if a CC session is actually alive vs zombie tmux window.
- **Fix needed:** `GET /v1/sessions/:id/health` endpoint

### P2 — Stall Detection
Stall threshold is 60 min (too long). Should be configurable per-session.
- Current: `stallThresholdMs: 3600000` (global)

### P3 — Session Reuse Bug
Claude Code sometimes resumes old sessions instead of starting fresh.
- Related to `claudeSessionId` discovery in JSONL

## Anti-Patterns (DO NOT)

- ❌ Add a database — Aegis is stateless by design
- ❌ Parse terminal output with LLMs — use regex, be deterministic
- ❌ Block on tmux commands — always async with timeouts
- ❌ Install new dependencies without justification (keep deps minimal)

## Conventions

### TypeScript
- Strict mode, no `any`
- Type imports on separate lines (`import type { X }`)
- All functions must have return types

### Testing
- Every new feature needs tests
- Test terminal parser edge cases (most fragile part)
- Mock tmux in tests, never hit real tmux

---

_Last updated: 22 Marzo 2026 by manudis23_
_Version: 1.0.0 (initial migration from cc-bridge/manus)_
