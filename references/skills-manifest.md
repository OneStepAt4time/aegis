# Custom Skills Manifest

_Updated: 2026-03-27. Location: `~/.claude/skills/` (user-level, across all projects)._

## Overview

These custom skills extend the superpowers core system. They are available to every CC session in the Aegis repo. They MUST be copied into every worktree (see CLAUDE.md "Mandatory Worktree Usage").

## Skills

### `workflow` — Orchestrator (THE entry point)
- **Trigger:** Any workflow intent — implement, review, triage, ship, check CI
- **Does NOT implement anything itself** — routes to the right combination of skills
- **Routing patterns:**
  - "implement issue #N" → github-lifecycle (issue-to-branch) → worktree-dev → brainstorming → writing-plans → executing-plans → verification → finishing-branch → github-lifecycle (branch-to-pr)
  - "review PRs" → review-queue
  - "triage issues" → issue-triage
  - "check CI" → ci-monitor
  - "ship feature/X" → finishing-branch → github-lifecycle (pr-to-merge)
- **When Hep delegates to CC:** Start with "Invoke the workflow skill: implement issue #N"

### `github-lifecycle` — Spec → Issue → Branch → PR → Merge
- **Modes:** `spec-to-issue`, `issue-to-branch`, `branch-to-pr`, `pr-to-merge`
- **Branch naming:** `feature/<N>-<short-title>` or `fix/<N>-<short-title>`
- **PR body:** auto-links to issue ("Fixes #N"), includes test plan
- **Memory:** updates `workflow_issues.md` after each transition

### `worktree-dev` — Isolated workspace setup + cleanup
- **Wraps:** `using-git-worktrees` (superpowers core)
- **Adds:** config file copying (settings.local.json, .mcp.json, hooks, skills)
- **Naming:** `issue-42-fix-auth` or `feat-rate-limiting`
- **Cleanup:** invokes `finishing-a-development-branch`, removes worktree + branch

### `review-queue` — Batch PR review
- **Uses:** `dispatching-parallel-agents` (superpowers core)
- **Dispatches:** one agent per PR, each reads full diff + checks against spec
- **Posts:** APPROVE / REQUEST_CHANGES / COMMENT via GitHub MCP
- **Filters:** --label, --author, --max-age, --no-review

### `issue-triage` — Automated issue labeling + spec stubs
- **Scans:** unlabeled or un-prioritized open issues
- **Labels:** bug, enhancement, documentation, security, P0/P1/P2, S/M/L
- **Spec stubs:** creates draft design docs in `docs/internal/superpowers/specs/` for M/L features

### `ci-monitor` — CI failure detection + P0 fix drafting
- **Uses:** `gh run list` + `gh run view` via Bash
- **P0 on main:** analyzes logs, drafts fix PR
- **Feature branch failures:** posts comment on associated PR

## Hooks (in `.claude/hooks/`)

| Hook | Trigger | Action |
|------|---------|--------|
| `type-check.sh` | PostToolUse (Edit/Write) | tsc --noEmit |
| `build-on-stop.sh` | Stop | build + test |
| `auto-link-pr-issue.sh` | PostToolUse (create_pull_request) | Appends "Fixes #N" from branch name |
| `auto-label-commit.sh` | PostToolUse (Bash, git commit) | Suggests labels from commit message |
| `review-trigger.sh` | PostToolUse (create_pull_request) | Logs to `~/.aegis/review-queue.jsonl` |

## Memory Files (in `~/.claude/projects/-home-bubuntu-projects-aegis/memory/`)

| File | Purpose | Updated by |
|------|---------|------------|
| `workflow_active.md` | Currently active tasks + sessions | workflow, worktree-dev |
| `workflow_issues.md` | Issue → Branch → PR mapping | github-lifecycle |
| `workflow_prs.md` | Open PRs + review status | review-queue |
| `workflow_queue.md` | Issues awaiting triage | issue-triage |

## Key Rules for Hep

1. **ALWAYS use `workflow` skill as entry point** — never micromanage CC step by step
2. **Single prompt delegation** — "Invoke the workflow skill: implement issue #N" replaces 5-10 manual prompts
3. **Verify final output, not intermediate steps** — CC orchestrates internally
4. **Memory files are the source of truth** — read them before acting, update them after completing
5. **Copy all config to worktrees** — settings.local.json + .mcp.json + hooks/ + skills/
