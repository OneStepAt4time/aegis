# Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate Aegis release management using release-please with semi-automated workflow.

**Architecture:** release-please creates/maintains a Release PR on every push to main. Merging it creates the git tag + GitHub Release. The existing release.yml (stripped of its github-release job) handles npm publish on tag push. A new CI job validates PR titles follow conventional commit format.

**Tech Stack:** GitHub Actions, release-please-action v4, amannn/action-semantic-pull-request v5, npm provenance publishing.

**Spec:** `docs/superpowers/specs/release-automation-design.md`

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `CHANGELOG.md` | Modify | Backfill v1.4.1 and v2.0.0 entries |
| `.release-please-manifest.json` | Create | Tracks last released version for release-please |
| `release-please-config.json` | Create | Configures release-please sections and behavior |
| `.github/workflows/release-please.yml` | Create | Release PR automation on push to main |
| `.github/workflows/release.yml` | Modify | Remove github-release job, keep test + publish-npm |
| `.github/workflows/ci.yml` | Modify | Add PR title validation job |

---

**All tasks (1-6) should be done on a feature branch `chore/release-automation`.** Create it before starting:

```bash
git checkout -b chore/release-automation
```

---

### Task 1: Backfill CHANGELOG.md for v1.4.1

**Files:**
- Modify: `CHANGELOG.md:1-5` (insert between header and existing v1.4.0 section)

- [ ] **Step 1: Add v1.4.1 section to CHANGELOG.md**

Insert after line 1 (`# Changelog`) and before the existing `## [1.4.0]` section. The content comes from the actual v1.4.1 GitHub Release body:

```markdown
## [1.4.1] - 2026-03-28

### Fixed
- **Session creation deadlock**: `POST /v1/sessions` hung indefinitely due to non-reentrant `serialize()` queue in `createWindow()`. Fix: use `tmuxInternal()` directly inside the serialize callback instead of `listWindows()` which re-entered the queue (#393)
```

- [ ] **Step 2: Verify the edit**

Run: `head -15 CHANGELOG.md`
Expected: See `## [1.4.1]` section between the header and `## [1.4.0]`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "chore: backfill CHANGELOG for v1.4.1 — Issue #470"
```

---

### Task 2: Backfill CHANGELOG.md for v2.0.0

**Files:**
- Modify: `CHANGELOG.md:1-5` (insert between header and the new v1.4.1 section)

- [ ] **Step 1: Add v2.0.0 section to CHANGELOG.md**

Insert after line 1 (`# Changelog`) and before the new `## [1.4.1]` section. Content derived from git log `v1.4.1..HEAD`:

```markdown
## [2.0.0] - 2026-03-28

### Added
- **MCP tools (P0+P1+P2)**: 21 tools — kill, approve, reject, health, escape, interrupt, pane, metrics, summary, bash, command, latency, batch, pipelines, swarm (#441)
- **MCP Resources**: 4 resources for session data (#442)
- **MCP Prompts**: implement_issue, review_pr, debug_session (#443)
- **CI file audit job**: Prevent tracking junk files (#439)

### Fixed
- **Path traversal bypass**: Validate workDir and session paths (#434, #435)
- **Auth bypass on hook endpoints**: Require session validation (#394)
- **Timing attack on token comparison**: Use `timingSafeEqual` (#402)
- **SSE bearer token fallback**: Retry with backoff instead (#408)
- **MCP server polish**: Version, auth, errors, graceful degradation (#445)
- **WorkDir validation**: Return 400 when workDir does not exist (#458)
- **README field name**: Correct brief→prompt (#396)
- **CI audit step ordering**: Move before build steps

### Internal
- MCP server test suite + README documentation (#444)
- Repo hygiene cleanup — remove junk files + update .gitignore (#453)
- Add FUNDING.yml — GitHub Sponsors + Ko-fi
```

- [ ] **Step 2: Verify the edit**

Run: `head -30 CHANGELOG.md`
Expected: See `## [2.0.0]` section at top, followed by `## [1.4.1]`, then `## [1.4.0]`.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "chore: backfill CHANGELOG for v2.0.0 — Issue #470"
```

---

### Task 3: Create release-please config files

**Files:**
- Create: `.release-please-manifest.json`
- Create: `release-please-config.json`

- [ ] **Step 1: Create `.release-please-manifest.json`**

```json
{".": "2.0.0"}
```

This tells release-please the current released version is 2.0.0. It will only look at commits after the v2.0.0 tag for the next release.

- [ ] **Step 2: Create `release-please-config.json`**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "aegis-bridge",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": false,
      "bump-patch-for-minor-pre-major": false,
      "draft": false,
      "prerelease": false,
      "include-component-in-tag": false,
      "changelog-sections": [
        {"type": "feat", "section": "Features", "hidden": false},
        {"type": "fix", "section": "Bug Fixes", "hidden": false},
        {"type": "perf", "section": "Performance", "hidden": false},
        {"type": "revert", "section": "Reverts", "hidden": false},
        {"type": "docs", "section": "Documentation", "hidden": false},
        {"type": "chore", "section": "Internal", "hidden": true},
        {"type": "test", "section": "Tests", "hidden": true},
        {"type": "ci", "section": "CI", "hidden": true},
        {"type": "refactor", "section": "Internal", "hidden": true},
        {"type": "temp", "section": "Internal", "hidden": true}
      ]
    }
  }
}
```

Key decisions in this config:
- `hidden: true` for `chore`, `test`, `ci`, `refactor`, `temp` — they don't appear in the changelog (internal types)
- `feat`, `fix`, `perf`, `docs` are visible — user-facing changes
- `include-component-in-tag: false` — single package, no component prefix in tags

- [ ] **Step 3: Verify both files are valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.release-please-manifest.json','utf8')); console.log('manifest OK')" && node -e "JSON.parse(require('fs').readFileSync('release-please-config.json','utf8')); console.log('config OK')"`
Expected: `manifest OK` then `config OK`

- [ ] **Step 4: Commit**

```bash
git add .release-please-manifest.json release-please-config.json
git commit -m "chore: add release-please config and manifest — Issue #470"
```

---

### Task 4: Create release-please workflow

**Files:**
- Create: `.github/workflows/release-please.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
```

How this works:
- Fires on every push to `main`
- Reads `release-please-config.json` and `.release-please-manifest.json` from the repo root
- If conventional commits exist since last tag: creates/updates a Release PR with version bump + changelog
- If a Release PR is merged: creates git tag + GitHub Release automatically
- The tag push then triggers `release.yml` for npm publish

- [ ] **Step 2: Validate YAML syntax**

Run: `node -e "const y=require('js-yaml'); require('fs').readFileSync('.github/workflows/release-please.yml','utf8'); console.log('YAML readable')" 2>/dev/null || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release-please.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-please.yml
git commit -m "ci: add release-please workflow — Issue #470"
```

---

### Task 5: Modify release.yml — remove github-release job

**Files:**
- Modify: `.github/workflows/release.yml`

The current file has 3 jobs: `test`, `publish-npm`, `github-release`. We remove `github-release` because release-please handles tag + GitHub Release creation. `test` and `publish-npm` remain unchanged.

- [ ] **Step 1: Replace the entire file content**

The new file removes the `github-release` job. `test` and `publish-npm` stay identical:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  id-token: write

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npx tsc --noEmit
      - run: npm run build
      - run: npm test

  publish-npm:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Changes from current:
- Removed the entire `github-release` job (lines 44-63 of the original)
- `test` and `publish-npm` jobs are unchanged

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Verify both jobs remain**

Run: `grep -c 'runs-on:' .github/workflows/release.yml`
Expected: `2` (test + publish-npm)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: remove github-release job from release.yml (release-please handles this) — Issue #470"
```

---

### Task 6: Modify ci.yml — add PR title lint job

**Files:**
- Modify: `.github/workflows/ci.yml`

Add a new `lint-pr-title` job that validates PR titles follow conventional commit format using `amannn/action-semantic-pull-request@v5`. This job only runs on pull requests (not push to main).

- [ ] **Step 1: Add the new job**

Append the following job at the end of `.github/workflows/ci.yml`, after the existing `test` job:

```yaml

  lint-pr-title:
    runs-on: ubuntu-latest
    if: ${{ github.event_name == 'pull_request' }}
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: |
            feat
            fix
            chore
            test
            docs
            ci
            perf
            refactor
            temp
          requireScope: false
```

This job:
- Only runs on `pull_request` events (not `push` to main)
- Validates the PR title starts with a conventional commit prefix from the allowed list
- `requireScope: false` — allows both `feat:` and `feat(scope):`
- If invalid, CI fails with a helpful error message explaining the format

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Verify both jobs exist**

Run: `grep -c 'runs-on:' .github/workflows/ci.yml`
Expected: `2` (test + lint-pr-title, but note test runs in a matrix so there are 2 `runs-on` lines for test + 1 for lint-pr-title = 3 total). Actually check with: `grep '^\s\s[a-z-]*:' .github/workflows/ci.yml | head -5`
Expected: See both `test:` and `lint-pr-title:` job names.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add PR title validation with conventional commit check — Issue #470"
```

---

### Task 7: Create feature branch and push PR

**Files:** None (git operations)

Per CLAUDE.md convention: feature branches → PR → squash merge to main. Tasks 1-6 committed on a local branch. Now push and create the PR.

- [ ] **Step 1: Verify all 6 commits are on the current branch**

```bash
git log --oneline -6
```

Expected: See 6 commits from Tasks 1-6 (backfill CHANGELOG, config files, release-please workflow, modified release.yml, modified ci.yml).

- [ ] **Step 2: Push branch to remote**

```bash
git push -u origin chore/release-automation
```

- [ ] **Step 3: Create PR**

```bash
gh pr create \
  --base main \
  --head chore/release-automation \
  --title "chore: automated release process with release-please — Issue #470" \
  --body "$(cat <<'EOF'
## Summary
- Backfill CHANGELOG.md for v1.4.1 and v2.0.0
- Add release-please config and manifest for automated version management
- Add release-please workflow to create/maintain Release PRs
- Remove github-release job from release.yml (release-please handles this)
- Add PR title validation (conventional commit format) to ci.yml

Closes #470

## Test plan
- [ ] Verify CHANGELOG.md backfill is accurate
- [ ] Verify release-please config JSON is valid
- [ ] Verify release.yml still has test + publish-npm jobs
- [ ] Verify ci.yml lint-pr-title job syntax
- [ ] After merge: create v2.0.0 tag and verify release-please bootstraps correctly
EOF
)"
```

Expected: PR created with URL output. CI runs and passes (the lint-pr-title job will be skipped since this is on a branch, not a PR event — actually it will run since the PR triggers the CI workflow).

- [ ] **Step 4: Wait for CI to pass, then squash-merge**

```bash
gh pr merge <PR_NUMBER> --squash --subject "chore: automated release process with release-please — Issue #470" --body "Backfill CHANGELOG, add release-please automation, remove manual release job, add PR title lint."
```

---

### Task 8: Create v2.0.0 tag and GitHub Release

**Files:** None (git tag operation)

After the PR merges to main, pull latest and create the v2.0.0 tag. The tag push triggers the (now modified) release.yml — which has only test + publish-npm jobs. We manually create the GitHub Release since release-please hasn't bootstrapped yet.

- [ ] **Step 1: Pull merged main**

```bash
git checkout main
git pull origin main
```

- [ ] **Step 2: Create annotated tag**

```bash
git tag -a v2.0.0 -m "v2.0.0"
```

- [ ] **Step 3: Push the tag**

```bash
git push origin v2.0.0
```

This triggers `release.yml`:
- `test` job: runs CI (will pass)
- `publish-npm` job: will **fail** because `NPM_TOKEN` is not configured (expected, resolved in Task 10)

- [ ] **Step 4: Create GitHub Release manually (this one time only)**

Since the github-release job was removed and release-please hasn't bootstrapped yet, create the v2.0.0 release manually:

```bash
gh release create v2.0.0 \
  --title "v2.0.0" \
  --notes "$(sed -n '/## \[2.0.0\]/,/## \[/p' CHANGELOG.md | head -n -1)"
```

Expected: GitHub Release created with the backfilled CHANGELOG content.

- [ ] **Step 5: Verify release-please bootstraps on the merge commit**

The release-please workflow fired when the PR merged to main. Check:

```bash
gh run list --workflow="Release Please" --limit=3
```

Expected: At least one successful run. Since v2.0.0 tag now exists and matches the manifest (`{".": "2.0.0"}`), release-please should NOT create a Release PR yet.

- [ ] **Step 6: Verify no stale Release PR was created**

```bash
gh pr list --search "chore(main): release" --state open
```

Expected: No open PRs.

---

### Task 9: Verify the full release cycle

**Files:** None (verification only)

After the next `feat:` or `fix:` PR merges to main, verify that release-please creates a Release PR automatically.

**Prerequisite:** At least one `feat:` or `fix:` commit must land on main after Task 8.

- [ ] **Step 1: After a feat/fix commit lands on main, check for Release PR**

```bash
gh pr list --search "chore(main): release" --state open
```

Expected: One open PR titled `chore(main): release 2.0.1` (or `2.1.0` if a feat landed).

- [ ] **Step 2: Review the Release PR**

```bash
gh pr view <PR_NUMBER> --json title,body
```

Expected:
- Title: `chore(main): release X.Y.Z`
- Body: contains changelog entries grouped by type (Features, Bug Fixes)
- Diff: version bump in `package.json`, new section in `CHANGELOG.md`

- [ ] **Step 3: Do NOT merge the Release PR yet**

Leave it open as verification that the system works. The first real release will happen when the accumulation threshold is met (5+ feat/fix commits) or you decide it's time.

---

### Task 10: Configure NPM_TOKEN (manual, done by maintainer)

**Files:** None (GitHub settings operation)

This must be done manually by the repo owner. Cannot be automated.

- [ ] **Step 1: Create npm automation token**

Go to https://www.npmjs.com → Access Tokens → Generate New Token → Classic Token → Automation.

Copy the token value. This type of token bypasses 2FA for CI publishing.

- [ ] **Step 2: Add NPM_TOKEN secret to GitHub repo**

Go to https://github.com/OneStepAt4time/aegis/settings/secrets/actions → New repository secret.
- Name: `NPM_TOKEN`
- Value: paste the token

- [ ] **Step 3: Verify npm publish works**

Test locally first:

```bash
npm publish --dry-run
```

Expected: Dry run succeeds showing package contents that would be published.

Then, when ready to publish v2.0.0, either:
- Merge the first Release PR (which triggers release.yml → publish-npm), OR
- Manually re-run the failed publish-npm job:

```bash
gh run list --workflow=Release --limit=1 --json databaseId --jq '.[0].databaseId' | xargs -I{} gh run rerun {}
```
