# src/ — Aegis Server Core

Module containing the HTTP server, session management, tmux integration, and all backend logic.

## Architecture

```
src/
├── server.ts          # Fastify HTTP server + all route registration
├── session.ts         # Session lifecycle (create/send/read/kill/recover)
├── tmux.ts            # TmuxManager — tmux command wrapper (async, with timeouts)
├── monitor.ts         # Background polling loop + event detection
├── mcp-server.ts      # MCP stdio transport (tool discovery for Claude Code)
├── config.ts          # Config loading from env + defaults
├── channels/          # Notification channels (Telegram, webhooks)
├── pipeline.ts        # Pipeline orchestration (batch session workflows)
├── auth.ts            # API key auth + bearer token classification
├── events.ts          # SessionEventBus — SSE + WebSocket event routing
└── ...                # Supporting modules
```

### Key patterns

- **No database** — all state in memory + JSON files on disk. Aegis is a bridge, not a platform.
- **Tmux as session container** — one tmux window per Claude Code session. All interaction via `send-keys`/`capture-pane`.
- **JSONL transcript parsing** — incremental reads using byte offsets. The `transcript.ts` parser reads CC's native output format.
- **Terminal state machine** — `terminal-parser.ts` detects idle/working/asking/stalled states via regex patterns on captured pane content.
- **Async with timeouts** — all tmux commands use `execFile` with timeouts. Never block the event loop.
- **Fastify schema validation** — routes use Zod schemas for request/response validation.
- **Event-driven monitoring** — `monitor.ts` polls sessions, emits events through `SessionEventBus`.

### Dependency flow

```
server.ts → SessionManager → TmuxManager → tmux (process)
         → SessionMonitor → SessionManager
         → ChannelManager → TelegramChannel / WebhookChannel
         → PipelineManager → SessionManager
         → MCP tools → SessionManager (shared instance)
```

`SessionManager` is the central state holder. Most other modules either receive it as a dependency or access it through `server.ts`.

## Conventions

- **TypeScript strict mode** — no `any`. Use `unknown` + type guards.
- **Type imports** — `import type { X }` on separate lines.
- **Error handling** — use `normalizeApiErrorPayload()` for API responses. Never leak stack traces.
- **Platform branching** — Windows vs Unix differences handled in `tmux.ts` and `session.ts`. Check `process.platform`.
- **Session IDs** — UUIDs generated with `crypto.randomUUID()`.
- **Concurrency** — `async-mutex` for critical sections (e.g., session creation, permission handling).

## Testing

- Tests live in `src/__tests__/`.
- **Always mock tmux** — never hit real tmux in tests. Use `helpers/mock-tmux.ts`.
- **Always mock time** — use `vi.useFakeTimers()` for timeout/retry tests.
- Integration tests go in `src/__tests__/integration/`.
- Run: `npm test` (vitest)

## Common pitfalls

- `tmux send-keys` is fire-and-forget — prompts may not arrive. Always verify via `capture-pane`.
- `capture-pane` output includes ANSI codes — use `stripAnsi()` before parsing.
- Session state is persisted to JSON — concurrent writes need the mutex.
- The JSONL parser tracks byte offsets — don't reset offsets unless the file is recreated.
- Windows paths need special handling — use `normalizeWorkDirForCompare()` for comparisons.
