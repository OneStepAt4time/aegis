# Skill: Aegis Development Task

Build features and fix bugs for the Aegis bridge.

## Context

- **Stack:** TypeScript + Fastify + tmux
- **Runtime:** Node.js 22, Claude Code CLI (wrapped via tmux)
- **Tests:** Vitest
- **Patterns:** See existing code in `src/` for reference

## Workflow

1. **Understand** — Read the issue. Explore relevant existing code.
2. **Plan** — Think about the approach. Consider edge cases.
3. **Implement** — Write clean, typed TypeScript. Follow existing patterns.
4. **Test** — Write tests for new functionality. Run `npm test`.
5. **Verify** — Run `npx tsc --noEmit && npm run build && npm test`. Fix any errors.
6. **Commit** — Use conventional commit message (`feat:`, `fix:`, `chore:`, `perf:`).

## Architecture

- `src/session.ts` — Session lifecycle (create, send, read, kill)
- `src/tmux.ts` — tmux wrapper (send-keys, capture-pane, new-window)
- `src/monitor.ts` — Background session monitoring (stall detection, status)
- `src/terminal-parser.ts` — Parse CC terminal output (idle, working, permission prompt)
- `src/transcript.ts` — Parse CC JSONL transcripts
- `src/server.ts` — Fastify HTTP API
- `src/config.ts` — Configuration management
- `src/hook.ts` — CC SessionStart hook integration
- `src/channels/` — Notification channels (Telegram, webhook)

## Quality Bar

- TypeScript strict — no `any`, all types explicit
- Every public function has a test
- Error messages are actionable (tell the user what went wrong AND how to fix it)
- No external dependencies without justification
- Keep it simple — Aegis is a bridge, not a framework
