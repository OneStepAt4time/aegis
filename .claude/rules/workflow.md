# Workflow

End-to-end path every contributor (human or agent) follows on Aegis.

```
Roadmap phase  →  Epic  →  Issue  →  Worktree branch  →  PR to develop
                                          │
                                          └──> local gate (npm run gate) before push
```

## 1. Pick work from the current phase

- Read [ROADMAP.md](../../ROADMAP.md) — only pick items from the **current phase**.
- Open [.claude/epics/](../epics/) for the phase-level breakdown.
- Confirm the item is not already covered by an open PR: `gh pr list --search "<keyword>"`.

## 2. Issue first

- Every change of non-trivial size maps to a GitHub issue.
- Use the right template and labels: phase (`phase-1`, `phase-2`, …), type (`bug`, `enhancement`, `security`, …), priority (`P0`–`P3`).
- For issues that come straight from an epic, reference the epic file:
  `Epic: .claude/epics/phase-1-foundations/epic.md` in the issue body.

## 3. Worktree, not main checkout

- Never develop inside the main clone directory.
- Create one worktree per task:

```bash
mkdir -p .claude/worktrees
git fetch origin
git worktree add .claude/worktrees/<slug> -b <type>/<slug> origin/develop
```

## 4. Work in small steps

- Target < 500 lines changed per PR (docs PRs may be larger).
- Split multi-concern work into multiple PRs.
- Do not batch unrelated fixes.

## 5. Local gate before push

```bash
npm run gate
```

If it fails: fix or escalate with `needs-human`. Never `--no-verify`.

## 6. PR targeting develop

- Base branch: `develop`.
- Link the issue with `Closes #<n>` in the PR body.
- PR body must include the "Aegis version" field (see [prs.md](./prs.md)).
- Argus (`aegis-gh-agent[bot]`) reviews and merges. Never self-merge.

## 7. After merge

- Remove the worktree: `git worktree remove .claude/worktrees/<slug>`.
- The issue transitions automatically: `in-develop` → `in-main` → `released`.

## Rules of thumb

- When in doubt about whether an item belongs to the current phase, do **not** start it — ask or add `needs-human`.
- When in doubt about whether a change is user-visible (for `feat:`), choose `fix:` or `refactor:`.
- When in doubt about documentation alignment, run the pre-PR hygiene check from [AGENTS.md](../../AGENTS.md).
