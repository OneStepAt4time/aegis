# Contributing to Aegis

Welcome! Aegis is an open-source bridge that orchestrates Claude Code sessions via REST API, MCP, CLI, webhooks, and Telegram. Contributions of all kinds are welcome — code, docs, bug reports, feature requests.

## Quick Start

1. **Fork** the repo
2. **Clone** your fork: `git clone https://github.com/<your-username>/aegis.git`
3. **Install**: `npm ci`
4. **Build**: `npm run build`
5. **Test**: `npm test`
6. **Create a branch**: `git checkout -b fix/my-fix main`
7. **Commit**: follow [Conventional Commits](#commit-conventions)
8. **Push** and open a PR against `main`

## Issue Workflow

Every issue follows this lifecycle:

```
Backlog → Triaged → Ready → In Progress → Review → Needs Docs → Done
```

| Transition | Trigger |
|---|---|
| Backlog → Triaged | Athena (or triager) assigns priority + labels |
| Triaged → Ready | Issue has all info needed to start work |
| Ready → In Progress | Assignee comments `🔧 Starting work` |
| In Progress → Review | PR opened and linked to issue |
| Review → Needs Docs | PR approved, docs update required |
| Needs Docs → Done | Docs updated and verified |

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
