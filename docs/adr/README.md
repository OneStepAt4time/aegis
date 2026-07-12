# Architecture Decision Records

ADRs document significant architectural decisions made during Aegis development. Each record captures the context, decision, and consequences.

## Index

| Number | Title | Status | Date | Issue |
|--------|-------|--------|------|-------|
| [ADR-0001](0001-windows-env-injection-strategy.md) | Windows Env Injection Strategy | Accepted | 2026-04-07 | — |
| [ADR-0002](0002-windows-swarm-monitor-strategy.md) | Windows Swarm Monitor Strategy | Accepted | 2026-04-07 | — |
| [ADR-0003](0003-windows-minimum-supported-version.md) | Windows Minimum Supported Version | Accepted | 2026-04-07 | — |
| [ADR-0004](0004-psmux-version-pinning.md) | psmux Version Pinning | Accepted | 2026-04-07 | — |
| [ADR-0005](0005-module-level-ai-context.md) | Module-Level AI Context Files | Accepted | 2026-04-07 | #1304 |
| [ADR-0006](0006-aegis-middleware-not-agent-framework.md) | Aegis as Middleware, Not Agent Framework | Accepted | 2026-04-10 | — |
| [ADR-0007](0007-server-decomposition-fastify-plugins.md) | Server Decomposition into Fastify Plugins | Accepted | 2026-04-13 | #1756 |
| [ADR-0014](0014-multi-line-message-sending-via-tmux.md) | Multi-line Message Sending via tmux Line-by-Line | Accepted | 2026-04-14 | #1770, #1815 |
| [ADR-0016](0016-release-please-github-app-token.md) | Release-please with GitHub App Token | Accepted | 2026-04-10 | — |
| [ADR-0017](0017-opentelemetry-tracing.md) | OpenTelemetry Distributed Tracing | Accepted | 2026-04-08 | — |
| [ADR-0018](0018-openapi-spec-from-zod.md) | OpenAPI 3.1 Spec Generated from Zod Schemas | Proposed | 2026-04-16 | — |
| [ADR-0019](0019-session-ownership-authz.md) | Explicit Session Ownership Authz on Action Routes | Proposed | 2026-04-16 | #1429 |
| [ADR-0020](0020-env-var-denylist.md) | Env-Var Denylist on Session Create | Proposed | 2026-04-16 | — |
| [ADR-0021](0021-sse-and-http-drain-timeouts.md) | SSE Idle Timeout and HTTP Drain on Shutdown | Proposed | 2026-04-16 | — |
| [ADR-0022](0022-sigstore-attestations.md) | Sigstore Attestations for npm and Container Artifacts | Proposed | 2026-04-16 | — |
| [ADR-0023](0023-positioning-claude-code-control-plane.md) | Positioning: Claude Code Control Plane, MIT, BYO LLM, `ag` CLI | Deprecated | 2026-04-16 | — |
| [ADR-0024](0024-dashboard-token-in-memory.md) | Dashboard API Token Stays In Memory | Accepted | 2026-04-17 | #1924 |
| [ADR-0025](0025-tenant-authz-model.md) | Tenant-Aware Authorization Model | Proposed | — | — |
| [ADR-0026](0026-oidc-trust-model.md) | OIDC Trust Model for Dashboard SSO | Proposed | — | #1942 |
| [ADR-0027](0027-acp-feasibility-spike-verdict.md) | ACP Feasibility Spike Verdict | Proposed | — | #2576 |
| [ADR-0028](0028-acp-native-session-identity-model.md) | ACP-Native Session Identity Model | Proposed | 2026-05-04 | #2584 |
| [ADR-0029](0029-solo-dev-first-phase-4-deferred.md) | Strategic Refocus — Solo Developer First, Phase 4 Deferred | Proposed | 2026-05-16 | — |
| [ADR-0030](0030-network-isolation-scope-by-deployment-tier.md) | Network Isolation Scope by Deployment Tier | Accepted | 2026-05-22 | #3998, #3980 |
| [ADR-0030](0030-agent-auth-rfc.md) | Agent Auth — Per-agent PAT vs Second GitHub App (RFC) | Proposed | 2026-06-05 | — |
| [ADR-0031](0031-budgets-api-design.md) | /v1/budgets API Design for Cost Alerts | Proposed | 2026-05-25 | #4196 |
| [ADR-0032](0032-multi-agent-architecture.md) | Multi-Agent Support — Architecture Design | Approved | 2026-05-30 | #3180 |
| [ADR-0033](0033-positioning-vs-ecc.md) | Positioning vs ECC (affaan-m) — Aegis = Production Platform, ECC = Power-User Config | Proposed | 2026-06-20 | — |
| [ADR-0034](0034-positioning-multi-cli-agent-runtime.md) | Positioning — Multi-CLI Agent Runtime (supersedes ADR-0023) | Accepted | 2026-07-07 | #3263 |

> **Note on duplicate numbers:** ADR-0030 currently has two files (`0030-network-isolation-scope-by-deployment-tier.md` and `0030-agent-auth-rfc.md`). Both are linked above with disambiguated titles. A follow-up renumbering PR is needed (Boss decision pending). The older duplicates at ADR-0024 and ADR-0025 (pre-existing) are also pending renumbering and out of scope for this index catch-up.

## Creating a New ADR

1. Copy an existing ADR as a template
2. Name it `000N-title-slug.md` with the next sequential number
3. Fill in the Context, Decision, and Consequences sections
4. Add it to this index table
5. Link the ADR in the relevant GitHub issue

## Status Legend

- **Proposed** — under discussion
- **Accepted** — approved and implemented
- **Deprecated** — superseded by a later decision
- **Rejected** — considered but not adopted
