# Claude Code Dynamic Workflows Changed the Game. Here's Why You Still Need Aegis.

*CC v2.1.154 can orchestrate hundreds of agents natively. That's great news for Aegis — and here's why.*

---

Claude Code v2.1.154 shipped something real: **Dynamic Workflows**. You can now ask Claude to orchestrate work across tens to hundreds of agents in the background. One prompt, parallel execution, all from the CLI.

This is genuinely impressive. We've been watching CC's background session story mature for months — pinned sessions, `/resume`, `claude agents --json` — and Dynamic Workflows is the logical next step. Anthropic is building a powerful engine.

That's exactly why Aegis matters more than ever.

## What Dynamic Workflows Does

Dynamic Workflows is native multi-agent orchestration inside Claude Code:

- **`/workflows`** — view and manage running workflows
- **Background sessions** with `! <command>` — run shell commands as background tasks you can attach to and detach from
- **`claude --bg --exec`** — programmatic background execution
- **Agent delegation** — Claude decomposes a task and distributes it across agents

For a solo developer working locally, this is genuinely useful. You get parallelism without installing anything extra.

## What Dynamic Workflows Doesn't Do

Here's where the gaps start — and these aren't edge cases. They're the difference between "I can run agents" and "I can run agents in production and sleep at night."

### No Access Control

Dynamic Workflows runs as you, with your permissions, in your terminal. No RBAC. No roles. No way to say "this agent can read but not write" or "this agent needs approval before touching production."

Solo dev on your own machine? Fine. Three engineers sharing a Claude Code setup? That's a liability.

### No Audit Trail

Who approved that database migration? Which agent modified that config? When did session `abc123` change from `idle` to `working`?

Dynamic Workflows doesn't answer these questions. No hash-chained audit log. No immutable record. When compliance asks — and they will — you have terminal history and hope.

### No Cost Controls

Dynamic Workflows can spawn tens to hundreds of agents. Each one burns tokens. Each one costs real money. There's no budget enforcement, no cost dashboard, no "stop everything if we hit $50 today."

Solo dev watching their own API bill? Manageable. Five developers each spawning 50 agents? That's a budget explosion waiting to happen.

### No Approval Gates

When an agent wants to run `rm -rf`, write to production config, or push to main — Dynamic Workflows executes it. No approval queue. No Telegram notification asking "Allow this?" No way for a human to say "not that file."

Aegis has approval gates with Telegram, Slack, and Discord integration. Approve from your phone, reject from your desk. CC has none of this.

### No REST API

You can't call Dynamic Workflows from a CI pipeline. Can't trigger a workflow from a GitHub webhook. Can't integrate it into your existing tooling via HTTP.

It's a CLI feature, not infrastructure. That's the right call for CC — they're building a developer tool, not a platform. But it means you can't build programmatically on top of it.

### No Multi-Channel Delivery

Dynamic Workflows lives in the terminal. No Slack. No Telegram. No webhook to your monitoring stack. No SSE stream to a dashboard.

If you're at your computer, great. If you're in a meeting and your agent hits a permission prompt, you'd better have your laptop open.

## The Kubernetes Analogy

Think of it this way:

- **Claude Code** = the container runtime. It runs your agents. Getting better at orchestration every release.
- **Aegis** = the admission controllers, RBAC, audit log, cost monitoring, and API gateway on top.

Kubernetes didn't replace Docker. It built the governance layer that made Docker safe for production. Same relationship here. CC builds the engine. Aegis builds the control plane.

## What Aegis Adds on Top of Dynamic Workflows

| Capability | CC Dynamic Workflows | Aegis |
|---|---|---|
| Multi-agent orchestration | ✅ native | ✅ via pipelines + MCP |
| RBAC (admin/operator/viewer) | ❌ | ✅ 3 roles, strictRBAC mode |
| Audit trail (hash-chained) | ❌ | ✅ immutable, CSV/NDJSON export |
| Cost tracking + budget alerts | ❌ | ✅ per-session, per-key |
| Approval gates (Telegram/Slack/Discord) | ❌ | ✅ approve from your phone |
| REST API | ❌ | ✅ 108 endpoints |
| MCP server | ❌ | ✅ 34 tools |
| SSE real-time streaming | ❌ | ✅ per-session + global |
| Web dashboard | ❌ | ✅ React UI with session board |
| Prometheus metrics | ❌ | ✅ token usage, latency, health |
| OpenTelemetry tracing | ❌ | ✅ distributed tracing |
| CI/CD integration | ⚠️ CLI only | ✅ `ag run` + API |
| Kubernetes/Helm deployment | ❌ | ✅ production-ready |
| Client SDKs | ❌ | ✅ TypeScript + Python |

## The Honest Gap

We won't pretend Aegis has everything. Dynamic Workflows has something we don't: **native parallelism inside CC**. CC can decompose a task and distribute it across agents internally. Aegis manages sessions, but each session is one Claude Code process.

We're working on it. But the architectural difference matters: Aegis adds parallel agents as a **runner backend**, which means RBAC, audit, and cost tracking apply to every agent automatically. CC adds orchestration as a **CLI feature**, which means speed but no governance.

## When to Use Each

**Use Dynamic Workflows if:**
- You're a solo developer on your own machine
- You need fast parallel task execution right now
- You don't need audit trails, access control, or cost tracking
- Your entire workflow lives in the terminal

**Use Aegis if:**
- You integrate Claude Code into CI/CD pipelines
- Multiple people interact with the same agents
- You need to know what happened, when, and who approved it
- Cost visibility matters (you're paying the API bill)
- You want to approve agent actions from your phone
- You need a REST API, MCP tools, or a web dashboard

**Use both.** Run Dynamic Workflows for local parallelism. Put Aegis in front of it for governance. They're not mutually exclusive — Aegis wraps CC sessions, regardless of how they were created.

## The Silver Lining: CLAUDE_CODE_SESSION_ID

Here's the part we're genuinely excited about: CC v2.1.154 also added `CLAUDE_CODE_SESSION_ID` to the MCP server environment. Aegis can now bridge session context through MCP — cross-session memory, dashboard enrichment, per-session cost attribution.

CC gave us session identity for free. We're wiring it into our audit trail and cost tracking. When CC gets better at orchestration, Aegis gets better at governing it.

## Bottom Line

Dynamic Workflows is great for Claude Code. It makes CC more powerful, more useful, and more competitive. That's good for everyone — including Aegis.

Because every time CC adds orchestration power, the need for guardrails grows. CC builds the engine. We build the control plane.

The more powerful the engine, the more you need the control plane.

---

*Aegis is open-source (MIT), self-hosted, and runs in under 5 minutes: `npx --package=@onestepat4time/aegis ag run "your task" --cwd ./project`. [Get started](https://github.com/OneStepAt4time/aegis).*
