# CLAUDE.md — Aegis Project Instructions

> Instructions for Claude Code working on the Aegis project.
> Scoped rules are in `.claude/rules/` and load on demand.

## Quick Reference

- **Build:** `npm run build`
- **Test:** `npm test`
- **Type check:** `npx tsc --noEmit`
- **Quality gate:** all three must pass before any PR

## Architecture

Aegis is a Fastify HTTP server that orchestrates Claude Code sessions via tmux.

```
src/
├── server.ts          # REST API routes (all endpoints)
├── mcp-server.ts      # MCP server (24 tools, 3 prompts)
├── session.ts         # Session lifecycle
├── tmux.ts            # tmux operations
├── terminal-parser.ts # Claude Code UI state detection
├── monitor.ts         # Stall detection, events
├── pipeline.ts        # Batch/multi-stage orchestration
├── auth.ts            # API key management
└── config.ts          # Configuration (AEGIS_* env vars)
```

## Package

- **Name:** `@onestepat4time/aegis`
- **CLI binary:** `aegis`
- **MCP:** `claude mcp add aegis -- npx @onestepat4time/aegis mcp`
- **Deprecated:** `aegis-bridge` (do not use in new code)

## Key Dependencies

- **Fastify** v5 — HTTP server
- **tmux** ≥ 3.2 — session management (no browser automation)
- **Claude Code CLI** — `claude` must be installed and authenticated

## Testing

- Unit tests: `npm test` (Vitest)
- Integration tests exist but coverage is below target (M1 goal: ≥65%)
- macOS/Windows tests run in CI — check before merging

## Working with This Project

See `.claude/rules/` for scoped rules on commits, branching, PRs, and TypeScript conventions.
