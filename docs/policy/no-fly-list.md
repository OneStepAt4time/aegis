# No-Fly List — Aegis Competitive Discipline

**Status:** Policy (binding)
**Ratified:** 2026-06-20 by Boss Manudis (per ECC battle card §6)
**Source ADR:** [ADR-0033 §3](../adr/0033-positioning-vs-ecc.md#3-what-we-wont-do--policy-no-fly-list)
**Owner:** PM (Athena)
**Enforcement:** Argus (PR review checklist), Scribe (docs section), PM (canonical doc)

## Purpose

This document is the canonical source of truth for the 6 competitive-discipline items that Aegis will NOT adopt, regardless of how appealing they may appear in industry discussion. Speed and polish from competitors are real; the discipline is the differentiator.

When a competitor's choice (ECC, cc-connect, agent-of-empires, etc.) sounds appealing, check this list before adopting. The default answer is "no" until the strategic case is overwhelming and the alternative is already shipped elsewhere with proven demand.

## Surface enforcement

This policy appears in three places:

| Surface | Owner | Status |
|---------|-------|--------|
| This canonical doc (`docs/policy/no-fly-list.md`) | PM (Athena) | ✅ this file |
| ADR-0033 §3 "What we won't do" | Scribe | ✅ landed (#4771) |
| PR review checklist | Argus | ✅ baked into SOUL.md 🚫 No-Fly List section |

## The 6 items

### 1. Weekly shipping without review gates

Aegis PRs go through Argus 9-gate review + 18 CI checks (lint, CodeQL, dashboard-e2e, `npm run gate`, etc.). A 3-day review window on a P1 race regression (#4761) is not a bug; it's the discipline. Race regressions matter. The cost of an uncaught regression is higher than the cost of a slightly slower cadence.

### 2. Conflating operator tooling with production platform

Aegis is a server. Multi-tenant. Auth'd. Audited. You deploy it; you don't "run it from your terminal." We don't compete on "how fast can you spin up a local agent." We compete on "how safely can a team of 1–100 agents operate over months."

### 3. Harness-specific shortcuts that break ACP

ACP (Agent Client Protocol) is our native protocol. No harness-specific adapters. If ACP wins, our architecture is simpler than N adapter layers. If ACP loses, we fall back to ACP for the still-pinned-CC core and add adapters only when a paying user demands them.

### 4. Security warnings as marketing copy

Themis audits security. We fix vulnerabilities before they exist; we don't put warnings in READMEs as trust signals. We don't write "WARNING: this may eat your repo" copy because it gets noticed. We write safe defaults that don't need warnings.

### 5. Single-maintainer bus factor

9 agents with defined roles, escalation paths, and coverage. Resilience over raw speed. A single maintainer at 211K stars is impressive but fragile. We don't optimize for the "lone genius founder" narrative.

### 6. OSS-first community support

All support is team-mediated (Boss → right agent). A paid tier is a gap to close, not a pattern to copy. Discord support, GitHub Issues triage, and PR review are the channels. No "open a Discord ticket and hope someone answers" model.

## Update procedure

1. Adding an item requires Boss approval + ADR update.
2. Removing an item requires Boss approval + 30-day grace period for re-adoption.
3. PM maintains this doc as canonical source of truth.
4. Any agent may propose additions in #aegis-devs; final ratification is Boss's call.

## Cross-references

- ADR-0033 §3 — [Positioning vs ECC: What we won't do](../adr/0033-positioning-vs-ecc.md#3-what-we-wont-do--policy-no-fly-list)
- ECC battle card (2026-06-20) — internal positioning reference
- SOUL.md 🚫 No-Fly List section — Argus PR review checklist

---

_Last reviewed: 2026-06-20 19:40 Rome (Athena, on #4770 surface action)._
