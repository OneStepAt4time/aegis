# EPIC: Phase 1 — Foundations

**Phase:** 1 (Foundations)
**Wall-clock target:** 1–2 months part-time
**Parent roadmap:** [ROADMAP.md](../../ROADMAP.md)
**Positioning:** [ADR-0023](../../docs/adr/0023-positioning-claude-code-control-plane.md)

## Goal

Make Aegis safe, contract-first, and supply-chain-verifiable. Exit criterion:
an external reviewer can verify the release, read an OpenAPI contract, and run
Aegis without exposing the host to env-based RCE.

## Issues

> These are opened on GitHub as individual issues, all linked to the Epic
> tracker issue titled **"EPIC: Phase 1 — Foundations"**. Labels:
> `phase-1`, plus `security`, `api`, or `supply-chain` as appropriate.

### 1.1 — Credential scan in `hygiene-check`
**Labels:** `phase-1`, `security`, `quick-win`
**Acceptance criteria:**
- [ ] `scripts/hygiene-check.cjs` fails the gate when tracked files contain
  patterns for `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `ANTHROPIC_BASE_URL` values (not names), generic bearer tokens, and common
  cloud-provider credentials.
- [ ] False-positive denylist for documentation examples (explicit allow
  markers).
- [ ] Test fixtures covering positive and negative cases.
- [ ] Runs in < 2 s on the full tree.

### 1.2 — Env-var denylist at session create
**Labels:** `phase-1`, `security`
**ADR:** [ADR-0020](../../docs/adr/0020-env-var-denylist.md)
**Acceptance criteria:**
- [ ] Constant `ENV_DENYLIST` plus `refine()` on the `env` Zod schema in
  `src/validation.ts`.
- [ ] Whitelist for BYO-LLM variables (`ANTHROPIC_BASE_URL`,
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_DEFAULT_*_MODEL`, `API_TIMEOUT_MS`).
- [ ] Value hardening: strip CR/LF, reject control chars, cap at 8 KiB.
- [ ] Config overrides: `AEGIS_ENV_DENYLIST` (additive),
  `AEGIS_ENV_ADMIN_ALLOWLIST`.
- [ ] Audit record on every rejection with action `session.env.rejected`.
- [ ] Tests covering all sensitive variables on Linux/macOS/Windows names.

### 1.3 — Session ownership authz on action routes
**Labels:** `phase-1`, `security`
**ADR:** [ADR-0019](../../docs/adr/0019-session-ownership-authz.md)
**Acceptance criteria:**
- [ ] `requireSessionOwnership()` helper in `src/routes/context.ts`.
- [ ] Applied to `send`, `command`, `bash`, `approve`, `reject`, `kill`,
  `interrupt`, `escape`.
- [ ] Admin role bypasses the check.
- [ ] Config flag `AEGIS_ENFORCE_SESSION_OWNERSHIP` (default `true`).
- [ ] Audit emission for allowed and denied attempts.
- [ ] Tests extending `session-ownership-*.test.ts`.

### 1.4 — OpenAPI 3.1 generated from Zod
**Labels:** `phase-1`, `api`
**ADR:** [ADR-0018](../../docs/adr/0018-openapi-spec-from-zod.md)
**Acceptance criteria:**
- [ ] `@asteasolutions/zod-to-openapi` (or `zod-openapi`) wired in.
- [ ] All routes register an OpenAPI descriptor alongside the Zod schema.
- [ ] `GET /v1/openapi.json` serves the document.
- [ ] Build writes `openapi.yaml` at repo root.
- [ ] CI contract job diffs served doc vs committed `openapi.yaml`.
- [ ] `docs/api-reference.md` links to the generated contract as source of
  truth.

### 1.5 — SSE idle timeout and HTTP drain on shutdown
**Labels:** `phase-1`, `reliability`
**ADR:** [ADR-0021](../../docs/adr/0021-sse-and-http-drain-timeouts.md)
**Acceptance criteria:**
- [ ] SSE per-connection last-write tracking; heartbeat after
  `AEGIS_SSE_IDLE_MS`, close after `AEGIS_SSE_CLIENT_TIMEOUT_MS`.
- [ ] Outgoing hook / webhook calls wrapped with `AbortSignal.timeout`.
- [ ] Shutdown sequence: flip health to `draining` → `app.close()` with grace
  → emit `event: shutdown` on SSE → kill sessions → flush audit → exit.
- [ ] All timeouts configurable under `AEGIS_*` in `src/config.ts` and
  documented in `docs/deployment.md`.

### 1.6 — Dashboard E2E in PR CI
**Labels:** `phase-1`, `ci`
**Acceptance criteria:**
- [ ] Playwright suite runs on PRs targeting `develop`.
- [ ] At least the `login`, `session-list`, `audit` specs are required.
- [ ] Matrix restricted to one browser (Chromium) for PR; full matrix on tag.
- [ ] Failing screenshots uploaded as artefacts.

### 1.7 — Branch coverage ≥ 65 %
**Labels:** `phase-1`, `ci`
**Acceptance criteria:**
- [ ] `vitest.config.ts` raised: `branches: 65`.
- [ ] Dashboard `vitest.config.ts` unchanged (already 70).
- [ ] Any file below threshold is either excluded with justification or given
  new tests.

### 1.8 — Sigstore attestations for npm and container images
**Labels:** `phase-1`, `supply-chain`
**ADR:** [ADR-0022](../../docs/adr/0022-sigstore-attestations.md)
**Acceptance criteria:**
- [ ] `cosign attest-blob` over the published npm tarball; bundle attached to
  the GitHub release.
- [ ] `cosign sign` on `ghcr.io/onestepat4time/aegis@<digest>`.
- [ ] `cosign attest --type cyclonedx --predicate sbom.json` attached.
- [ ] New `docs/verify-release.md` with copy-pasteable verification commands.
- [ ] CI `verify` matrix job re-runs verification after publish.

## Issue opening plan

The suggested order for opening PRs:

1. **1.1** (credential scan) — smallest, unblocks the rest by making secrets
   leaking impossible to accidentally commit.
2. **1.2** (env-var denylist).
3. **1.3** (session ownership authz) — builds on the denylist mindset.
4. **1.4** (OpenAPI) — larger; can be split into scaffolding + per-route
   sub-PRs.
5. **1.5** (SSE + drain).
6. **1.6** + **1.7** (CI hardening) — can ship together.
7. **1.8** (Sigstore) — last; benefits from a green CI baseline.

Each PR targets `develop`, follows the rules in
[.claude/rules/branching.md](../rules/branching.md),
[.claude/rules/commits.md](../rules/commits.md), and
[.claude/rules/prs.md](../rules/prs.md).

## Exit checklist

- [ ] All eight issues closed.
- [ ] `ROADMAP.md` Phase 1 checklist all ticked.
- [ ] `CHANGELOG.md` updated via release-please.
- [ ] An external tester (one of Emanuele's friends) has installed Aegis from
  the signed release and reported their experience.
