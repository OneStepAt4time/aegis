# Positioning (what Aegis is and is not)

Authoritative source: [ADR-0023](../../docs/adr/0023-positioning-claude-code-control-plane.md)
and [docs/enterprise/00-gap-analysis.md §15](../../docs/enterprise/00-gap-analysis.md).

## What Aegis is

- **The control plane of Claude Code.** REST, MCP, SSE, WebSocket, CLI, and
  notification channels on a single self-hosted server.
- **A bridge, not an orchestrator.** Claude Code does the agent work. Aegis
  exposes, governs, observes, and approves it.
- **MIT, single edition.** No open-core, no BUSL, no paid tier flag.
- **BYO LLM first-class.** Claude Code can point at Anthropic, z.ai GLM,
  OpenRouter, LM Studio, Ollama, Azure OpenAI, etc. Aegis owns no LLM cost.

## Target users (in order of priority)

1. The solo developer who runs a team of 1–100 agents and approves from their
   phone.
2. The small / medium team that shares one self-hosted Aegis deployment.
3. The enterprise that wants SSO + multi-tenancy on the same product, later.

Same architecture at every scale. No fork, no edition split, no rewrite.

## What Aegis is NOT

- Not an agent framework. We do not write agents, prompts, or LLM calls.
- Not a SaaS. Self-hosted first; SaaS is off the table until demand + funding.
- Not Claude-only at runtime. The LLM endpoint is configurable.
- Not a general-purpose tmux manager. tmux is an implementation detail.

## What to NOT build without explicit maintainer approval

The roadmap locks these in. Do not propose or start PRs for them unless a
maintainer assigns the issue from the right phase.

**Never** (out of scope):
- Open-core edition flag (`AEGIS_EDITION`) — decided against in ADR-0023.
- Rewrite in another language — not under consideration.
- First-class integrations with competing CLIs (e.g. Gemini CLI) —
  Claude Code is the single target runtime.

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

Phase 3 — Team & Early-Enterprise. Scope is defined in
[.claude/epics/phase-3-team-early-enterprise/epic.md](../epics/phase-3-team-early-enterprise/epic.md).
