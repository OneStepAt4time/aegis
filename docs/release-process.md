# Aegis Release Process

This runbook documents the production release flow from merged work on
`develop` through published artifacts. It is the maintainer-facing process for
normal preview/stable releases, recovery releases, and release hotfixes.

## Goals

The release process is designed to be:

- **deterministic**: every public artifact is created from a `v*` tag that is
  reachable from `origin/main`;
- **reviewable**: Release Please updates version/changelog state in a pull
  request before anything is published;
- **recoverable**: reruns are preferred over version bumps, and optional
  channels must not block critical package publication;
- **auditable**: `develop`, `release/<version>`, `main`, and the final tag each
  have a narrow, explicit responsibility.

## Branch and workflow model

```text
feature/fix PRs
    ↓
develop
    ↓  Create Release Branch workflow
release/<version>
    ↓  Release Please PR
release/<version> with version/changelog files
    ↓  reviewed promotion PR
main
    ↓  annotated v* tag
Release workflow publishes artifacts
```

| Surface | Responsibility |
|---|---|
| `develop` | Integration branch. Normal work lands here first. Release dry-runs run here before a release branch is cut. |
| `release/<version>` | Short-lived stabilization branch. Release Please targets this branch and updates only release metadata. |
| `main` | Production source of truth. Only reviewed promotion and authorized hotfix PRs target `main`. |
| `v*` tag | Immutable publish trigger. The release workflow publishes only after the tag preflight confirms the tag commit is reachable from `origin/main`. |
| `.github/workflows/create-release-branch.yml` | Creates `release/<version>` from `develop`, enforces version policy, and dispatches Release Please. |
| `.github/workflows/release-please.yml` | Manually dispatched by the release-branch workflow. Uses the Release Please CLI with exact `--release-as`. |
| `.github/workflows/release-dry-run.yml` | Builds and validates release artifacts without publishing on `develop`, `release/**`, and release PRs. |
| `.github/workflows/release.yml` | Publishes public artifacts from `v*` tags only. |

## Version policy

Supported release versions are:

- stable: `X.Y.Z`
- planned prerelease: `X.Y.Z-preview`, `X.Y.Z-alpha`, `X.Y.Z-beta`,
  `X.Y.Z-rc`
- recovery prerelease: `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, `X.Y.Z-rc.N`
- recovery preview: `X.Y.Z-preview.N`

Planned previews must use `X.Y.Z-preview`. Numbered previews such as
`X.Y.Z-preview.1` are recovery-only and require explicit maintainer approval
recorded in a GitHub issue. Creating the release branch requires
`recovery_release=true`, a recovery issue number, a non-empty recovery reason,
and exact typed confirmation: `RECOVERY X.Y.Z-preview.N`.

For a numbered preview tag, the annotated tag message must contain these exact
lines:

```text
recovery-release: true
recovery-issue: #<issue>
recovery-confirmation: RECOVERY X.Y.Z-preview.N
```

Do not manually edit release version files. The requested version is provided
as workflow input, and Release Please updates:

- `.release-please-manifest.json`
- `CHANGELOG.md`
- `package.json`
- `package-lock.json`
- `deploy/helm/aegis/Chart.yaml`

## Normal release checklist

### 1. Preflight `develop`

Confirm `develop` is ready and not blocked by an existing release branch.

```bash
git fetch origin --prune --tags
git diff --name-status origin/main..origin/develop
git ls-remote --heads origin 'release/*'
gh pr list --state open --base develop
gh pr list --state open --base main
```

Expected state before cutting a release:

- required `develop` checks are green;
- no unrelated open release branch exists;
- `main` and `develop` have no unexpected release-process drift;
- any hotfix that went directly to `main` has been backported to `develop`
  before the next normal release branch is cut.

### 2. Create the release branch

Run **Create Release Branch** from `main` with the intended version.

```bash
gh workflow run create-release-branch.yml \
  -R OneStepAt4time/aegis \
  --ref main \
  -f version=0.6.6-preview \
  -f source_branch=develop \
  -f recovery_release=false
```

The workflow:

1. validates the version format;
2. rejects numbered preview versions unless `recovery_release=true`;
3. requires numbered preview recovery releases to include
   `recovery_issue=<issue-number>`, `recovery_reason=<why rerun/repair is
   insufficient>`, and `recovery_confirmation="RECOVERY <version>"`;
4. refuses to create a second active `release/*` branch for normal releases;
5. creates `release/<version>` from `origin/develop`;
6. dispatches **Release Please** against that release branch.

### 3. Review the Release Please PR

Release Please opens a PR targeting `release/<version>`.

Verify all of the following before merging it:

- the title contains the exact requested version, for example
  `release 0.6.6-preview`;
- no numbered suffix appears unless this is an approved recovery release;
- changed files are limited to release metadata:
  `.release-please-manifest.json`, `CHANGELOG.md`,
  `deploy/helm/aegis/Chart.yaml`, `package-lock.json`, and `package.json`;
- the changelog compare range starts at the latest published tag, for example
  `v0.6.5-preview.3...v0.6.6-preview`;
- **Release Dry Run** passes.

If the PR has the wrong version or the wrong changelog baseline, close it,
delete the release branch, fix the workflow/configuration issue, and cut a new
release branch. Do not hand-edit the generated files to make the PR look right.

### 4. Promote release metadata to `main`

After the Release Please PR merges into `release/<version>`, open a promotion PR
to `main`.

If GitHub shows a direct `release/<version> -> main` PR as dirty because of
squash-divergent history, create a clean branch from `origin/main` and restore
only the Release Please files from `origin/release/<version>`:

```bash
git fetch origin --prune
git switch --create chore/promote-<version>-main origin/main
git restore --source origin/release/<version> -- \
  .release-please-manifest.json \
  CHANGELOG.md \
  deploy/helm/aegis/Chart.yaml \
  package-lock.json \
  package.json
git commit -m "chore(release): promote <version> to main"
git push -u origin chore/promote-<version>-main
gh pr create --base main --head chore/promote-<version>-main
```

The promotion PR must be reviewed and green. Merging it does not publish
anything; it only moves release metadata onto `main`.

### 5. Explicit go/no-go before tagging

Before creating the tag, verify `main` and the release metadata:

```bash
git fetch origin --prune --tags
git show origin/main:package.json | grep '"version"'
git show origin/main:.release-please-manifest.json
git show origin/main:deploy/helm/aegis/Chart.yaml | grep -E '^(version|appVersion):'
git show origin/main:CHANGELOG.md | grep '<version>' -n
git ls-remote --tags origin 'v<version>*'
```

Only create the tag after an explicit maintainer go/no-go. Creating and pushing
the tag starts the production release workflow.

```bash
git tag -a "v<version>" origin/main -m "Release v<version>"
git push origin "v<version>"
```

Never delete, move, or recreate a public release tag after artifacts have been
published. If a tag workflow fails after partial publication, use the recovery
rules below.

### 6. Monitor the release workflow

Watch the `Release` workflow for the pushed tag:

```bash
gh run list \
  -R OneStepAt4time/aegis \
  --workflow=release.yml \
  --limit 10

gh run watch <run-id> \
  -R OneStepAt4time/aegis \
  --interval 20 \
  --exit-status
```

The release workflow performs:

1. release tests, dashboard tests, package build, and fault harness jobs;
2. SBOM, checksum, and Sigstore predicate generation;
3. root npm publish for `@onestepat4time/aegis`;
4. TypeScript SDK publish for `@onestepat4time/aegis-client`;
5. Python SDK publish for `ag-client`;
6. GitHub Release creation/update;
7. release asset attachment: `checksums.txt`, `sbom.json`,
   `package.sigstore`;
8. Helm chart publish to the GitHub Pages Helm repository;
9. best-effort ClawHub publish using the `onestep-aegis` slug;
10. release branch cleanup when all required jobs finish.

Preview npm releases use the `preview` dist-tag. Stable releases use `latest`.
Python versions are normalized to PEP 440:

| Aegis tag | Python SDK version |
|---|---|
| `vX.Y.Z` | `X.Y.Z` |
| `vX.Y.Z-preview` | `X.Y.Z.dev0` |
| `vX.Y.Z-preview.N` | `X.Y.Z.devN` |
| `vX.Y.Z-alpha` | `X.Y.Za0` |
| `vX.Y.Z-beta` | `X.Y.Zb0` |
| `vX.Y.Z-rc` | `X.Y.Zrc0` |

### 7. Post-release verification

Verify the public artifacts and cleanup:

```bash
gh release view "v<version>" \
  --json tagName,name,isDraft,isPrerelease,publishedAt,url,assets

npm view @onestepat4time/aegis@<version> version dist.tarball --json
npm view @onestepat4time/aegis-client@<version> version dist.tarball --json
python -m pip index versions ag-client
git ls-remote --heads origin 'release/*'
```

For preview `X.Y.Z-preview`, expect PyPI package version `X.Y.Z.dev0`.

## Recovery rules

### Prefer rerun over retag

If the release workflow fails before any public artifact is published, fix the
cause and rerun the failed workflow/job when safe.

If it fails after one or more public artifacts are published:

1. do not delete or move the tag;
2. inspect which jobs succeeded and which failed;
3. rerun failed jobs only if they are idempotent or have explicit
   `skip-existing`/existence checks;
4. open or update a GitHub issue documenting the unusable artifact, failed
   rerun/repair path, and maintainer approval;
5. if a replacement artifact is required, cut an approved recovery release with
   the next numbered prerelease version.

npm versions are immutable. A failed run that already published
`@onestepat4time/aegis@<version>` or
`@onestepat4time/aegis-client@<version>` must not be recovered by trying to
republish the same npm version without the workflow's existence checks.

### Optional channels

ClawHub is an optional publish channel. Login/publish failures there must not
block the critical release artifacts: npm, SDKs, GitHub Release assets, Helm,
SBOM, checksums, and attestations. The workflow uses the `onestep-aegis` slug.

If ClawHub fails, fix the slug/token/registry issue in a reviewed PR, but do not
retag an already-published release only to make the historical run green.

### Release branch cleanup

The release workflow deletes `release/<version>` after a successful release.
If an optional or cleanup-blocking failure leaves the branch behind, delete it
only after confirming it has no content diff with `origin/main`:

```bash
git fetch origin --prune
git diff --name-status origin/main..origin/release/<version>
gh api -X DELETE repos/OneStepAt4time/aegis/git/refs/heads/release/<version>
```

## Hotfixes

Hotfix PRs may target `main` only with explicit maintainer authorization. After
the hotfix merges to `main`, backport the fix to `develop` before the next
normal release branch is cut.

Use a recovery tag only when a published artifact is unusable and a rerun cannot
repair the release. For a preview recovery, use a numbered preview version such
as `X.Y.Z-preview.1` and include the required recovery lines in the annotated
tag:

```bash
git tag -a "vX.Y.Z-preview.N" origin/main \
  -m "Release vX.Y.Z-preview.N" \
  -m "recovery-release: true" \
  -m "recovery-issue: #<issue>" \
  -m "recovery-confirmation: RECOVERY X.Y.Z-preview.N"
```

## Things not to do

- Do not push directly to `main`, `develop`, or `release/<version>`.
- Do not manually edit version/changelog files generated by Release Please.
- Do not use the Release Please action wrapper for exact planned previews; the
  Release Please workflow uses the CLI because it honors `--release-as` exactly.
- Do not reset `.release-please-manifest.json` to an older stable baseline when
  cutting a release branch; that creates an oversized changelog range.
- Do not create a `v*` tag until the promotion PR is merged to `main` and a
  maintainer has given explicit go/no-go.
- Do not rewrite an already-pushed release tag after public artifacts exist.
