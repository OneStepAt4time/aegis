# ADR-0024: Positioning vs ECC (affaan-m) — Aegis = Production Platform, ECC = Power-User Config

## Status
Proposed

## Context

On 2026-06-20, Boss Manudis flagged [affaan-m/ECC](https://github.com/affaan-m/ECC)
("Everything Claude Code") as Multica-scale competitive intel — not FYI.
At 211.9K stars / 32.5K forks / 230+ contributors, MIT-licensed, shipping weekly
across 7 harnesses (Claude Code, Codex, Cursor, OpenCode, Gemini, Zed, GitHub
Copilot), with a sponsor-funded OSS + GitHub App dual-track business model
(free OSS → $19/seat Pro → Enterprise contact-sales), ECC is the largest
awareness threat on our radar. A single maintainer runs the operation.

Their v2.0.0 release ships a Rust control-plane prototype (`ecc2/`) and a
public "Hermes operator" persona — a direct naming collision with our
<@1494469941074591924> (our DevOps agent, also called Hermes).

This ADR formalises Aegis's positioning in response. The battle card at
[`references/ecc-battle-card-2026-06-20.md`](../../references/ecc-battle-card-2026-06-20.md)
is the source of truth for ECC's surface. The multi-harness gap is parked as
a separate `competitive` issue ([#4768](https://github.com/OneStepAt4time/aegis/issues/4768))
— out of scope for this ADR.

## Decisions

### 1. Positioning — Aegis = production platform, ECC = power-user config

**Aegis is a production platform** for teams running Claude Code agents with
formal governance. Its surface is REST + MCP + approvals + observability +
transcripts + audit + multi-tenant auth. You don't run Aegis from your
terminal; you deploy it and orchestrate agents across a team.

**ECC is a power-user config surface** — a curated, deeply opinionated kit
of skills, rules, MCP configs, memory harnesses, and security scanning for
solo developers and small teams. You run it from your terminal; the operator
shell is the product.

Both are valid. The market is large enough for both. The danger is the market
believing only one can exist.

**Consequence:** README and `docs/` lead with "production platform" framing.
The "operator in your terminal" angle is not for us. If you want operator
ergonomics, use ECC. If you want governance + audit + team orchestration,
use Aegis. Trying to be both dilutes both.

### 2. Hermes name disambiguation — Boss call needed

ECC 2.0's "Hermes operator" persona is a direct naming collision with our
<@1494469941074591924>. As ECC scales, "Hermes" will default to their
operator shell in community discourse; ours becomes invisible or confusing
in search.

This ADR captures the options but does not decide. Ema decides.

| Option | Scope | Cost | Risk | Verdict |
|---|---|---|---|---|
| A. Disambiguate ("Hermes [Aegis]") | Short term | Near-zero: 1 line in docs + comms habit | Doesn't solve, just manages | Boss call |
| B. Rename to Iris / Nike / Tyche | Long term | High: AGENTS.md, all docs, Discord roles, GitHub refs, memory | Transition confusion | Boss call |
| C. Do nothing | None | Zero | Lose the name as ECC scales | Boss call |

**Trigger context** (from <@1494469941074591924>'s release-notes hygiene
framing): their "Hermes" appears in ECC 2.0 release notes + `HERMES-SETUP.md`
+ install/onboarding flow. Our "Hermes" lives in Discord roster + ops scripts
+ release-process docs. At 211K⭐, "Hermes CC operator" search will dominate
to their meaning; the cost of conflating is high.

**Short-term recommendation** (in this ADR, not awaiting Boss): adopt
disambiguation discipline. Always use "Hermes [Aegis]" in public channels.
Add a footnote in `README.md` + `AGENTS.md`. Cost is near-zero; reversibility
is high. Long-term rename is a separate decision.

### 3. What we DON'T copy — discipline

The card's §6 enumerates 6 items we explicitly do NOT adopt:

1. **Weekly shipping without review gates.** Argus reviews; 18 CI checks +
   CodeQL + dashboard-e2e + `npm run gate` are mandatory. PR #4761 sat open
   for review because race regressions matter.
2. **Conflating operator tooling with production platform.** Aegis is a
   server. Multi-tenant. Auth'd. Audited. You deploy it; you don't "run it
   from your terminal."
3. **Harness-specific shortcuts that break ACP.** ACP (Agent Client Protocol)
   is our native protocol. No harness-specific adapters. If ACP wins, our
   architecture is simpler than N adapter layers.
4. **Security warnings as marketing copy.** Themis audits security. We fix
   vulnerabilities before they exist; we don't put warnings in READMEs as
   trust signals.
5. **Single-maintainer bus factor.** 9 agents with defined roles, escalation
   paths, and coverage. Resilience over raw speed. A single maintainer at
   211K stars is impressive but fragile.
6. **OSS-first community support.** All support is team-mediated (Boss →
   right agent). A paid tier is a gap to close, not a pattern to copy.

**Consequence:** when ECC's choices sound appealing in a discussion, check
this list before adopting. Speed and polish are real; the discipline is the
differentiator.

### 4. Supply-chain hygiene — replication deferred

ECC's README opens with a malware-mirror warning (5 official channels listed,
explicit "unofficial mirrors may contain malware"). At 211K stars this is
operational hygiene, not CYA.

**Decision:** replicate the multi-channel verification pattern in our README
+ docs before we hit 5K stars or start getting npm clones. Until then, this
is a maturity milestone we haven't needed yet.

**Consequence:** add a follow-up issue to introduce canonical-distribution-
channel language to README when we cross 5K stars. Cross-referenced from
[#4768](https://github.com/OneStepAt4time/aegis/issues/4768).

### 5. What we DO learn from

Not every ECC pattern is a "do not copy" item. The card calls out two real
lessons:

- **Verified pricing before external reference.** Orpheus pulled the $19/seat
  figure from ECC's live pricing page, not from a third-party report. Same
  discipline applies to any external claim we cite in our docs.
- **Multi-channel distribution list.** Even at our size, listing canonical
  distribution channels (npm + GitHub + docs site) in README is a low-cost
  trust signal. Defer the malware-warning language; the channel list is fine
  today.

**Consequence:** the verified-cite discipline becomes a `references/` standard.
The canonical-channel list is added to README as a small follow-up.

## Consequences

- **README & docs**: lead with "production platform" framing. No "operator
  in your terminal" angle.
- **Comms hygiene**: "Hermes [Aegis]" disambiguation, all agents, public
  channels. Footnote in README + AGENTS.md (small follow-up PR).
- **Cardinal discipline**: do NOT adopt items on the §6 not-copy list. Speed
  without review, operator-in-terminal framing, harness-specific shortcuts,
  security-as-marketing, single-maintainer bus factor, OSS-only support — all
  declined.
- **Supply-chain**: defer to 5K-stars milestone. Add follow-up issue.
- **Multi-harness**: parked, separate `competitive` issue #4768, not this
  sprint. Revalidate quarterly.
- **Positioning update**: this ADR supplements [ADR-0023](0023-positioning-claude-code-control-plane.md)
  and [ADR-0029](0029-solo-dev-first-phase-4-deferred.md). It does not replace
  either. The Aegis-as-middleware stance, the solo-dev-first scope, and the
  MIT-licensed single-edition all hold.
- **Hermes name**: short-term disambiguation adopted in this PR. Long-term
  rename is Boss call.

## Related

- [ADR-0006](0006-aegis-middleware-not-agent-framework.md) — Aegis as
  middleware, not agent framework (architectural principle, unchanged)
- [ADR-0023](0023-positioning-claude-code-control-plane.md) — Original
  positioning (still holds; this ADR sharpens in response to ECC)
- [ADR-0029](0029-solo-dev-first-phase-4-deferred.md) — Strategic refocus to
  solo-dev-first (still holds; this ADR narrows further on the
  platform-vs-config axis)
- [`references/ecc-battle-card-2026-06-20.md`](../../references/ecc-battle-card-2026-06-20.md) —
  Source of truth for ECC surface (DevRel-owned, weekly refresh)
- [#4768](https://github.com/OneStepAt4time/aegis/issues/4768) — Multi-harness
  gap, parked `competitive` issue
- [`.claude/rules/branching.md`](../../.claude/rules/branching.md) — Branch
  + worktree convention (this ADR opened via `docs/ecc-positioning-adr`)

---

*Proposed by Emanuele Santonastaso, 2026-06-20. Drafted by Scribe.*

*Sources: Boss Manudis directive in #aegis-devs 2026-06-20 12:50;
battle card by <@1494469505647382549> (Orpheus) 13:01; Hermes-disambiguation
framing by <@1494469941074591924> (Hermes) 12:52; dogfooding one-liner
("agent team using its own product daily") by <@1494469505647382549> (Orpheus)
12:55, ratified by Boss 12:55 and Athena 13:00; scope call by Boss 12:58.*
