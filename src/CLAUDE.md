# src/ — Aegis Server Core

Module containing the HTTP server, session management, ACP runtime integration, and all backend logic.

## Architecture

```
src/
├── server.ts          # Fastify HTTP server + all route registration
├── session.ts         # Session lifecycle (create/send/read/kill/recover)
├── services/acp/      # ACP runtime (child process, JSON-RPC, events)
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
- **ACP as session container** — one `claude-agent-acp` child process per Claude Code session. Communication via JSON-RPC over stdio.
- **JSONL transcript parsing** — incremental reads using byte offsets. The `transcript.ts` parser reads CC's native output format.
- **Terminal state machine** — `terminal-parser.ts` detects idle/working/asking/stalled states via regex patterns on captured pane content.
- **Async with timeouts** — all ACP commands use timeouts. Never block the event loop.
- **Fastify schema validation** — routes use Zod schemas for request/response validation.
- **Event-driven monitoring** — `monitor.ts` polls sessions, emits events through `SessionEventBus`.

### Dependency flow

```
server.ts → SessionManager → AcpRuntime → claude-agent-acp (process)
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
- **Platform branching** — Windows vs Unix differences handled in `session.ts` and ACP runtime. Check `process.platform`.
- **Session IDs** — UUIDs generated with `crypto.randomUUID()`.
- **Concurrency** — `async-mutex` for critical sections (e.g., session creation, permission handling).

## Testing

- Tests live in `src/__tests__/`.
- **Always mock ACP runtime** — never hit real Claude Code in tests.
- **Always mock time** — use `vi.useFakeTimers()` for timeout/retry tests.
- Integration tests go in `src/__tests__/integration/`.
- Run: `npm test` (vitest)

## Common pitfalls

- ACP `send_message` is async — verify delivery via transcript.
- Session state is persisted to JSON — concurrent writes need the mutex.
- The JSONL parser tracks byte offsets — don't reset offsets unless the file is recreated.
- Windows paths need special handling — use `normalizeWorkDirForCompare()` for comparisons.
