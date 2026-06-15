# Branch protection checklist (`develop` and `main`)

> **Status:** Living doc. The required checks are enforced by the GitHub repo
> settings UI; this document is the canonical checklist for what those
> settings **must** be. If you change a check name, a workflow file, or a
> required-reviewer rule, update this doc in the same PR.

This document is the source of truth for branch protection on the two
release-relevant branches in `OneStepAt4time/aegis`:

- **`develop`** — integration branch. All feature PRs land here first.
- **`main`** — release branch. Promotion PRs from `develop` (via release-please)
  and hotfixes land here.

`docs/` and other long-lived branches use looser rules and aren't covered
here.

## Required status checks

A PR to `develop` or `main` **must** show all of the following as ✅ green
before merge is permitted.

### Universal checks (both `develop` and `main`)

| Check | Workflow file | What it does |
|---|---|---|
| **CI** | `.github/workflows/ci.yml` (or equivalent) | Lint + type-check + unit tests on Ubuntu + macOS |
| **CodeQL** | `.github/workflows/codeql.yml` | Static analysis for security vulns |
| **Helm Smoke** | `.github/workflows/helm-smoke.yml` | Smoke-tests the Helm chart on a k3d cluster |
| **Lint PR Title** | `.github/workflows/lint-pr-title.yml` | Enforces Conventional Commits in PR titles |
| **`npm run gate`** (pre-merge) | local / `gate.yml` | Functional Code Gate: typecheck, build, all tests, residual-risk sign-off |

### `develop`-only checks

| Check | Workflow file | What it does |
|---|---|---|
| **Dashboard test** | `.github/workflows/dashboard-test.yml` | Vitest + build for the dashboard |
| **Platform smoke** | `.github/workflows/platform-smoke.yml` | Cross-platform smoke tests |
| **SDK drift** | `.github/workflows/sdk-drift.yml` | TypeScript SDK parity check |

### `main`-only checks

| Check | Workflow file | What it does |
|---|---|---|
| **Release Dry Run** | `.github/workflows/release-dry-run.yml` | Runs release-please in dry-run mode |
| **Post-merge rebuild** | `.github/workflows/post-merge-rebuild.yml` | Rebuilds and re-tags after a release-please merge |
| **Dependency Review** | `.github/workflows/dependency-review.yml` | Scans new dependencies for CVEs on PRs to main |

### DRAFT-skip rules

The following checks are **skipped on DRAFT PRs** to save CI minutes:
`lint-pr-title`, `test ubuntu-latest 22`, `lint`, `Analyze`,
`helm-smoke` (after #4557 / #4559), `feat-minor-bump-gate`. See [#4557](https://github.com/OneStepAt4time/aegis/issues/4557)
for the audit table.

## Required reviewers

| Branch | Required reviewers | Rationale |
|---|---|---|
| `develop` | **Argus** (per-agent identity `aegis-argus`, once registered) | Every non-trivial change gets a security-aware code review |
| `develop` | **Themis** for security-sensitive files (CODEOWNERS-gated) | The CODEOWNERS file at `.github/CODEOWNERS` lists Themis for paths under `infra/`, `scripts/github-apps/`, `.github/workflows/`, `auth/`, and any path matching `*secret*` or `*token*` |
| `main` | **Ema** (human owner) | Final go/no-go on the release; per the v0.6.6 / v0.6.7 precedent, Ema explicitly approves the release PR before merge |
| `main` | **Argus** | Same as `develop` |
| `main` | **Themis** for security-sensitive files | Same as `develop` |

### Bot-authored PRs

Bot-authored PRs (`aegis-gh-agent[bot]` or per-agent bots) **cannot self-approve**.
The current lane convention is "Ema approves via CLI on bot-authored PRs":

```bash
# Ema runs this from their machine (NOT a bot, NOT a CI runner)
gh pr review --approve 4724
```

This is the [Path (b) fallback in CONTRIBUTING.md](../../CONTRIBUTING.md#path-b-fallback-boss-approves-via-cli-on-bot-authored-prs).
The structural fix is tracked in [#4725](https://github.com/OneStepAt4time/aegis/issues/4725) (add a
dedicated reviewer GitHub App / PAT) and the policy hardening is in [#4728](https://github.com/OneStepAt4time/aegis/issues/4728)
(fallback approver chain).

## Merge method

- **Squash merge** is the default for both branches. This keeps the main
  history linear and makes `git log` audits easier.
- The squash commit message should reference the PR number and the issue it
  closes (e.g., `chore(ci): bring per-agent scripts into repo (#4731)`).
- **No merge commits** to `main` or `develop`. **No force-pushes** to either.

## Branch update policy

- **`develop`** is auto-updated by the bot (Dependabot + aegis-gh-agent auto-merge
  for green-PR-with-CI-clean dependabot PRs). Manual force-push is forbidden.
- **`main`** is fast-forward-only from `develop` via the release-please
  automation. Manual force-push is forbidden.

## Hotfix path

Hotfixes go `hotfix/<name>` → `main` directly (bypasses `develop`), then
cherry-pick to `develop`. The hotfix PR **must** still pass all `main`-only
checks. See the hotfix workflow in `OPERATIONAL-RULES.md`.

## How to update this doc

1. If you're changing a required-check name (renaming a workflow), update
   **this doc + the workflow file + the repo settings UI** in the same PR.
2. If you're adding a new required-check, add it to this doc + add it to
   the repo settings UI in the same PR.
3. If you're removing a required-check, do it deliberately with a documented
   rationale (Themis review recommended for security-sensitive checks).
4. The CODEOWNERS file is the source of truth for file-level reviewer
   routing. This doc is the source of truth for **branch-level** required
   reviewers.

## Acceptance criteria for "branch protection prep is done"

- [ ] All required status checks listed in this doc are enforced in the
      repo settings UI for both `develop` and `main`.
- [ ] All required reviewers (Argus, Themis for security paths, Ema for
      `main`) are configured in the repo settings UI.
- [ ] Squash merge is the only enabled merge method.
- [ ] Force-push is blocked on both branches.
- [ ] CODEOWNERS file is in sync with the file-level routing.
- [ ] This doc is reviewed by Themis in the next review window.
