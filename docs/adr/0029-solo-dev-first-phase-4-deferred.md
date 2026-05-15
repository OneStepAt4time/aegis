# ADR-0029: Strategic Refocus — Solo Developer First, Phase 4 Deferred

## Status
Proposed

## Context

As of 2026-05-16, Aegis has shipped Phase 3 with 12 implementation items
complete, a healthy codebase (65+ REST endpoints, 24 MCP tools, 4 chat
channels, PWA dashboard), and a team of 9 agents. However, actual user reach
remains small (~200 GitHub stars, ~160 npm installs/week). Competitors with
10–100× our audience are shipping simpler, faster install flows and winning
the discoverability game.

The original roadmap (ADR-0023) planned three audience tiers: solo dev →
team → enterprise. Phase 4 was scoped for enterprise features (SSO/OIDC,
multi-tenancy, Postgres default, Redis coordination, K8s deployment, SOC2,
billing, per-tenant quotas). No paying enterprise customer has signed. Building
for an audience that doesn't exist yet, with resources we don't have, is
spreading the team thin on features nobody is using today.

This ADR formalises the strategic refocus announced on 2026-05-16.

## Decisions

### 1. Primary audience — solo developer / small team

From now on, the only audience Aegis optimises for is the **solo developer or
small team (1–100 Claude Code agents)** running on their own machine or a
self-hosted box.

They want to:
- Spawn sessions from the CLI or dashboard
- Approve agent actions from Telegram (or Slack/Discord) without context-switching
- See what's happening on a clean dashboard
- Get value in under five minutes

Enterprise features are deprioritised until a paying enterprise customer has
actually signed a contract. This is not a pivot away from Aegis — it's a pivot
back to the user Aegis was always supposed to serve first.

### 2. Phase 4 deferred indefinitely

The following Phase 4 items are **deferred** until concrete enterprise demand
materialises:

- SSO/OIDC integration
- Multi-tenancy primitives
- Postgres as default state store
- Redis-backed state and coordination
- Kubernetes-default deployment
- SOC2 scaffolding and compliance tooling
- Billing hooks and metering integration
- Per-tenant quotas (sessions, tokens, USD)
- Horizontal scaling primitives

**Action:** every open issue labeled `phase-4` or `status: not-active` receives
a `deferred` label and a comment: *"Deferred until concrete enterprise demand.
See ADR-0029."*

Deferred items are not deleted. The code that shipped in Phase 3.5 (Postgres
adapters under `src/services/acp/postgres-*.ts`) stays in the codebase. No
rollback. But it is no longer the default path and no longer the focus of new
work.

### 3. Single MIT edition unchanged

ADR-0023 still holds. Aegis remains a single MIT-licensed edition. No
open-core, no Free/Enterprise split. This ADR supplements ADR-0023; it does
not replace it.

### 4. The "should I build this?" filter

Before opening any new feature PR, every contributor (human or agent) must
answer:

> Does this make Aegis better for the solo developer who approves agents from
> their phone, today?

| Answer | Action |
|--------|--------|
| Yes | Proceed |
| Maybe in the future | Don't start |
| It's for enterprise | Apply `deferred` label |

If the answer isn't a clear yes in one sentence, don't open the PR.

### 5. What does not change

- **Bug fixes** for active users — continue, P0/P1 first
- **Security fixes** — non-negotiable, regardless of audience
- **Local gate** (`npm run gate`) — unchanged
- **Workflow** (issue → PR → review → merge) — unchanged
- **Branching** (`develop` → PR, never commit to `main`) — unchanged
- **Worktree convention** — unchanged
- **CC bridge core** (ACP runtime, REST API, MCP server, Telegram, dashboard
  base) — keep it healthy, this IS the product now

## Consequences

### For the codebase
- No new enterprise-only modules. Existing Postgres adapters stay but aren't
  extended.
- New feature work focuses on: CLI ergonomics, Telegram UX, dashboard
  polish, install flow, session recovery, and solo-dev quality-of-life.
- Competitive positioning shifts from "enterprise middleware" to "the
  simplest way to run Claude Code agents with governance."

### For documentation
- README and `docs/` lead with solo-dev value proposition
- Getting-started and quick-start become top priority (5-minute value bar)
- Enterprise tier docs in `docs/enterprise/` are kept but de-emphasised
- Competitive matrix narrative shifts from "enterprise moat" to "solo-dev
  best-in-class"
- ADR-0023's three-tier table is effectively reduced to the first row

### For the roadmap
The roadmap until further notice is:

> **Narrow the scope, ship the magic, find our first 100 users.**

Each week (or sprint), the team picks **one feature** that makes Aegis
materially more useful for a solo dev. The full team converges on it, ships
it, polishes it until it feels effortless, and announces it.

### For Phase 3.5 work
The ACP migration work (Postgres adapters) that already shipped stays where it
is. No rollback. But it is no longer the default path for new development.

## Related

- [ADR-0023](0023-positioning-claude-code-control-plane.md) — Original
  positioning (still holds; this ADR narrows the focus)
- [ADR-0006](0006-aegis-middleware-not-agent-framework.md) — Middleware
  architectural principle (unchanged)
- [docs/competitive-threat-matrix.md](../competitive-threat-matrix.md) —
  Competitive landscape (narrative update pending)

---

*Proposed by Emanuele Santonastaso, 2026-05-16. Drafted by Scribe.*
