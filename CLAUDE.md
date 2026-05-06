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
- **Active tracks:** Phase 3 production-use exit evidence and Phase 3.5 ACP backend migration

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

Aegis is a Fastify HTTP server that bridges Claude Code sessions through REST,
MCP, SSE, WebSocket, CLI, and dashboard surfaces. The runtime uses the
Agent Client Protocol (ACP) to communicate with `claude-agent-acp` child
processes via JSON-RPC over stdio.

```
src/
├── server.ts          # REST API routes (all endpoints)
├── mcp-server.ts      # MCP server (24 tools, 3 prompts)
├── session.ts         # Session lifecycle
├── services/acp/      # ACP runtime (child process, JSON-RPC, events)
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
- Current phases and what NOT to build: [ROADMAP.md](./ROADMAP.md), [.claude/epics/phase-3-team-early-enterprise/epic.md](./.claude/epics/phase-3-team-early-enterprise/epic.md), [.claude/epics/phase-3-5-acp-backend-migration/epic.md](./.claude/epics/phase-3-5-acp-backend-migration/epic.md), and [.claude/rules/positioning.md](./.claude/rules/positioning.md).
- End-to-end workflow: [.claude/rules/workflow.md](./.claude/rules/workflow.md).

## Key Dependencies

- **Fastify** v5 — HTTP server
- **`@agentclientprotocol/claude-agent-acp`** — ACP runtime (bundled)
- **Claude Code CLI** — `claude` must be installed and authenticated

## Testing

- Unit tests: `npm test` (Vitest)
- Integration tests exist but coverage is below target (M1 goal: ≥65%)
- macOS/Windows tests run in CI — check before merging

## Working with This Project

See `.claude/rules/` for scoped rules on commits, branching, PRs, TypeScript conventions, and coding behavior.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **aegis** (14504 symbols, 27900 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/aegis/context` | Codebase overview, check index freshness |
| `gitnexus://repo/aegis/clusters` | All functional areas |
| `gitnexus://repo/aegis/processes` | All execution flows |
| `gitnexus://repo/aegis/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
