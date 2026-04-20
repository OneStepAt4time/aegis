# EPIC: Phase 2 — Developer Delight + Team-Ready

**Phase:** 2
**Status:** ⏸ **NOT ACTIVE — do not open GitHub issues yet**
**Activation trigger:** Phase 1 at ≥ 80 % closed (≥ 7 of 8 issues merged) AND
an external user has installed Aegis from a signed release.
**Wall-clock target:** 2–3 months part-time after activation
**Parent roadmap:** [ROADMAP.md](../../../ROADMAP.md)
**Positioning:** [ADR-0023](../../../docs/adr/0023-positioning-claude-code-control-plane.md)
**Gap analysis:** [docs/enterprise/00-gap-analysis.md](../../../docs/enterprise/00-gap-analysis.md)

## Goal

Make Aegis the tool friends recommend, and good enough for a 10-person team
to adopt. Exit criterion: a new user can go from zero to a running,
mobile-approvable session in under 5 minutes, and a team can deploy Aegis on
a shared host with per-action RBAC and audit export.

## Scope

Two parallel tracks. Both must be green before graduating to Phase 3.

### Track A — Developer Delight

Audience: the single developer with a team of 5–10 agents.

| # | Item | Gap ref |
|---|---|---|
| 2.A.1 | `ag` alias as primary CLI; `aegis` retained | ADR-0023 |
| 2.A.2 | Interactive `ag init` (config, dashboard, first session) | — |
| 2.A.3 | `ag doctor` diagnostics (tmux, Claude CLI, network, perms) | — |
| 2.A.4 | Official BYO LLM support: docs + `examples/byo-llm/` + CI mock smoke | ADR-0023 |
| 2.A.5 | Agent / skill / slash-command template gallery (`ag init --from-template`) | — |
| 2.A.6 | Remote-access guide (Tailscale, Cloudflare Tunnel, ngrok) | — |
| 2.A.7 | Mobile-first dashboard pass | P1-7 |
| 2.A.8 | Dashboard home / onboarding flow | — |

### Track B — Team-Ready

Audience: the 10-person team sharing one deployment.

| # | Item | Gap ref |
|---|---|---|
| 2.B.1 | Helm chart v1 (StatefulSet, PVC, liveness/readiness) | P1-9 |
| 2.B.2 | Per-action RBAC: `send`, `approve`, `reject`, `kill`, `create` | P0-6 |
| 2.B.3 | Audit export API + base filter UI | P1-8 |
| 2.B.4 | CSP + move dashboard token out of `localStorage` | P0-8 |
| 2.B.5 | Fault-injection harness in release gate (tag-only) | P1-6 |
| 2.B.6 | Prompt-injection hardening for MCP prompts | P2-3 |
| 2.B.7 | Windows/macOS smoke on `develop` (subset; full matrix on tag) | P1-5 |

## Explicitly out of scope for Phase 2

The following items look tempting here but belong to Phase 3 or later:

- SSO / OIDC (Phase 3)
- Multi-tenancy primitives — `tenantId` on keys/sessions (Phase 3)
- Postgres `SessionStore` (Phase 3)
- OpenTelemetry end-to-end wiring (Phase 3)
- Language SDKs (Phase 3)
- Any Redis-backed / horizontal-scaling work (Phase 4)

## Activation checklist

Before opening GitHub issues for Phase 2, the maintainer must:

- [ ] Confirm Phase 1 exit checklist is satisfied.
- [ ] Update this file: change status to **ACTIVE** and set activation date.
- [ ] Open one tracking issue **"EPIC: Phase 2 — Developer Delight +
  Team-Ready"** with labels `phase-2`, `epic`.
- [ ] Open sub-issues (2.A.1 … 2.B.6) referencing this epic.
- [ ] Update the ROADMAP.md phase status markers.

## Exit checklist

- [ ] All track A items shipped.
- [ ] All track B items shipped.
- [ ] Public demo video of the mobile approval flow recorded.
- [ ] Incident / rollback runbook validated at least once.
- [ ] Rename alpha dist-tag / version suffix to `preview`.
- [ ] At least one external team (not the maintainer) has deployed Aegis.
