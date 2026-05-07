# AGENTS.md — Aegis Repository Agent Policy

This file defines repository-level rules for human and AI contributors.
It is the entry point for any agent (Claude Code, Copilot, Cursor, Codex,
Windsurf, Aider, etc.) working on this repository.

## Current Phase

Aegis has two active planning tracks:

- **Phase 3 — Team & Early-Enterprise**: production-use exit evidence and
  remaining team-readiness follow-through.
- **Phase 3.5 — ACP Backend Migration & Native Control Plane UI**: the
  maintainer-approved backend migration from tmux to ACP.

Pick work only from:

- [ROADMAP.md](./ROADMAP.md) → Phase 3 and Phase 3.5 checklists
- [.claude/epics/phase-3-team-early-enterprise/epic.md](./.claude/epics/phase-3-team-early-enterprise/epic.md)
- [.claude/epics/phase-3-5-acp-backend-migration/epic.md](./.claude/epics/phase-3-5-acp-backend-migration/epic.md)

Do **not** start work on Phase 4 items without a maintainer
explicitly assigning the issue.

## Scoped Rules (load on demand)

- [.claude/rules/workflow.md](./.claude/rules/workflow.md) — worktree → epic → issue → PR flow
- [.claude/rules/branching.md](./.claude/rules/branching.md) — branch names + targets
- [.claude/rules/commits.md](./.claude/rules/commits.md) — Conventional Commits and `feat:` gate
- [.claude/rules/prs.md](./.claude/rules/prs.md) — PR body, size, review
- [.claude/rules/positioning.md](./.claude/rules/positioning.md) — what Aegis is and what NOT to build
- [.claude/rules/typescript.md](./.claude/rules/typescript.md) — TS conventions
- [.claude/rules/coding.md](./.claude/rules/coding.md) — coding behavior: think-first, simplicity, surgical edits, goal-driven

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
2. `release/<version>` branches are short-lived release preparation branches created by the Create Release Branch workflow from `origin/develop`.
3. `main` is release/promotion only, unless maintainers explicitly declare an emergency hotfix.
4. Never push directly to protected branches.
5. Planned releases use `develop` → `release/<version>` → `main` → `v*` tag. Release Please prepares version/changelog state on `release/<version>`; `.github/workflows/release.yml` publishes only from tags reachable from `origin/main`.
6. Do not create release tags without a real user-facing payload and explicit go/no-go. Planned preview releases use `X.Y.Z-preview`; numbered `X.Y.Z-preview.N` tags are recovery-only and require an annotated tag containing `recovery-release: true`.

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
