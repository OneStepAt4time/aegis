# Why Aegis?

Aegis is enterprise orchestration middleware for Claude Code. This page explains what makes Aegis different from developer tools and multi-agent frameworks — and why those differences matter for production deployments.

## Aegis vs Developer Tools

Some Claude Code wrappers focus on developer convenience — quick session management, browser-based UIs, and local-first workflows. Aegis is built for a different purpose: **production-grade orchestration at scale**.

| Capability | Aegis | Dev Tool Wrappers |
|-----------|-------|-------------------|
| **Authentication** | Bearer tokens, SSE token separation, API key roles (admin/operator/viewer), hook secrets with header-only enforcement | Basic token auth or none |
| **Audit** | Hash-chained immutable audit trail for every session action | No audit trail |
| **Permissions** | Configurable per-tool, per-session permission policies | Allow-all or manual approval |
| **Observability** | OpenTelemetry tracing (HTTP, sessions, tool invocations), Prometheus metrics, SSE real-time events | Limited logging |
| **Rate limiting** | Per-IP auth failure limits, connection limits, request throttling | Often none |
| **Safety** | Circuit breaker for hook failure loops, Zod schema validation, payload truncation protection | Best-effort |
| **Deployment** | Self-hosted, Docker-ready, Helm chart, no telemetry home | Varies |
| **Compliance** | Pre-filled security questionnaire (SOC2/DPA-ready), immutable audit log | No compliance story |

### When to choose a dev tool wrapper

If you're a solo developer who wants a quick UI for Claude Code sessions, a lightweight wrapper may be sufficient. You don't need audit trails, rate limiting, or structured observability for personal projects.

### When to choose Aegis

If you're running Claude Code in a team, CI/CD pipeline, or production environment, you need:
- **Auditability** — every action is logged with hash-chain integrity
- **Access control** — API keys with scoped roles, not shared secrets
- **Observability** — traces, metrics, and real-time events for monitoring
- **Reliability** — circuit breakers, rate limiting, graceful degradation

## Aegis vs Multi-Agent Frameworks

Some tools orchestrate multiple AI coding agents (Claude Code, Gemini CLI, Codex, etc.) in parallel. Aegis is intentionally **Claude Code only**.

### Why single-agent middleware?

Aegis follows the **BYO LLM bridge** principle: the orchestration middleware should be agnostic to *how* the agent runs, but excellent at *managing* it. Multi-agent orchestration is a different product category — one that belongs in external orchestrators (like OpenClaw), not in the middleware layer.

| Concern | Aegis | Multi-Agent Frameworks |
|---------|-------|----------------------|
| **Scope** | Deep Claude Code integration via ACP (JSON-RPC over stdio) | Broad but shallow — supports 8+ agents with varying quality |
| **Protocol** | Native ACP — structured events, tool calls, approval flows | Often terminal-scraping or subprocess management |
| **Session control** | Fine-grained: approve/reject/interrupt/escape/kill per session | Coarse: start/stop sessions |
| **Permission model** | Per-tool, per-session policy evaluation | Usually allow-all |
| **Event granularity** | Text deltas, tool calls, token usage, state transitions | High-level status only |
| **Composability** | REST API + MCP server + SSE + webhooks — pick any integration style | Often a single integration path |

### When to choose a multi-agent framework

If you need to orchestrate diverse AI coding agents in parallel (Gemini + Codex + Claude Code), a multi-agent framework is the right choice.

### When to choose Aegis

If your team standardizes on Claude Code and needs deep, production-grade control — structured events, permission policies, audit trails, and enterprise security — Aegis provides the deepest integration available.

## Architecture Principles

These principles guide every feature decision in Aegis:

1. **Middleware, not agent framework** — Intelligence stays outside. Aegis manages flows, security, and audit. The orchestrator provides the brains.
2. **Self-hosted only** — Your data stays on your infrastructure. Aegis never phones home.
3. **API-first** — Every feature is accessible via REST API, MCP server, or CLI. The dashboard is a convenience layer, not the primary interface.
4. **Audit by default** — Every session action is recorded. Compliance is a feature, not an afterthought.
5. **Fail safe** — Circuit breakers, rate limiting, graceful degradation. Production workloads don't crash silently.

## Deployment Tiers

Aegis serves three deployment scenarios with the same codebase:

### Tier 1 — Local Orchestration
Single developer. Run tasks in the background, monitor via dashboard, approve via Telegram.

```bash
ag
# Dashboard: http://localhost:9100/dashboard/
```

### Tier 2 — CI/CD & Team Automation
Development teams. Policy-based permissions, batch operations, Slack notifications, shared API keys.

```bash
curl -X POST http://localhost:9100/v1/pipelines \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"pr-reviewer","stages":[...]}'
```

### Tier 3 — Zero-Trust Enterprise
Banks, SaaS, regulated industries. Docker-isolated containers, no network egress, immutable audit.

- Each task runs in an ephemeral Docker container
- No cross-container networking
- Immutable audit log for compliance

## Getting Started

```bash
npm install -g @onestepat4time/aegis
ag init
ag
```

See [Getting Started](./getting-started.md) for the full walkthrough.

## Learn More

- [Architecture Guide](./architecture.md) — full system architecture and module overview
- [Lifecycle Hooks Guide](./hooks-guide.md) — hook system, security model, and observability
- [Deployment Guide](./deployment.md) — production deployment, Docker, TLS, monitoring
- [Enterprise Guide](./enterprise.md) — security hardening and compliance
- [API Reference](./api-reference.md) — 60+ REST endpoints with examples
