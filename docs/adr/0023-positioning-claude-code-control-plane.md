# ADR-0023: Positioning — Claude Code Control Plane, MIT, BYO LLM, `ag` CLI

## Status
Proposed

## Context

Aegis has been shaped incrementally as a Fastify + tmux HTTP bridge for Claude
Code sessions. Over time, reviews have suggested multiple possible product
framings (enterprise orchestrator, multi-agent framework, managed SaaS). The
project currently has a small audience (≈ 8 GitHub stars as of 2026-04-16) and
a part-time maintainer, so we need an unambiguous positioning that keeps the
codebase focused and the roadmap tractable.

Three independent decisions were deferred across ADR-0006 and the 2026-04-16
gap analysis and are collected and formalised here.

## Decisions

### 1. Product framing — "Claude Code Control Plane"

Aegis is the control plane of Claude Code. It exposes Claude Code sessions as
a programmable, observable, multi-channel service over REST, MCP, SSE,
WebSocket, CLI, and notification channels.

Aegis **does not** orchestrate agents. Users build their agents (as Claude
Code sub-agents, skills, or external MCP clients); Aegis provides the
primitives (`create_session`, `send_message`, `approve_permission`,
`events_subscribe`, `pipelines`, templates) and the observability to
orchestrate them.

This formalises [ADR-0006](0006-aegis-middleware-not-agent-framework.md) as
the product-level positioning, not just an architectural note.

Consequence: the `consensus`, `swarm-monitor`, and `memory-bridge` modules are
kept but flagged experimental; no further investment until a clear user need
surfaces.

### 2. Target-user scope — three scales, one product

| Scale | Primary today? | Examples |
|---|---|---|
| Single developer running a team of AI agents | **Yes** | the maintainer, indie devs, vibe coders |
| Team of humans each with their own agents | **Next 2–3 months** | 5–20-person dev teams |
| Enterprise | **Demand-driven** | multi-team deployments needing SSO/tenancy |

The orchestration pattern is the same at every scale, so one codebase serves
all three. Enterprise features (SSO, multi-tenancy, compliance) are built as
extensions of the same primitives, never as a fork.

### 3. Licensing — MIT, single edition

Aegis remains MIT-licensed with a single edition. No open-core, no BUSL, no
private enterprise repository. If a commercial contract, external funding, or
regulatory requirement later demands a different structure, it will be
re-evaluated with legal counsel at that point — not before.

Consequence: no `AEGIS_EDITION` flag. All features ship to every user.

### 4. LLM backend — BYO LLM is first-class

Aegis orchestrates Claude Code as a runtime. Claude Code already supports
pluggable LLM backends via `ANTHROPIC_BASE_URL` and related environment
variables (GLM via `api.z.ai`, OpenRouter, local LM Studio / Ollama, Azure
OpenAI, etc.). Aegis treats this as an **officially supported** configuration,
not a tolerated side-effect.

Obligations that fall out of this decision:

- `docs/advanced.md` gains a "BYO LLM" section with verified configurations.
- `examples/byo-llm/` provides runnable samples for at least: GLM, OpenRouter,
  Ollama.
- CI gains a smoke suite that points Claude Code (or a mock) at an
  OpenAI-compatible mock server and verifies an end-to-end session.
- The env-var denylist in [ADR-0020](0020-env-var-denylist.md) explicitly
  whitelists `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_DEFAULT_*_MODEL`, and related variables (they are the opposite of
  the denylist targets).

Aegis ships **no default LLM credentials**. It does not proxy, cache, or own
cost for LLM calls. Users pay their provider; Aegis stays zero-variable-cost
to operate.

### 5. CLI binary — `ag` is primary, `aegis` is an alias

The npm `bin` entry gains `ag` alongside `aegis`. Documentation, examples,
README, and generated help use `ag` as the canonical command. `aegis` remains
for discoverability, muscle memory, and backward compatibility.

```json
"bin": {
  "aegis": "dist/cli.js",
  "ag": "dist/cli.js"
}
```

All new subcommands in Phase 2 (`init`, `doctor`, `templates`) are documented
under `ag`. No subcommands are renamed or removed.

## Consequences

- **Narrative**: README and `docs/` top copy are rewritten in Phase 2 to lead
  with "control plane for Claude Code" and to feature BYO LLM and `ag`
  prominently.
- **Roadmap**: see §15 of [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md).
- **Dropped plans**: open-core edition flag, Redis-first horizontal scaling,
  Kubernetes-as-default deployment. All become Phase 4 or later, demand-driven.
- **Maintainer posture**: realistic pace for a part-time maintainer. Phase 1
  is the only current commitment; Phases 2–4 are *plans*, not promises.

## Related

- [ADR-0006](0006-aegis-middleware-not-agent-framework.md) — Aegis as
  middleware, not agent framework (architectural predecessor)
- [ADR-0017](0017-opentelemetry-tracing.md) — Tracing strategy (enables
  Phase 3 observability)
- [ADR-0018](0018-openapi-spec-from-zod.md) — Unblocks SDK generation that
  this positioning depends on
- [ADR-0020](0020-env-var-denylist.md) — Must whitelist BYO-LLM variables
- [docs/enterprise/00-gap-analysis.md](../enterprise/00-gap-analysis.md) §15
