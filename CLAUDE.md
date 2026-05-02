# CLAUDE.md — Aegis Project Instructions

> Instructions for Claude Code working on the Aegis project.
> Scoped rules are in `.claude/rules/` and load on demand.

## Quick Reference

- **Build:** `npm run build`
- **Test:** `npm test`
- **Type check:** `npx tsc --noEmit`
- **Security check:** `npm run security-check`
- **Quality gate:** `npm run gate` must pass before any push/PR
- **Branch model:** all standard PRs target `develop` (not `main`)
- **Release model:** `develop` → `release/<version>` → `main` → `v*` tag; Release Please prepares release branches, `release.yml` publishes tags from `main`
- **Docs alignment:** keep policy docs synchronized in the same PR

## Non-Negotiable Hygiene Rules

1. Do not create or commit temporary analysis/report files unless explicitly requested for publication.
2. Do not place deployment documentation in repository root; keep it under `docs/`.
3. Do not keep obsolete UAT or one-off audit artifacts in tracked files.
4. Keep alpha lifecycle language consistent; do not reference retired legacy version lines.
5. Do not create release tags or preview bumps without a real user-facing payload and explicit go/no-go; planned previews use `X.Y.Z-preview`, not `X.Y.Z-preview.N`.

## Mandatory Pre-PR Alignment Checklist

Before opening/updating a PR, confirm all checks below:

1. `npm run gate` passes.
2. No trash/untracked artifacts intended for accidental commit:

```bash
git status --short
git ls-files --others --exclude-standard
```

3. No obsolete references to removed legacy files:

```bash
git grep -n "UAT_BUG_REPORT.md\|UAT_CHECKLIST.md\|UAT_PLAN.md\|DEPLOYMENT.md\|coverage-gap-analysis.md"
```

4. Policy docs stay aligned when rules change:
	- `AGENTS.md`
	- `CLAUDE.md`
	- `CONTRIBUTING.md`
	- `ROADMAP.md`
	- `SECURITY.md`

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
- **CLI binary:** `ag` (primary). `aegis` remains supported as a compatibility alias — see [ADR-0023](./docs/adr/0023-positioning-claude-code-control-plane.md).
- **MCP:** `claude mcp add aegis -- ag mcp` (or `claude mcp add aegis -- npx --package=@onestepat4time/aegis ag mcp` without a global install)
- **Deprecated:** `aegis-bridge` (do not use in new code)

## Positioning (read before proposing features)

- Aegis is the **control plane of Claude Code** — a bridge, not an orchestrator. See [ADR-0023](./docs/adr/0023-positioning-claude-code-control-plane.md).
- MIT, single edition. BYO LLM is first-class.
- Current phase and what NOT to build: [.claude/rules/positioning.md](./.claude/rules/positioning.md).
- End-to-end workflow: [.claude/rules/workflow.md](./.claude/rules/workflow.md).

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
