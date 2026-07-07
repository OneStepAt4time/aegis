# Positioning (what Aegis is and is not)

Authoritative source: [ADR-0034](../../docs/adr/0034-positioning-multi-cli-agent-runtime.md)
(supersedes [ADR-0023](../../docs/adr/0023-positioning-claude-code-control-plane.md))
and [docs/enterprise/00-gap-analysis.md §15](../../docs/enterprise/00-gap-analysis.md).

## What Aegis is

- **The control plane for ACP-compatible coding-agent CLIs** — Claude Code
  (default), plus Kimi Code and Gemini CLI. REST, MCP, SSE, WebSocket, CLI, and
  notification channels on a single self-hosted server. See [ADR-0034](../../docs/adr/0034-positioning-multi-cli-agent-runtime.md).
- **A bridge, not an orchestrator.** The agent CLI does the work. Aegis
  exposes, governs, observes, and approves it.
- **MIT, single edition.** No open-core, no BUSL, no paid tier flag.
- **BYO LLM first-class, per runner.** Each runner points at its own provider
  (Claude Code → Anthropic/GLM/OpenRouter/Ollama; Kimi → Moonshot; Gemini →
  Vertex/Gemini API). Aegis owns no LLM cost.

## Target users (in order of priority)

1. The solo developer who runs a team of 1–100 agents and approves from their
   phone.
2. The small / medium team that shares one self-hosted Aegis deployment.
3. The enterprise that wants SSO + multi-tenancy on the same product, later.

Same architecture at every scale. No fork, no edition split, no rewrite.

## What Aegis is NOT

- Not an agent framework. We do not write agents, prompts, or LLM calls.
- Not a SaaS. Self-hosted first; SaaS is off the table until demand + funding.
- Not Claude-Code-only at the runtime layer — any ACP-compatible CLI can be a
  runner (Claude Code remains the default). The LLM endpoint is also
  configurable per runner.
- Not multi-harness via bespoke adapters — only ACP-speaking runners are
  first-class (ADR-0034 Decision 4). Non-ACP CLIs enter via an ACP bridge.

## What to NOT build without explicit maintainer approval

The roadmap locks these in. Do not propose or start PRs for them unless a
maintainer assigns the issue from the right phase.

**Never** (out of scope):
- Open-core edition flag (`AEGIS_EDITION`) — decided against in ADR-0023;
  reaffirmed in ADR-0034 Decision 7.
- Rewrite in another language — not under consideration.
- Bespoke per-harness adapters inside the runtime — first-class runners speak
  ACP; non-ACP CLIs enter via an ACP bridge, not an Aegis adapter
  (ADR-0034 Decision 4). SaaS-only / preview-ACP CLIs (Copilot CLI today) are
  watched, not built.

**Not before Phase 3** (team & early-enterprise):
- SSO / OIDC providers.
- Multi-tenancy primitives (tenant IDs on keys, sessions, audit).
- Pluggable `SessionStore` with Postgres.
- OpenTelemetry end-to-end wiring beyond the existing placeholder.

**Not before Phase 4** (enterprise GA, demand-driven):
- Redis as default state store.
- Kubernetes as default deployment target (Helm chart ships in Phase 2 but
  systemd / Docker Compose remain the default path).
- Compliance scaffolding (SOC2, DPA templates).
- Per-tenant quotas and billing hooks.

If you think one of those items is unavoidable sooner, open an issue with
the label `needs-human` and stop there.

## Issue visibility vs. work-start

Planning issues for every phase are open on GitHub in advance so the
dependency tree is public and searchable. They are labelled
`status: not-active` until their phase is activated.

**Having an issue open does NOT mean you may start work on it.**

Rule: do not start any PR for an issue that still carries `status: not-active`.
Activation happens via a maintainer-approved PR that:

1. Removes `status: not-active` from the phase's epic + sub-issues.
2. Flips the phase status in the relevant `.claude/epics/phase-*/epic.md`.
3. Updates [ROADMAP.md](../../ROADMAP.md) phase markers.

## Current phase

Phase 3 — Team & Early-Enterprise. Phase 3.6 — Multi-CLI Runtime (Kimi Code,
Gemini CLI as ACP runners) is now in scope under [ADR-0034](../../docs/adr/0034-positioning-multi-cli-agent-runtime.md).
Scope is defined in
[.claude/epics/phase-3-team-early-enterprise/epic.md](../epics/phase-3-team-early-enterprise/epic.md)
and ROADMAP §Phase 3.6.
