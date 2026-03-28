# Release Automation Design

**Date:** 2026-03-28
**Issue:** [#470 — feat: automated release process](https://github.com/OneStepAt4time/aegis/issues/470)
**Status:** Design complete, pending implementation

---

## Executive Summary

Aegis needs automated release management. The current state is a manual, inconsistent process: tags are created by hand, CHANGELOG.md is stale (missing v1.4.1 and v2.0.0 entries), npm publish will fail because `NPM_TOKEN` is not configured, and the AI agent (Hephaestus) has no instructions on when or how to release.

**Chosen approach:** release-please with semi-automated workflow, inspired by OpenClaw's model.

**Why release-please:**
- Reads existing conventional commits — zero extra work per PR
- Release PR model = review gate before every release (you control when)
- Minimal config (2 JSON files + 1 workflow YAML)
- Lowest GitHub Actions minutes of all options
- Google-backed, actively maintained (6,634 stars)

**What changes:**
- release-please auto-creates a "Release PR" accumulating version bump + changelog
- You (or Hephaestus) merge the Release PR when ready
- Merge triggers tag creation + GitHub Release automatically
- Tag push triggers npm publish via existing (modified) release workflow
- PR titles validated for conventional commit format in CI

**What stays the same:**
- Conventional commit style (already in use)
- Squash-merge workflow on PRs
- SemVer versioning
- Manual control over release timing

---

## Release Flow Design

### Trigger: Accumulation threshold

Release-please runs on every push to `main`. It auto-creates/updates a Release PR. Merge it when:
- 5+ `feat`/`fix` commits have accumulated since last release, OR
- A breaking change (`feat!:` or `BREAKING CHANGE:` footer) has landed, OR
- You decide it's time

### Flow diagram

```
PR lands on main (squash-merge with conventional title)
  │
  ▼
release-please action fires
  │
  ├── Analyzes commits since last tag
  ├── Creates/updates Release PR with:
  │     ├── package.json version bump
  │     └── CHANGELOG.md update (grouped entries)
  │
  ▼
Release PR awaits review
  │
  ▼ (merge)
release-please creates:
  ├── git tag (e.g., v2.1.0)
  └── GitHub Release (from changelog)
  │
  ▼
release.yml triggers on v* tag push
  │
  ├── test job (npm ci → tsc → build → test)
  │
  ├── publish-npm job (needs: test)
  │     └── npm publish --provenance --access public
  │
  └── [github-release job REMOVED — release-please handles this]
```

### Version bumping rules

| Commit prefix | Version bump | Example |
|---|---|---|
| `fix:` | Patch (2.0.1) | `fix: deadlock in createWindow()` |
| `feat:` | Minor (2.1.0) | `feat: MCP prompts` |
| `feat!:` or `BREAKING CHANGE:` footer | Major (3.0.0) | `feat!: new session API format` |
| `chore:`, `test:`, `docs:`, `ci:` | No bump | `chore: bump dependencies` |

### Hephaestus integration

Hephaestus's workflow changes minimally:

| Aspect | Before | After |
|---|---|---|
| Commit messages | Conventional format | No change |
| PR descriptions | Ad-hoc | Write user-facing descriptions (become changelog entries) |
| Merging PRs | Merge when approved | No change |
| Release PR | N/A | Merge Release PR when threshold met (5+ feat/fix) |
| Breaking changes | Not flagged | Use `feat!:` prefix or `BREAKING CHANGE:` footer |
| Version bumping | Manual `npm version` | Automated by release-please |

**Instructions to add to Hephaestus workflow:**
- When writing PR descriptions, include a 1-2 sentence user-facing summary in the first paragraph. release-please uses this as the changelog entry.
- For breaking changes, use `feat!:` prefix or add `BREAKING CHANGE: <description>` to the commit footer.
- After merging 5+ feat/fix PRs, check if a Release PR exists and merge it.

---

## Workflow Files

### 1. `.github/workflows/release-please.yml` (NEW)

Creates and maintains the Release PR. On merge, creates the tag and GitHub Release.

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
          # This is a release-please manifest release (config in repo root)
          release-type: node
          # The action reads release-please-config.json and .release-please-manifest.json
          # from the repository root automatically.
```

**Notes:**
- Runs on every push to `main`. If no conventional commits since last tag, it does nothing.
- Creates a PR titled `chore(main): release X.Y.Z` with version bump + changelog.
- On PR merge: creates git tag + GitHub Release, then the tag push triggers `release.yml`.

### 2. `.github/workflows/release.yml` (MODIFIED)

Triggers on tag push. Runs tests, publishes to npm. **The `github-release` job is removed** because release-please handles tag + GitHub Release creation.

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

**Changes from current release.yml:**
- Removed `github-release` job (release-please handles this)
- Everything else stays the same

### 3. `.github/workflows/ci.yml` (MODIFIED)

Adds a PR title validation step. Ensures squash-merged commits follow conventional format.

```yaml
# Add this job to the existing ci.yml:

  lint-pr-title:
    runs-on: ubuntu-latest
    if: ${{ github.event_name == 'pull_request' }}
    steps:
      - uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          # Require conventional commit prefix in PR title
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
          # Allow scoped prefixes like feat(scope):
          requireScope: false
```

**Notes:**
- Only runs on PRs (not push to main)
- Validates that PR titles start with a conventional commit prefix
- If a PR title doesn't match, CI fails with a helpful error message
- External contributors see the error and can update their title

---

## Config Files

### `.release-please-manifest.json` (NEW)

Tracks the last released version. release-please reads this to know what version to bump from.

```json
{".": "2.0.0"}
```

### `release-please-config.json` (NEW)

Configures release-please behavior for the repository.

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

**Key decisions:**
- `chore`, `test`, `ci`, `refactor`, `temp` types are `hidden: true` — they contribute to version bumping but don't appear in the changelog. This keeps changelogs user-facing.
- `feat`, `fix`, `perf`, `docs` are visible — these are what users care about.
- `include-component-in-tag: false` — single package repo, no component prefix in tags.

---

## Migration Checklist

### Phase 1: Backfill and tag (manual, before any automation)

- [ ] **1.1** Backfill CHANGELOG.md
  - Add `## [1.4.1] - 2026-03-28` section with hotfix note
  - Add `## [2.0.0] - 2026-03-28` section with all 28 commits grouped by type
  - Commit: `chore: backfill CHANGELOG for v1.4.1 and v2.0.0`

- [ ] **1.2** Create v2.0.0 tag
  - `git tag -a v2.0.0 -m "v2.0.0"`
  - `git push origin v2.0.0`
  - This triggers release.yml → test passes → publish-npm fails (expected, no NPM_TOKEN) → github-release creates Release from CHANGELOG.md

- [ ] **1.3** Verify v2.0.0 GitHub Release was created correctly
  - Check https://github.com/OneStepAt4time/aegis/releases
  - Body should contain the backfilled changelog entries

### Phase 2: Configure npm publishing

- [ ] **2.1** Create npm automation token
  - `npm token create --read-only=false --cidr-whitelist=`
  - Or via npmjs.com → Access Tokens → Generate New Token → Automation

- [ ] **2.2** Add NPM_TOKEN secret to GitHub repo
  - Settings → Secrets and variables → Actions → New repository secret
  - Name: `NPM_TOKEN`, value: the token from 2.1

- [ ] **2.3** Test npm publish
  - Option A: Re-run the failed publish-npm job from step 1.2
  - Option B: `npm publish --dry-run` locally to verify package contents

### Phase 3: Add release-please (single PR)

- [ ] **3.1** Create feature branch `chore/release-automation`

- [ ] **3.2** Create `.release-please-manifest.json`
  ```json
  {".": "2.0.0"}
  ```

- [ ] **3.3** Create `release-please-config.json`
  - Content as specified in "Config Files" section above

- [ ] **3.4** Create `.github/workflows/release-please.yml`
  - Content as specified in "Workflow Files" section above

- [ ] **3.5** Modify `.github/workflows/release.yml`
  - Remove `github-release` job
  - Keep `test` + `publish-npm` jobs

- [ ] **3.6** Modify `.github/workflows/ci.yml`
  - Add `lint-pr-title` job with `amannn/action-semantic-pull-request@v5`

- [ ] **3.7** Commit all changes
  - `chore: add release-please automation (#470)`

- [ ] **3.8** Push branch, create PR, review, squash-merge

### Phase 4: Verify and bootstrap

- [ ] **4.1** After merge, verify release-please action runs
  - Check Actions tab for "Release Please" workflow
  - It should run on the merge commit, see the manifest at 2.0.0, tag v2.0.0 exists → no Release PR created (correct)

- [ ] **4.2** Land a test commit to verify Release PR creation
  - Merge a `fix:` or `feat:` PR
  - Verify release-please creates a Release PR with version bump + changelog

- [ ] **4.3** Test the full cycle
  - Merge the Release PR
  - Verify: tag created → release.yml fires → npm publishes → GitHub Release updated

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| npm publish fails (bad token, wrong scope) | Medium | High | Test with `--dry-run` first; keep manual publish as fallback |
| release-please creates wrong version bump | Low | Medium | Review Release PR before merging; manifest pins current version |
| Conventional commit misdetected (wrong type) | Low | Low | Release PR is reviewable; can edit changelog in the PR |
| release-please action breaks (upstream bug) | Very Low | Medium | Pin to v4 major version; can disable by removing workflow file |
| CI rejection on PR title frustrates external contributors | Medium | Low | Error message includes guidance; you can squash-merge with correct title |
| Backfilled CHANGELOG entries inaccurate | Low | Low | Manual review before tagging; based on actual git log + existing release bodies |
| release-please and existing release.yml conflict | Very Low | High | release-please creates tags/releases; release.yml only publishes npm now — no overlap |

### Rollback plan

Each phase is a separate commit. If anything goes wrong:

- **Phase 1:** Tag can be deleted with `git tag -d v2.0.0 && git push origin :refs/tags/v2.0.0`. GitHub Release can be deleted via UI.
- **Phase 2:** NPM_TOKEN can be rotated/removed from GitHub secrets. npm unpublish within 72 hours if needed.
- **Phase 3:** Revert the PR. release-please stops running. Old release.yml continues to work (restore github-release job from git history).
- **Phase 4:** Delete the Release PR. No harm done — no tag or release created until merged.

---

## Files Changed Summary

| File | Action | Description |
|---|---|---|
| `CHANGELOG.md` | Modify | Backfill v1.4.1 and v2.0.0 entries |
| `.release-please-manifest.json` | Create | Version manifest: `{".": "2.0.0"}` |
| `release-please-config.json` | Create | Release-please configuration |
| `.github/workflows/release-please.yml` | Create | Release PR automation |
| `.github/workflows/release.yml` | Modify | Remove github-release job |
| `.github/workflows/ci.yml` | Modify | Add PR title lint job |

---

## Open Questions (resolved during implementation)

- **NPM_TOKEN scope:** Needs "Automation" type token for CI publishing. Requires npm 2FA to be configured with OTP bypass for automation tokens.
- **Accumulation threshold:** Starting at 5+ feat/fix commits. Can be tuned based on cadence.
- **GitHub Environment for publish:** Optional enhancement — add a `npm-publish` GitHub Environment with required reviewers for production safety. Can be added later.
