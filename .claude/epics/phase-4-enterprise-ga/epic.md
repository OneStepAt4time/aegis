# EPIC: Phase 4 — Enterprise GA

**Phase:** 4
**Status:** ⏸ **NOT ACTIVE — do not open GitHub issues yet**
**Activation trigger:** Phase 3 closed AND at least one enterprise evaluator
has produced a written requirement (security questionnaire, procurement
checklist, or signed LOI) that cannot be satisfied by Phase 3 features.
**Wall-clock target:** 6–12 + months part-time after activation, strictly
demand-driven
**Parent roadmap:** [ROADMAP.md](../../../ROADMAP.md)
**Positioning:** [ADR-0023](../../../docs/adr/0023-positioning-claude-code-control-plane.md)
**Gap analysis:** [docs/enterprise/00-gap-analysis.md](../../../docs/enterprise/00-gap-analysis.md)

## Goal

Close the remaining P2 items from the gap analysis so Aegis can pass a
standard enterprise procurement and security review. Nothing here should be
built speculatively — each item activates only on documented demand.

Exit criterion: Aegis can be handed to an enterprise evaluator with a
one-page security overview, a filled SIG-Lite, a Helm chart, a verified
signed release, and a DR runbook, and the answer comes back within a week.

## Scope

| # | Item | Gap ref |
|---|---|---|
| 4.1 | Horizontal scaling: Redis-backed session state, sticky routing, tmux-socket affinity | P2-1 |
| 4.2 | Compliance scaffolding: SOC2 control mapping, data-retention policy, DPA template, extended SBOM retention | P2-2 |
| 4.3 | Disaster-recovery runbook: export / import session state, audit-chain backup, key-material recovery | P2-6 |
| 4.4 | Secrets-manager integrations: Vault / AWS KMS / Azure Key Vault | P2-7 |
| 4.5 | Observability bundles: Grafana dashboards, alert rules, OTLP exporter docs, Datadog integration | P2-8 |
| 4.6 | Air-gapped deployment guide | P2-9 |
| 4.7 | Per-tenant quotas: concurrent sessions, token cap, USD spend cap | P2-10 |
| 4.8 | Billing / metering hooks (usage records from per-session token cost) | P2-11 |
| 4.9 | Webhook signature-verification helper SDK | P2-12 |
| 4.10 | API versioning policy + deprecation headers + `/v2/` migration doc | P2-4 |

## Explicitly out of scope, permanently

Locked decisions from ADR-0023 and the positioning rule; will not be
reopened inside Phase 4 without a maintainer-approved ADR amendment:

- Rewrite in another language. Rust is the only candidate if it ever
  happens, and only on proven demand.
- Open-core `AEGIS_EDITION` flag. Aegis stays single-edition MIT.
- First-class integrations with Claude Code competitors (Gemini CLI, etc.).
- A SaaS / hosted offering before external funding exists.

## Activation checklist

- [ ] Phase 3 exit checklist satisfied.
- [ ] Written enterprise requirement on record (issue link, procurement doc,
  or LOI reference).
- [ ] Legal review of licensing implications for paid support / SLAs if
  relevant.
- [ ] Update this file: status → **ACTIVE**, activation date set.
- [ ] Open tracking issue **"EPIC: Phase 4 — Enterprise GA"**.
- [ ] Open sub-issues referencing this epic.
- [ ] ROADMAP.md updated.

## Exit checklist

- [ ] All demand-justified items shipped.
- [ ] Version graduates from `preview` to stable `1.0.0`.
- [ ] At least one enterprise customer is running Aegis under a documented
  SLA or support arrangement.
