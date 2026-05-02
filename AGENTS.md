# AGENTS.md — Aegis Repository Agent Policy

This file defines repository-level rules for human and AI contributors.
It is the entry point for any agent (Claude Code, Copilot, Cursor, Codex,
Windsurf, Aider, etc.) working on this repository.

## Current Phase

Aegis is in **Phase 3 — Team & Early-Enterprise**. Pick work only from:

- [ROADMAP.md](./ROADMAP.md) → Phase 3 checklist
- [.claude/epics/phase-3-team-early-enterprise/epic.md](./.claude/epics/phase-3-team-early-enterprise/epic.md)

Do **not** start work on Phase 4 items without a maintainer
explicitly assigning the issue.

## Scoped Rules (load on demand)

- [.claude/rules/workflow.md](./.claude/rules/workflow.md) — worktree → epic → issue → PR flow
- [.claude/rules/branching.md](./.claude/rules/branching.md) — branch names + targets
- [.claude/rules/commits.md](./.claude/rules/commits.md) — Conventional Commits and `feat:` gate
- [.claude/rules/prs.md](./.claude/rules/prs.md) — PR body, size, review
- [.claude/rules/positioning.md](./.claude/rules/positioning.md) — what Aegis is and what NOT to build
- [.claude/rules/typescript.md](./.claude/rules/typescript.md) — TS conventions

Authoritative strategic source: [ADR-0023](./docs/adr/0023-positioning-claude-code-control-plane.md).

## Mandatory Gate Before Push/PR

Before any `git push` or PR creation, run:

```bash
npm run gate
```

The gate must pass completely.

If the gate fails:

1. Do not push.
2. Do not open or update a PR.
3. Fix the failure, or escalate with `needs-human` if the issue is unclear or risky.

## Branch and PR Rules

1. Standard PRs target `develop`.
2. `main` is release/promotion only, unless maintainers explicitly declare an emergency hotfix.
3. Never push directly to protected branches.

## Security-First Defaults

1. Do not bypass checks with `--no-verify`.
2. Keep CI required checks green before merge.
3. Prefer small, auditable PRs with clear test evidence.

## Anti-Drift and Anti-Trash Rules

These are common AI-agent failure modes and must be actively prevented.

1. Never create or commit ad-hoc report/trash files in repository root or `docs/`.
2. Do not keep date-stamped analysis artifacts (for example `*-analysis-YYYY-MM-DD.md`) unless explicitly requested for publication.
3. Keep lifecycle docs aligned in every policy-changing PR:
	- `AGENTS.md`
	- `CLAUDE.md`
	- `CONTRIBUTING.md`
	- `ROADMAP.md`
	- `SECURITY.md`
4. Do not reintroduce legacy version claims when the project is alpha-only.
5. Deployment documentation lives under `docs/`, not repository root.

## Mandatory Pre-PR Hygiene Check

Before opening or updating a PR, verify no stale/trash artifacts are present:

```bash
git status --short
git ls-files --others --exclude-standard
git grep -n "UAT_BUG_REPORT.md\|UAT_CHECKLIST.md\|UAT_PLAN.md\|DEPLOYMENT.md\|coverage-gap-analysis.md"
```

If any obsolete references or trash files are found, fix them in the same PR before requesting review.

## Escalation

When blocked, unsafe, or uncertain, stop and mark the work as `needs-human`.
