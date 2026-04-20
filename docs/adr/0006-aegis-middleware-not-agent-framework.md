# ADR-0006: Aegis as Middleware, Not Agent Framework

Status: Accepted
Date: 2026-04-10
Issue: #1756 (related)

## Context

Aegis was initially designed as an orchestration platform. As it evolved, platform risk emerged: **Anthropic will likely release an official Claude Code API**. If that happens, any orchestration layer that is tightly coupled to the tmux runner becomes obsolete.

The question arose: what is Aegis's unique value if intelligence can be provided externally?

## Decision

**Aegis = Enterprise Orchestration Middleware, NOT an agent framework.**

Intelligence stays OUTSIDE. Aegis is "stupid-but-powerful": it provides flows, security, audit, and orchestration — but does not prescribe how AI reasoning should work.

### Core Thesis

Aegis's value is its **Control Plane**, not the tmux runner hack. The tmux runner is a temporary implementation detail. The real product is the infrastructure around session management, permissions, and audit.

### Three Deployment Tiers

1. **Local Orchestration** — single dev, implicit trust, dashboard + Telegram
2. **CI/CD & Team Automation** — policy-based permissions, Blueprints, Slack
3. **Zero-Trust Enterprise** — Docker isolation, immutable audit, no network egress

### Kill Your Darlings

Features that don't fit the middleware vision are removed or disabled:

- **Consensus Review** — agent framework territory, not middleware
- **Model Router** — unless justified by immediate use case

Rule: if it smells like an agent framework feature → remove or disable.

## Consequences

Pros:
- Aegis survives Anthropic API releases by abstracting the Runner (TmuxRunner → AnthropicApiRunner)
- Clear product positioning differentiates from Cursor, Copilot, and other AI coding tools
- Enterprise customers get governance, audit, and compliance — not just automation

Cons:
- Removes features some users may have expected (consensus, model routing)
- Requires ongoing discipline to reject features that blur the middleware boundary

## Enforcement

- New features must be evaluated against this thesis
- If it requires AI reasoning → it's not an Aegis feature
- Architecture decisions should reference this ADR
