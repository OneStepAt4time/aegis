# Worktree Development Guide

Aegis uses **git worktrees** for isolated development. Each feature gets its own directory with its own branch, preventing conflicts and keeping the main repo clean.

---

## Why Worktrees?

- **Isolated development** — work on multiple features simultaneously without branch conflicts
- **Clean main repo** — main `develop` and `main` branches stay deployable
- **Fast context switching** — switch between features without stashing or merging
- **No cross-contamination** — changes in one worktree can't accidentally affect another

---

## Branch Naming Convention

```
docs/<topic>        # Documentation changes
feat/<issue-number>-<short-description>   # New features
fix/<issue-number>-<short-description>   # Bug fixes
refactor/<area>     # Code refactoring (no behavior change)
chore/<topic>       # Tooling, CI, dependencies
```

**Examples:**
```
docs/api-reference-update
feat/1698-route-middleware
fix/1750-cli-auth-token
refactor/session-manager
```

---

## Creating a Worktree

### Step 1 — Fetch latest develop

```bash
git fetch origin develop:develop
```

### Step 2 — Create a new branch from develop

```bash
git checkout -b feat/my-new-feature origin/develop
```

### Step 3 — Create the worktree directory

```bash
# Create worktree at ~/projects/aegis-my-feature
git worktree add ~/projects/aegis-my-feature feat/my-new-feature
```

### Step 4 — Install dependencies in the worktree

```bash
cd ~/projects/aegis-my-feature
npm install
```

You're now developing in an isolated directory.

---

## Working in a Worktree

### Typical workflow

```bash
# 1. Make your changes
cd ~/projects/aegis-my-feature
vim src/some-file.ts

# 2. Commit (conventional commits)
git add .
git commit -m "feat: add new feature"

# 3. Push your branch
git push -u origin feat/my-new-feature

# 4. Open PR via GitHub CLI
gh pr create --repo OneStepAt4time/aegis \
  --base develop \
  --head feat/my-new-feature \
  --title "feat: add new feature" \
  --body "## Summary\n\n..."
```

### Testing in a worktree

```bash
# Build
npm run build

# Run tests
npm test -- --run

# Start the server (for manual testing)
node dist/server.js
```

---

## Cleaning Up After PR Merge

After your PR is merged, remove the worktree:

### Step 1 — Remove the worktree directory

```bash
git worktree remove ~/projects/aegis-my-feature
```

### Step 2 — Delete the local branch

```bash
git branch -d feat/my-new-feature
git push origin --delete feat/my-new-feature
```

### Verify cleanup

```bash
# List active worktrees
git worktree list

# List local branches (should not show your feature branch)
git branch
```

---

## Common Pitfalls

### Pitfall 1 — Forgetting to fetch before creating branch

**Wrong:**
```bash
git checkout -b feat/my-feature  # Uses stale origin/develop
```

**Right:**
```bash
git fetch origin develop:develop
git checkout -b feat/my-feature origin/develop
```

---

### Pitfall 2 — Worktree on a deleted branch

If you push a branch, it gets deleted (via squash merge or manual deletion), the worktree reference becomes stale:

```bash
git worktree list
# Shows: /path/to/worktree ABC1234... (branch was deleted)
```

**Fix:**
```bash
git worktree prune
```

---

### Pitfall 3 — Main repo worktree checked out

You can't remove the worktree if you're inside it:

```bash
# You're in ~/projects/aegis-feature — can't remove it from here
git worktree remove ~/projects/aegis-feature
# Error: cannot lock

# Switch to main repo first
cd ~/projects/aegis
git worktree remove ~/projects/aegis-feature
```

---

### Pitfall 4 — Merge conflicts after long-running worktree

If your worktree is months old and `develop` has moved far ahead:

```bash
# Rebase your worktree branch on latest develop
git fetch origin develop
git rebase origin/develop

# If conflicts occur, resolve them and continue:
git rebase --continue
```

---

### Pitfall 5 — Using `npm install` in multiple worktrees simultaneously

Running `npm install` in multiple worktrees at the same time can corrupt `node_modules`. Run them sequentially, not in parallel.

---

## Quick Reference

```bash
# Create worktree
git worktree add ~/projects/aegis-<name> <branch-name>

# List worktrees
git worktree list

# Remove worktree
git worktree remove ~/projects/aegis-<name>

# Prune stale worktree references
git worktree prune

# Switch to a worktree
cd ~/projects/aegis-<name>

# Clean up merged branch
git branch -d <branch-name>
git push origin --delete <branch-name>
```

---

## Aegis Team Rules

1. **Always use worktrees** — never develop directly in `~/projects/aegis`
2. **Branch from `origin/develop`** — fetch first to ensure latest
3. **PRs target `develop`** — never `main` (except release merges)
4. **Clean up after merge** — remove worktree and branch promptly
5. **One PR per feature** — batch related changes, but keep PRs focused
