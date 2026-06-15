# Branch protection checklist (`develop` and `main`)

> **Status:** Living doc. This document is the canonical checklist for what the
> GitHub branch protection settings **must be**. Where the doc lists a check
> or reviewer that is **not yet enforced** in the repo settings UI, that row
> is marked as **Planned** in the table below — do not enable it in the UI
> until the prerequisite issue lands. If you change a check name, a workflow
> file, or a required-reviewer rule, update this doc in the same PR.
>
> **Cross-reference:** [`docs/devops/per-agent-identities.md`](./per-agent-identities.md)
> covers the per-agent App identity model and the related #4665 / #4731
> work. This doc covers the **branch protection** half of that picture.

This document is the source of truth for branch protection on the two
release-relevant branches in `OneStepAt4time/aegis`:

- **`develop`** — integration branch. All feature PRs land here first.
- **`main`** — release branch. Promotion PRs from `develop` (via release-please)
  and hotfixes land here.

`docs/` and other long-lived branches use looser rules and aren't covered
here.

## Quick reference — actual state (verified 2026-06-15)

Verified against `gh api repos/OneStepAt4time/aegis/branches/{develop,main}/protection`.

| Setting | `develop` | `main` |
|---|---|---|
| Required status checks | `lint-pr-title`, `test (ubuntu-latest, 22)`, `lint`, `Analyze` (4 checks) | `lint-pr-title`, `test (ubuntu-latest, 22)`, `lint`, `Analyze` (4 checks) |
| Strict (branches up-to-date) | `false` | `true` |
| Required approving reviews | 1 | 1 |
| CODEOWNER reviews required | **`false`** | **`true`** |
| Dismiss stale reviews on push | `true` | `true` |
| Require conversation resolution | `true` | `true` |
| Enforce admins | `false` | `true` |
| Force-pushes allowed | `false` | `false` |
| Deletions allowed | `false` | `false` |
| Linear history required | `false` | `false` |
| Required signatures | `false` | `false` |

If a setting above changes, update this doc in the same PR as the UI change.

## Required status checks

A PR to `develop` or `main` **must** show all of the following as ✅ green
before merge is permitted.

### Current required checks (both `develop` and `main`)

These are the 4 contexts currently enforced in the repo settings UI. They
come from 2 workflow files; the other workflows in `.github/workflows/`
are **informational** and run on PRs without being merge gates.

| Check (context) | Workflow file | Job | What it does |
|---|---|---|---|
| `lint-pr-title` | `.github/workflows/ci.yml` | `lint-pr-title` | Enforces Conventional Commits in PR titles |
| `test (ubuntu-latest, 22)` | `.github/workflows/ci.yml` | `test` (matrix: `ubuntu-latest`, Node 22) | TypeScript check + build + smoke UAT + health endpoint |
| `lint` | `.github/workflows/ci.yml` | `lint` | ESLint + hygiene check + security check + console-guard |
| `Analyze` | `.github/workflows/codeql.yml` | `analyze` | CodeQL static analysis for security vulns |

### Pre-merge local gate (not a CI check)

| Gate | How | What it does |
|---|---|---|
| `npm run gate` | Local (run before `git push`) | Functional Code Gate: arch check, hygiene, security, tokens, audit, lint, dashboard gates, typecheck, build, bundle-size check, serial tests. The full chain lives in `package.json` → `scripts.gate`. |

There is no `gate.yml` workflow — `npm run gate` is a local-only command that
mirrors what CI does plus the bundle-size and dashboard gates. See
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the workflow.

### Planned required checks (NOT YET enforced in the UI)

The following workflows run on PRs today but are **not** registered as
required merge gates. Promoting them to required is a separate decision per
workflow and should ship in its own PR with a Themis review for
security-sensitive ones.

| Check (planned) | Workflow file | Job | Why not yet required | Tracking |
|---|---|---|---|---|
| `Helm Smoke` | `.github/workflows/helm-smoke.yml` | `helm-smoke` | k3d v5.4.6 404 blocks the gate; tracked in #4558 | #4559 |
| `Platform smoke` | `.github/workflows/ci.yml` | `platform-smoke` | DRAFT-skip added in #4557, promotion to required pending volume data | — |
| `Dashboard e2e` | `.github/workflows/ci.yml` | `dashboard-e2e` | DRAFT-skip added in #4557, Playwright cost trade-off | — |
| `Release Dry Run` | `.github/workflows/release-dry-run.yml` | `release-dry-run` | Runs only on `release/**` PRs; promotion TBD | — |
| `Post-merge rebuild` | `.github/workflows/post-merge-rebuild.yml` | — | Push trigger, not PR; informational on PRs | — |
| `SDK drift` | `.github/workflows/ci.yml` | `sdk-drift` | Low failure rate; intentional keep on DRAFT per #4557 audit | — |

There is **no** `dashboard-test.yml`, `platform-smoke.yml`, `sdk-drift.yml`,
or `dependency-review.yml` workflow file. The first three live as jobs
inside `ci.yml`; `dependency-review` is not yet implemented.

### DRAFT-skip rules

The following jobs are **skipped on DRAFT PRs** (gated by
`github.event.pull_request.draft == false`). The DRAFT-skip is implemented
in the workflow file, not in the branch protection UI, so it applies
independently of whether the check is required.

| Job | Workflow file | Source of gate |
|---|---|---|
| `feat-minor-bump-gate` | `.github/workflows/ci.yml` | PR #4557 |
| `platform-smoke` | `.github/workflows/ci.yml` | PR #4557 |
| `dashboard-e2e` | `.github/workflows/ci.yml` | PR #4557 |
| `release-dry-run` | `.github/workflows/release-dry-run.yml` | PR #4557 |
| `helm-smoke` | `.github/workflows/helm-smoke.yml` | **Held back**, blocked on k3d fix in #4558 (tracking: #4559) |

`lint-pr-title`, `lint`, the `test` matrix, and `Analyze` (CodeQL) are
**intentionally kept on DRAFT** per the audit in #4557 — they are cheap
(`lint-pr-title` ~3s) or high-value (CodeQL catches vulns early) and the
team wants the feedback on DRAFTs.

See the full audit table in [#4557](https://github.com/OneStepAt4time/aegis/issues/4557).

## Required reviewers

### Current state (verified 2026-06-15)

| Branch | Required reviewers | Source |
|---|---|---|
| `develop` | 1 approving review (any user); CODEOWNER reviews **not** required | `gh api repos/.../branches/develop/protection` |
| `main` | 1 approving review (any user) **+** CODEOWNER review on touched files | `gh api repos/.../branches/main/protection` |

In both cases, `dismiss_stale_reviews: true` — a push to the PR's branch
dismisses prior approvals. `required_conversation_resolution: true` on both.

### CODEOWNERS file (current source of truth)

`./github/CODEOWNERS` (21 lines) currently lists `@OneStepAt4time` as the
owner for every path:

- Default `* @OneStepAt4time`
- `SECURITY.md`, `.github/CODEOWNERS`, `src/auth.ts` → `@OneStepAt4time`
- `.github/workflows/`, release config, Helm chart, release-process docs →
  `@OneStepAt4time`

There is **no** `@Themis` (or any other user) listed in the current
CODEOWNERS file. If you change this, update this doc in the same PR.

### Planned reviewer model (per-agent identities, #4665)

Once the per-agent GitHub Apps land (#4665 — currently shipping the
"ship-now slice" via #4731, with the identity-binding slice deferred to
#4732), the intended reviewer model is:

| Branch | Required reviewers | Rationale |
|---|---|---|
| `develop` | **Argus** (per-agent identity `aegis-argus`, once registered) | Every non-trivial change gets a security-aware code review |
| `develop` | **Themis** for security-sensitive files (CODEOWNERS-gated) | Will require (a) registering `aegis-themis` and granting it PR review, and (b) updating `.github/CODEOWNERS` to list it for the security paths |
| `main` | **Ema** (human owner) | Final go/no-go on the release; per the v0.6.6 / v0.6.7 precedent, Ema explicitly approves the release PR before merge |
| `main` | **Argus** | Same as `develop` |
| `main` | **Themis** for security-sensitive files | Same as `develop` |

**Status:** None of the per-agent Apps are registered yet (the legacy
`aegis-gh-agent` is the only working identity). Promoting any of these
rows from "Planned" to "Current" requires both the App registration and a
matching `.github/CODEOWNERS` update in the same PR.

### Bot-authored PRs

Bot-authored PRs (`aegis-gh-agent[bot]` or per-agent bots once registered)
**cannot self-approve**. The current lane convention is
"Ema approves via CLI on bot-authored PRs":

```bash
# Ema runs this from their machine (NOT a bot, NOT a CI runner)
gh pr review --approve 4724
```

This is the [Path (b) fallback in CONTRIBUTING.md](../../CONTRIBUTING.md#path-b-fallback-boss-approves-via-cli-on-bot-authored-prs).
The structural fix is tracked in [#4725](https://github.com/OneStepAt4time/aegis/issues/4725)
(add a dedicated reviewer GitHub App / PAT) and the policy hardening is
in [#4728](https://github.com/OneStepAt4time/aegis/issues/4728) (fallback
approver chain).

## Merge method

- **Squash merge** is the default for both branches. This keeps the main
  history linear and makes `git log` audits easier.
- The squash commit message should reference the PR number and the issue it
  closes (e.g., `chore(ci): bring per-agent scripts into repo (#4731)`).
- **No merge commits** to `main` or `develop`. **No force-pushes** to either.

## Branch update policy

- **`develop`** is auto-updated by the bot (Dependabot + `aegis-gh-agent`
  auto-merge for green-PR-with-CI-clean dependabot PRs). Manual force-push
  is forbidden.
- **`main`** is fast-forward-only from `develop` via the release-please
  automation. Manual force-push is forbidden.

## Hotfix path

Hotfixes go `hotfix/<name>` → `main` directly (bypasses `develop`), then
cherry-pick to `develop`. The hotfix PR **must** still pass all `main`-only
checks. See the hotfix workflow in `OPERATIONAL-RULES.md`.

## How to update this doc

1. If you're changing a required-check name (renaming a workflow job),
   update **this doc + the workflow file + the repo settings UI** in the
   same PR.
2. If you're **adding** a new required-check, add it to the **Current
   required checks** table and update the repo settings UI in the same PR.
3. If you're **deferring** a check to a later issue, keep it in the
   **Planned required checks** table with a tracking link rather than
   removing it — that way the audit trail survives.
4. If you're **removing** a required-check, do it deliberately with a
   documented rationale (Themis review recommended for security-sensitive
   checks).
5. The CODEOWNERS file is the source of truth for file-level reviewer
   routing. This doc is the source of truth for **branch-level** required
   reviewers and the high-level description of the CODEOWNERS model.

## Acceptance criteria for "branch protection prep is done"

- [ ] All **Current** required status checks in the table above are
      enforced in the repo settings UI for both `develop` and `main`.
- [ ] `npm run gate` passes locally before `git push` on every PR
      (verified via CI badge / reviewer pings).
- [ ] All **Planned** required reviewers (Argus + Themis post-#4665) have
      per-agent identities registered and matching `.github/CODEOWNERS`
      entries.
- [ ] Squash merge is the only enabled merge method.
- [ ] Force-push is blocked on both branches.
- [ ] CODEOWNERS file is in sync with the file-level routing claim in
      this doc.
- [ ] This doc is reviewed by Themis in the next review window.
