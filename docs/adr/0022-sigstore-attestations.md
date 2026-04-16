# ADR-0022: Sigstore Attestations for npm and Container Artifacts

## Status
Proposed

## Context

The release pipeline already generates a CycloneDX SBOM, SHA-256 checksums, and publishes to npm with provenance using OIDC (`id-token: write`). Container images are pushed to `ghcr.io/onestepat4time/aegis` but are not signed, and there is no public attestation artifact consumers can verify offline.

For enterprise procurement and regulated environments (SOC2, ISO 27001, FedRAMP-lite), downstream teams expect:

- **npm provenance** — already present.
- **Sigstore `.sigstore` attestations** for both npm tarballs and container images, verifiable against the GitHub workflow identity.
- A documented verifier script so consumers can gate their CI on attestation validity without learning cosign semantics.

Referenced as **P1-10** in [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md) and identified as a quick win in §12.

## Decision

Sign and attest both artifact classes using Sigstore tooling driven by the existing workflow OIDC identity.

### npm

- Continue using `npm publish --provenance` (already enabled).
- Additionally generate a `.sigstore` bundle with `cosign attest-blob` over the published tarball and attach it to the GitHub release.

### Containers

- Build with `docker/build-push-action` (already in use).
- Sign with `cosign sign --yes ghcr.io/onestepat4time/aegis@<digest>` using keyless OIDC.
- Generate an SBOM attestation: `cosign attest --predicate sbom.json --type cyclonedx …`.

### Verifier documentation

Add a `docs/verify-release.md` (separate PR) showing:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/OneStepAt4time/aegis/\.github/workflows/release\.yml@' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/onestepat4time/aegis:<tag>
```

and the equivalent `npm` tarball verification flow.

### CI

A matrix `verify` job re-runs the verification on every tag to prove the attestations are valid before announcing the release in Discord / GitHub Pages.

## Consequences

- **Pros:** satisfies supply-chain requirements common in enterprise procurement; complements existing SBOM and checksum artifacts; low effort thanks to existing OIDC permissions.
- **Cons:** adds ~30–60 s to release jobs and one additional required check; consumers with air-gapped environments must fetch Sigstore's public good-instance roots out-of-band (documented in verify guide).
- **Retention:** bump SBOM / attestation artifact retention to 365 days as part of P2-2 compliance scaffolding.

## Related

- Gap analysis: P1-10 and §12 quick win in [00-gap-analysis.md](../enterprise/00-gap-analysis.md)
- [ADR-0016](0016-release-please-github-app-token.md) — current release token model
- Companion ADRs: [ADR-0018](0018-openapi-spec-from-zod.md), [ADR-0021](0021-sse-and-http-drain-timeouts.md)
