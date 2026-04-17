# EPIC: Phase 3 — Team & Early-Enterprise

**Phase:** 3
**Status:** ⏸ **NOT ACTIVE — do not open GitHub issues yet**
**Activation trigger:** Phase 2 closed AND at least one external team has
requested at least one of: SSO, multi-tenancy, or Postgres persistence.
**Wall-clock target:** 3–6 months part-time after activation, demand-driven
**Parent roadmap:** [ROADMAP.md](../../../ROADMAP.md)
**Positioning:** [ADR-0023](../../../docs/adr/0023-positioning-claude-code-control-plane.md)
**Gap analysis:** [docs/enterprise/00-gap-analysis.md](../../../docs/enterprise/00-gap-analysis.md)

## Goal

Let a real external team of 10 + people run Aegis in production under their
existing identity provider, with trace-level observability and language SDKs
for their internal tooling.

Exit criterion: a team can deploy Aegis, connect it to their IdP (Entra ID /
Google Workspace / Okta / Keycloak / Authentik), enforce per-tenant
isolation, and generate a TypeScript or Python SDK from the OpenAPI contract.

## Scope

Demand-driven. Every item below must be justified by at least one real user
request before work begins; speculative work is deferred to Phase 4.

| # | Item | Gap ref |
|---|---|---|
| 3.1 | Pluggable `SessionStore` interface + `PostgresStore` | P0-5 |
| 3.2 | Pipeline state persistence on the same interface | P0-5 |
| 3.3 | OpenTelemetry end-to-end: HTTP → service → tmux → channels | P1-3 / ADR-0017 |
| 3.4 | Generated TypeScript SDK from OpenAPI | P2-5 |
| 3.5 | Generated Python SDK from OpenAPI | P2-5 |
| 3.6 | SSO / OIDC for dashboard (Entra ID, Google, Okta, Keycloak, Authentik) | P1-2 |
| 3.7 | OAuth2 device flow for CLI (`ag login`) | P1-2 |
| 3.8 | Multi-tenancy primitives: `tenantId` on keys / sessions / audit | P1-1 |
| 3.9 | Workdir namespacing per tenant | P1-1 |
| 3.10 | Dashboard list virtualization (transcripts, session history) | P1-7 |
| 3.11 | Dashboard full a11y pass (focus traps, ARIA, contrast) | P1-7 |
| 3.12 | i18n scaffolding (EN + IT to start) | — |

## Architectural decisions to formalise during Phase 3

Each of these needs its own ADR before implementation:

- ADR-TBD: `SessionStore` interface and lifecycle semantics.
- ADR-TBD: Tenant-aware authorization model (extension of ADR-0019).
- ADR-TBD: OIDC trust model, claim mapping, and logout semantics.
- ADR-TBD: SDK generation pipeline and release cadence.

## Explicitly out of scope for Phase 3

- Redis-backed state or horizontal scaling (Phase 4).
- SaaS / hosted offering (off the table).
- SOC2 / compliance artefacts (Phase 4).
- Secrets-manager integrations beyond environment variables (Phase 4).

## Activation checklist

- [ ] Phase 2 exit checklist satisfied.
- [ ] At least one external user request for an SSO, multi-tenancy, or
  Postgres feature is on record (GitHub issue or documented conversation).
- [ ] Update this file: status → **ACTIVE**, activation date set.
- [ ] Open tracking issue **"EPIC: Phase 3 — Team & Early-Enterprise"**.
- [ ] Open sub-issues referencing this epic.
- [ ] ROADMAP.md updated.

## Exit checklist

- [ ] All items shipped, or consciously demoted to Phase 4 with written
  rationale.
- [ ] OpenAPI is the single source of truth; SDK releases are automated.
- [ ] At least one external team is running Aegis in production under their
  IdP.
