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
