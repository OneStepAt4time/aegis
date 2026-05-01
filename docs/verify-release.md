# Verifying Aegis Releases

This guide explains how to verify the authenticity and integrity of an Aegis release.

## Release Integrity

Every Aegis release is signed and attested using industry-standard tools.

### Verify with SHA-256

Download the release and verify its SHA-256 hash:

```bash
# Download the release tarball
curl -LO https://github.com/OneStepAt4time/aegis/releases/download/v0.6.0-preview/aegis-0.6.0-preview.tgz

# Verify the hash
sha256sum aegis-0.6.0-preview.tgz
```

Compare the output against the `SHA256SUMS` file published in the release assets.

### Verify npm Package

If you installed via npm, verify the package integrity:

```bash
# View the package integrity checksum
npm view @onestepat4time/aegis integrity

# Verify against published checksums
npm pack @onestepat4time/aegis --dry-run
```

## Sigstore Attestations (Beta)

Aegis releases include Sigstore attestations for npm packages, verifiable against the GitHub Actions OIDC identity.

### Install cosign

```bash
brew install cosign  # macOS
# or: go install github.com/sigstore/cosign/cmd/cosign@latest
# or: curl -sSL https://raw.githubusercontent.com/sigstore/cosign/main/release/install.sh | sh
```

### Verify npm Package Attestation

Download the Sigstore attestation bundle from the release assets, then verify:

```bash
# Download release assets
gh release download v0.6.0-preview --pattern '*.sigstore' --pattern 'checksums.txt' --dir /tmp

# Verify the attestation against the npm registry tarball
cosign verify-blob-attestation \
  --certificate-identity-regexp 'https://github.com/OneStepAt4time/aegis/.github/workflows/release\\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --bundle /tmp/package.sigstore \
  "https://registry.npmjs.org/@onestepat4time/aegis/-/aegis-0.6.0-preview.tgz"
```

### What the Attestation Proves

The Sigstore attestation binds the npm tarball SHA256 digest to the GitHub Actions workflow run that published it. Verification succeeds only if:
- The bundle was signed by GitHub Actions OIDC (GITHUB_TOKEN)
- The workflow identity matches `https://github.com/OneStepAt4time/aegis/.github/workflows/release.yml@refs/tags/v*`
- The digest in the predicate matches the downloaded tarball

### Container Images (not yet implemented)

Container image signing will be added once the container build pipeline is in place.

## Verifying the GitHub Release

### Check the GitHub Actions Workflow

All releases are built via GitHub Actions. Verify the workflow ran successfully:

1. Go to the release page: `https://github.com/OneStepAt4time/aegis/releases/tag/vX.Y.Z`
2. Click **Actions** → look for the `Release` workflow
3. Verify all jobs passed (build, test, attest)

### SDK Release Automation

Pushing a `v*` tag runs `.github/workflows/release.yml`. In addition to the root
`@onestepat4time/aegis` npm package, the workflow publishes:

- `@onestepat4time/aegis-client` from `packages/client` to npm.
- `aegis-python-client` from `packages/python-client` to PyPI.

The release workflow regenerates the root OpenAPI contract, regenerates each SDK
from that contract, builds the SDK package, and then publishes it. npm packages
use provenance and public access. Tags containing `-preview` publish npm
packages with the `preview` dist-tag; all other release tags publish with
`latest`.

The validation gates are:

- `npm run openapi:check`
- `npm run sdk:ts:check`
- `npm run sdk:py:check`
- the normal release build and test steps

PyPI publishing uses trusted publishing via GitHub OIDC; no PyPI token is stored
in the repository. Maintainers must configure the `aegis-python-client` project
on PyPI with a trusted publisher for repository `OneStepAt4time/aegis`, workflow
`.github/workflows/release.yml`, and environment `pypi`.

PyPI package versions must be PEP 440-compatible, so the Python SDK release job
normalizes Aegis tag versions before writing `packages/python-client/pyproject.toml`
and `packages/python-client/src/aegis_python_client/__init__.py`. The root npm
package and TypeScript SDK keep the original tag version.

| Aegis tag version | Python SDK version |
|-------------------|--------------------|
| `X.Y.Z` | `X.Y.Z` |
| `X.Y.Z-preview` | `X.Y.Z.dev0` |
| `X.Y.Z-alpha` | `X.Y.Za0` |
| `X.Y.Z-beta` | `X.Y.Zb0` |
| `X.Y.Z-rc` | `X.Y.Zrc0` |

Numeric suffixes on prerelease tags are preserved, for example `X.Y.Z-rc.1`
becomes `X.Y.Zrc1`.

### Verify the Author

Release commits are signed by the Aegis GitHub Bot (`github-actions[bot]`). Check the commit signature:

```bash
git show --show-signature <release-commit-sha>
```

## Reporting Suspicious Releases

If you find a release that appears tampered with:

1. **Do not install it**
2. Check the [security policy](../../SECURITY.md)
3. Report to: `security@onestepat4time.com`
4. Or file a private security advisory on GitHub

## Release Transparency

All Aegis releases are recorded in the public GitHub release changelog. The `CHANGELOG.md` in the repository is auto-generated by release-please and lists every change since v0.1.0.

## Version Numbering

Aegis uses semantic versioning: `MAJOR.MINOR.PATCH-preview`

| Version | Meaning |
|---------|---------|
| `0.6.0-preview` | Pre-release, v0.6.0 with preview qualifier |
| `0.5.3` | Stable release |
| `1.0.0` | First stable major release |

The `preview` suffix indicates the API may change. Production deployments should pin to exact versions.
