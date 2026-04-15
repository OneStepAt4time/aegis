# Contributing to Aegis

Welcome! Aegis is an open-source bridge that orchestrates Claude Code sessions via REST API, MCP, CLI, webhooks, and Telegram. Contributions of all kinds are welcome — code, docs, bug reports, feature requests.

## Quick Start

1. **Fork** the repo
2. **Clone** your fork: `git clone https://github.com/<your-username>/aegis.git`
3. **Install**: `npm ci`
4. **Build**: `npm run build`
5. **Test**: `npm test`
6. **Create a branch from `develop`**: see [Branch Naming Conventions](#branch-naming-conventions) below
7. **Commit**: follow [Conventional Commits](#commit-conventions)
8. **Push** and open a PR against `develop`

> Transition note: maintainer-directed bootstrap or hotfix work may still target `main` temporarily while branch protections are being moved. Unless explicitly told otherwise, contributors should target `develop`.

## Issue Workflow

Every issue now follows the label-driven lifecycle below:

```
Backlog → Ready → In Progress → In Develop → In Main → Released
```

| Transition | Trigger |
|---|---|
| Backlog → Ready | `auto-triage.yml` applies priority/component labels and marks the issue `ready` |
| Ready → In Progress | Assignee takes the issue and the lifecycle sync marks it `in-progress` |
| In Progress → In Develop | Linked PR merges to `develop` |
| In Develop → In Main | Promotion PR merges the change onto `main` |
| In Main → Released | The issue is closed as part of a completed release |

If an agent gets stuck or the work conflicts with policy, it should add `needs-human` and escalate instead of guessing.

## Triage SLA

| Priority | Triage Window | Description |
|---|---|---|
| P0 | 4h | Production-blocking |
| P1 | 24h | High impact |
| P2 | 72h | Sprint candidate |
| P3-P4 | 72h+ | Backlog |

**P0 and P1 labels are assigned manually.** P2-P4 may receive automatic labels via GitHub Actions.

## Labels

### Priority
| Label | Meaning |
|---|---|
| `P0` | Production-blocking |
| `P1` | High impact |
| `P2` | Medium priority |
| `P3` | Low priority |

### Type
| Label | Meaning |
|---|---|
| `bug` | Something isn't working |
| `enhancement` | New feature or request |
| `security` | Security vulnerability |
| `performance` | Performance improvement |
| `tech-debt` | Code quality / refactoring |
| `documentation` | Docs improvement |
| `accessibility` | A11y improvement |
| `ux` | User experience improvement |

### Area
| Label | Meaning |
|---|---|
| `dashboard` | Web dashboard |
| `mcp` | MCP server / tools |
| `ci` | CI/CD workflows |
| `infrastructure` | Infra / GitHub Actions |
| `architecture` | Architecture decisions |
| `dogfooding` | Using Aegis to build Aegis |

### Status
| Label | Meaning |
|---|---|
| `good first issue` | Beginner-friendly |
| `help wanted` | Extra attention needed |
| `dependencies` | Dependency update |
| `roadmap` | Planned for future |

### Lifecycle Labels
| Label | Meaning |
|---|---|
| `ready` | Triaged and available for an agent to pick up |
| `in-progress` | Work is actively underway |
| `in-develop` | Code is merged to `develop`, not yet promoted |
| `in-main` | Code is on `main` and queued for the next published release |
| `released` | Included in a published release |
| `needs-human` | Requires maintainer intervention |
| `blocked-by-graduation` | Technically ready, but blocked by phase/release policy |

## Issue Templates

When opening an issue, use the appropriate template and fill in **all required fields**:

### Bug Reports
- **Summary** — what's broken
- **Steps to reproduce** — exact steps, code, commands
- **Expected behavior** — what should happen
- **Actual behavior** — what happens instead
- **Environment** — OS, Node.js version, Aegis version
- **Logs** — relevant error messages / stack traces

### Feature Requests
- **Summary** — what you want
- **Motivation** — why it matters
- **Acceptance criteria** — how to know it's done
- **Proposed implementation** — suggested approach (optional)

## Branch Naming Conventions

All branches are created from `origin/develop`. Branch names use the format:

```
<type>/<short-description>
```

| Type | Use for | Example |
|------|---------|---------|
| `feat/` | New features and enhancements | `feat/session-resume` |
| `fix/` | Bug fixes | `fix/tmux-pane-crash` |
| `docs/` | Documentation only | `docs/api-reference` |
| `chore/` | Tooling, CI, dependencies | `chore/upgrade-tsconfig` |
| `refactor/` | Code restructuring without behavior change | `refactor/session-cleanup` |
| `test/` | Adding or updating tests | `test/coverage-session` |

### Aegis team conventions

- **Scribe documentation PRs**: always `docs/<topic>` — targeted at `develop`, reviewed by Argus
- **Release promotion**: `release/<version>` (e.g., `release/0.3.2`) — created by Ema only
- **Hotfixes**: `hotfix/<description>` — targets `main` directly with Argus emergency review

### Branching rules (6 April 2026)

- **ALL PRs target `develop`**, not `main`
- `main` = release-ready only; Ema promotes `develop → main`
- `origin/develop` must exist before branching — run `git fetch origin develop:develop` first

### Development Workflow: Git Worktrees

**Use git worktrees for ALL feature development.** Never develop directly in the main repo folder.

```bash
# Clone once
git clone https://github.com/OneStepAt4time/aegis.git

# Create a worktree per feature
git worktree add ~/projects/aegis-feat-name origin/develop

# Inside worktree — create feature branch
git checkout -b feat/my-feature

# After PR merge — remove worktree
git worktree remove ~/projects/aegis-feat-name
```

See the [Worktree Guide](./docs/worktree-guide.md) for detailed setup and cleanup instructions.

## Development Supply Chain Rules

These rules protect code quality and ensure traceable, auditable development:

### The Chain of Custody
Every change to the codebase must follow this path:
1. **Issue** → authored by any team member, tagged with type/priority/area
2. **PRD (optional)** → for complex features, drafted with CCPM
3. **Worktree branch** → created from `origin/develop`, never from local state
4. **PR** → targets `develop`, must reference the issue (`Closes #XXX`)
5. **Review** → Argus approves, all CI checks green
6. **Merge** → squash merge, branch deleted

### Absolute Rules

- **Never commit directly to `main` or `develop`** — all changes via PR
- **Never use `git push --force`** on shared branches (use `git push --force-with-lease` only on personal feature branches)
- **Always run `gh pr list` before starting work** — verify the issue isn't already resolved
- **Always run `gh pr list --state merged` after closing a PR** — confirm the merge completed
- **Never skip CI** — all checks must pass before merge
- **`feat:` commits require the `approved-minor-bump` label** — without it, the CI gate blocks merge
- **Zero test coverage bypasses** — never add files to `coverage.exclude` to hide untested code
- **Never workaround — always enterprise solutions** — if coverage drops, write better tests; if a test is flaky, mock the dependency; never skip tests or exclude files

### PR Size

- Target **<500 lines** per PR — split larger changes into multiple PRs
- Exception: documentation PRs may be larger when updating multiple files

### Dogfooding

When developing Aegis with Aegis:
- Use Aegis sessions for coding tasks (Claude Code via Aegis bridge)
- If Aegis is unavailable, escalate immediately — do not develop directly without authorization
- Document any direct development decisions in the PR body

### Windows Development

For Windows-specific issues, use psmux (tmux-compatible process manager). See the [Windows Setup Guide](./docs/windows-setup.md) for installation and configuration.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Examples:**
```
feat(session): add resume support for existing sessions
fix(dashboard): resolve SSE reconnect loop on degraded state
docs(api): document handshake endpoint
ci: add concurrency group to cancel overlapping runs
```

## PR Requirements

- [ ] Linked to an issue (`Closes #XXX` in PR body)
- [ ] CI passes (lint, type-check, tests, smoke)
- [ ] Commit messages follow Conventional Commits
- [ ] No merge conflicts with `main`
- [ ] **Docs updated** if the change is user-facing (API, CLI, config, workflow)

## PR Review Process

1. **Argus** reviews all PRs before merge
2. Reviews use `gh api` with bot identity (`aegis-gh-agent[bot]`)
3. A PR with `CHANGES_REQUESTED` must be re-approved before merge
4. Squash merge is the default

## Documentation PRs

Documentation-only PRs follow the same process as code PRs with one addition:

- **Branch**: `docs/<topic>` (e.g., `docs/api-reference`, `docs/cli-reference`)
- **Target**: always `develop`
- **Commit prefix**: `docs:` (e.g., `docs: add CLI reference`)
- **Review**: Scribe self-reviews, then Argus approves
- **PR title**: starts with `docs:` to match commit convention

Example workflow:
```bash
git fetch origin develop:develop
git checkout -b docs/cli-reference develop
git add docs/integrations/cli.md
git commit -m "docs: add CLI reference guide"
git push -u origin docs/cli-reference
gh pr create --base develop --head docs/cli-reference
```

## Team

| Role | Agent | Responsibility |
|---|---|---|
| Triage & Assignment | Athena | Issue triage, priority, labeling |
| Implementation | Hephaestus | Feature development, bug fixes |
| Architecture | Daedalus | Design decisions, dashboard |
| Review & Merge | Argus | Code review, merge gates |
| Documentation | Scribe | README, API docs, guides, Contributing Guide |
| Strategy | Disaster | Escalation, strategic decisions |

## Testing

- **Unit tests**: Co-located with source in `__tests__/`
- **Framework**: Vitest
- **Run**: `npm test` (or `npx vitest run`)
- **Dashboard tests**: `cd dashboard && npx vitest run`
- **Cross-platform minimum gate**: `npx tsc --noEmit`, `npm run build`, and targeted tests for changed areas.
- **Smoke test**: `npm run test:smoke` — starts Aegis, validates health endpoint, checks session list, clean shutdown. Runs automatically in CI on every PR.

### Pre-Release Checklist

Before every release merge, the following gates must pass:

1. **CI green** — all tests, lint, type-check pass on Node 20 + 22
2. **Smoke test** — `npm run test:smoke` passes (runs in CI automatically)
3. **Docs verified** — Scribe has updated README, CONTRIBUTING.md, and API docs for any user-facing changes
4. **Argus approval** — PR reviewed and approved by aegis-gh-agent[bot]

If smoke test fails, the release is blocked until the fix is merged.

## Reporting Bugs Found While Using Aegis

If you find a bug while developing Aegis with Aegis:

1. Open an issue using the **bug template**
2. Include **maximum detail** — reproduction steps, environment, logs, expected vs actual
3. Sign the issue with your agent name
4. Tag `Athena` for triage

## Code of Conduct

Be respectful, constructive, and collaborative. We're building something great together.

---

*ONE STEP AT A TIME.* 🚀
