# EPIC: Phase 3 — Team & Early-Enterprise

**Phase:** 3
**Status:** ✅ **ACTIVE** (activated 2026-04-27)
**Activation trigger:** Phase 2 closed ✅ AND at least one external team has
requested at least one of: SSO, multi-tenancy, or Postgres persistence ✅
**Activation record:** Ema requested Postgres persistence (shipped #2201) and
SSO for team use. Phase 2 exit checklist satisfied.
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

| # | Item | Gap ref | Status |
|---|---|---|---|
| 3.1 | Pluggable `SessionStore` interface + `PostgresStore` | P0-5 | ✅ Shipped (#2201) |
| 3.2 | Pipeline state persistence on the same interface | P0-5 | ✅ Shipped (#2253) |
| 3.3 | OpenTelemetry end-to-end: HTTP → service → tmux → channels | P1-3 / ADR-0017 | ✅ Shipped (#2242) |
| 3.4 | Generated TypeScript SDK from OpenAPI | P2-5 | ✅ Shipped (#2232) |
| 3.5 | Generated Python SDK from OpenAPI | P2-5 | ✅ Shipped (#2234) |
| 3.6 | SSO / OIDC for dashboard (Entra ID, Google, Okta, Keycloak, Authentik) | P1-2 | ✅ Shipped (#2325) |
| 3.7 | OAuth2 device flow for CLI (`ag login`) | P1-2 | ✅ Shipped (#2311, #2316) |
| 3.8 | Multi-tenancy primitives: `tenantId` on keys / sessions / audit | P1-1 | ✅ Shipped (#2244) |
| 3.9 | Workdir namespacing per tenant | P1-1 | ✅ Shipped (#2252) |
| 3.10 | Dashboard list virtualization (transcripts, session history) | P1-7 | ✅ Shipped (#2181) |
| 3.11 | Dashboard full a11y pass (focus traps, ARIA, contrast) | P1-7 | ✅ Shipped (#2230) |
| 3.12 | i18n scaffolding (EN + IT to start) | — | ✅ Shipped (#2235, #2241) |

## Architectural decisions formalised during Phase 3

Completed decisions:

- [ADR-0025](../../../docs/adr/0025-tenant-authz-model.md): Tenant-aware authorization model.
- [ADR-0026](../../../docs/adr/0026-oidc-trust-model.md): OIDC trust model, claim mapping, and logout semantics.

Remaining follow-up documentation candidates:

- `SessionStore` lifecycle semantics ADR, if the abstraction changes again.
- SDK generation pipeline and release cadence ADR, before further automation.

## Explicitly out of scope for Phase 3

- Redis-backed state or horizontal scaling (Phase 4).
- SaaS / hosted offering (off the table).
- SOC2 / compliance artefacts (Phase 4).
- Secrets-manager integrations beyond environment variables (Phase 4).

## Activation checklist

- [x] Phase 2 exit checklist satisfied.
- [x] At least one external user request for an SSO, multi-tenancy, or
  Postgres feature is on record (GitHub issue or documented conversation).
- [x] Update this file: status → **ACTIVE**, activation date set.
- [x] Open tracking issue **"EPIC: Phase 3 — Team & Early-Enterprise"** (#1918).
- [x] Open sub-issues referencing this epic.
- [x] ROADMAP.md updated.

## Exit checklist

- [x] All items shipped, or consciously demoted to Phase 4 with written
  rationale.
- [x] OpenAPI is the single source of truth; SDK releases are automated.
- [ ] At least one external team is running Aegis in production under their
  IdP.
