# Why Aegis: The Open-Source Middleware for AI Coding Agents

*Choosing a Claude Code orchestration tool? Here's why we built Aegis, what the alternatives get right (and wrong), and when middleware beats monoliths.*

---

You're a developer. You've discovered Claude Code and your productivity just doubled. You start a session, describe what you want, and the AI writes, debugs, and refactors code alongside you.

Then you hit scale. You want to run sessions from CI. You want your team to trigger tasks from Slack. You want to know *what the AI did last Tuesday at 3pm* without digging through terminal history.

That's when you start looking for orchestration. And that's when the landscape gets confusing.

## The Problem: CLI-Only Doesn't Scale

Claude Code is a CLI tool. It's fantastic for interactive use — one developer, one terminal, one task at a time. But the moment you need any of these, you're on your own:

- **Programmatic access** — create sessions from scripts, CI pipelines, or chat bots
- **Multi-session management** — run 5 sessions in parallel, see which ones are idle, kill the stuck one
- **Audit** — who approved that production database migration the AI suggested?
- **Access control** — not everyone on the team should have admin access
- **Observability** — metrics on token usage, cost, session duration, tool call frequency
- **Integration** — webhooks, event streams, REST API endpoints your existing tools can call

You can cobble together shell scripts. You can run tmux in the background and pray. You can build a thin wrapper and call it a day. But you'll end up rebuilding the same things every team eventually needs.

That's the gap Aegis fills. Not another AI agent — **middleware** that makes your existing agent production-ready.

## The Landscape: What's Out There

The Claude Code orchestration space is crowded. Here are the options you're probably evaluating, what they get right, and where they fall short.

### cc-connect — Feature-Heavy, Enterprise-Light

**What it is:** Go binary with TOML config. 10+ agent backends, 11 chat platforms (including WeChat, QQ, DingTalk for the Asian market), natural language scheduling.

**What it gets right:**
- Chat platform breadth — 11 platforms is impressive
- Multi-agent support out of the box
- Natural language cron ("every Monday at 9am, run the tests")
- Simple binary download, zero Node.js dependency

**Where it falls short:**
- **No REST API** — TOML config only. You can't create a session from a curl command. No CI/CD integration path.
- **No audit trail** — no tamper-proof logging, no compliance story
- **No enterprise auth** — token-only. No OIDC, no RBAC, no SSO
- **No observability** — no Prometheus metrics, no OpenTelemetry tracing, no structured logging
- **Not container-native** — Go binary, not Docker/Kubernetes ready

cc-connect is the right choice if you want to send messages to Claude Code from WeChat and don't need anything beyond that. But if you're building infrastructure, the lack of an API is a dealbreaker.

### OpenACP — ACP-Native but Thin

**What it is:** `curl | bash` install. 28+ agent backends (Claude Code, Codex, Gemini, and more). Telegram, Discord, Slack integration.

**What it gets right:**
- Simplest install in the space — one command
- Broadest agent support — 28+ backends
- Budget limits per session
- Skill system (brainstorming, TDD, debugging presets)

**Where it falls short:**
- **No web dashboard** — CLI and Telegram only
- **No enterprise auth** — no OIDC, no RBAC
- **No audit trail** — no persistent logging
- **No API** — no REST endpoints for external consumers
- **Not deployable as infrastructure** — no Docker, no K8s

OpenACP is the most architecturally similar tool to Aegis. But it's missing the entire enterprise stack. If you need a dashboard, audit, or RBAC, you'll outgrow it fast.

### Verdent AI — Beautiful UX, Closed Ecosystem

**What it is:** Mac desktop app (Apple Silicon). Parallel agents, project memory, task decomposition. Italian-founded.

**What it gets right:**
- **Parallel agents** — multiple agents working simultaneously on the same codebase. This is the #1 feature every competitor lists.
- **Project memory** — remembers your preferences, learns over time. The AI gets better the more you use it.
- **Task decomposition** — break features into subtasks automatically, prioritize, execute.
- **ICSE 2026 Distinguished Paper** — academic credibility from their SEAlign behavioral alignment research.
- **BYOK + Eco Mode** — bring your own API key, cost control mode.

**Where it falls short:**
- **Mac only** — no Linux, no Windows, no Docker, no servers
- **Closed source** — you can't audit the code, self-host, or extend it
- **No API** — desktop app only. No CI/CD integration possible.
- **No multi-user** — single-user app, no team collaboration
- **No compliance** — no audit trail, no access control, no enterprise anything

Verdent AI is the best consumer AI coding tool we've seen. If you're a solo developer on a Mac who wants an AI pair programmer that remembers your style, it's genuinely excellent. But it's a consumer tool, not infrastructure.

## The Aegis Thesis: Middleware, Not Agent

Here's the core insight: **Aegis is not an AI agent.** It's the middleware that makes AI agents production-safe.

The other tools try to be everything — agent, orchestrator, UI, chat bot. Aegis does one thing: **sit between you and Claude Code and make it enterprise-ready.**

```
Your tools        →  Aegis API  →  Claude Code
(CI/CD, Slack,    (REST + MCP)  (ACP JSON-RPC
 dashboard, etc.)  108 endpoints  over stdio)
```

### What This Means in Practice

**Bring your own LLM.** Aegis doesn't pick models. It doesn't route between them. It orchestrates whatever agent you're running. Today that's Claude Code via ACP. Tomorrow it could be Codex or Gemini via the same runner abstraction. The API stays the same.

**MIT license.** Self-host on your infrastructure. Audit the code. Extend it with Fastify plugins. No vendor lock-in, no proprietary protocols, no "contact sales for enterprise features."

**Enterprise security from day one.** Not a premium add-on. Every endpoint has RBAC guards. OIDC/SSO for enterprise identity. Hash-chained audit trail. Sigstore release signing. Kubernetes + Helm deployment. These aren't checkboxes — they're architectural decisions that can't be bolted on later.

## Technical Depth: What's Under the Hood

### ACP — The Agent Control Protocol

Claude Code speaks JSON-RPC over stdio. Aegis wraps this in the Agent Control Protocol (ACP):

```
Your curl command
    ↓
Aegis REST API (POST /v1/sessions/:id/send)
    ↓
ACP JSON-RPC client (stdio ↔ child process)
    ↓
Claude Code (running in a child process)
    ↓
Hooks → Permission evaluation → SSE broadcast → Audit log
```

Every action goes through the same pipeline. Create a session, send a prompt, approve a permission — all routed through ACP, all logged, all observable.

### 35 MCP Tools

Connect Claude Code (or any MCP host) to Aegis and you get 35 tools:

- **Session lifecycle** — `create_session`, `send_message`, `kill_session`, `get_status`, `get_transcript`
- **ACP control** — `acp_submit_prompt`, `acp_approve`, `acp_reject`, `acp_interrupt`, `acp_escape`
- **Monitoring** — `server_health`, `get_session_metrics`, `get_session_summary`, `get_session_latency`, `capture_terminal`
- **State** — `state_set`, `state_get`, `state_delete` (cross-session Memory Bridge)
- **Pipelines** — `batch_create_sessions`, `create_pipeline`, `list_pipelines`
- **Management** — `health`, `list_tools`, `swarm`

```bash
# One command to connect
claude mcp add aegis -- ag mcp
```

### Session Lifecycle

Sessions go through well-defined states:

| State | What's happening |
|-------|-----------------|
| `pending` | Connecting to ACP runtime |
| `working` | Agent is actively processing |
| `idle` | Waiting for input |
| `permission_prompt` | Agent needs approval for a tool call |
| `compacting` | Context compression in progress |
| `killed` | Stopped via API (terminal) |
| `completed` | Finished normally (terminal) |
| `crashed` | Terminated unexpectedly (terminal) |

Terminal states (`killed`, `completed`, `crashed`) retain sessions for audit — you can always go back and read the transcript.

### Audit Trail

Every session action is recorded in a hash-chained, immutable audit log:

```bash
curl http://localhost:9100/v1/audit \
  -H "Authorization: Bearer $TOKEN"
```

Each entry chains to the previous one via SHA-256. Entries cannot be modified or deleted. Export as CSV or NDJSON for compliance reporting.

### Real-Time Dashboard

React-based web dashboard at `http://localhost:9100/dashboard/`:

- Session list with live status updates via SSE
- Real-time cost analytics with per-session breakdown
- Agent contribution tracking
- Permission approval queue
- Audit log browser

No setup required — it's there when you start the server.

## Getting Started

Two commands. No really:

```bash
# Run Aegis with a task
npx --package=@onestepat4time/aegis ag run "Analyze this project and list the main technologies." --cwd /path/to/your/project
```

That's it. `ag run` bootstraps the config, starts the server, creates a session, and streams output to your terminal.

For more advanced setups — authentication, multiple sessions, MCP integration — see the [Getting Started Guide](../getting-started.md).

## When to Choose Aegis

**Choose Aegis if:**
- You need a **REST API** to integrate AI coding into CI/CD, dashboards, or custom tooling
- You need **audit trails** for compliance (SOC2, GDPR, internal governance)
- You need **RBAC/OIDC** for team access control
- You want to **self-host** on your own infrastructure
- You need **observability** (Prometheus, OpenTelemetry, Grafana)
- You're building **infrastructure**, not just running interactive sessions

**Consider alternatives if:**
- You only need to send messages from Telegram/WeChat → cc-connect
- You want the simplest possible install for 28+ agent backends → OpenACP
- You're a solo Mac developer who wants an AI pair programmer → Verdent AI

We're not trying to be everything. We're trying to be the **production-grade middleware** that makes AI coding agents safe for teams and enterprises.

## The Road Ahead

Aegis is open source (MIT), actively developed, and shipping features weekly. Current focus areas:

- **Multi-agent support** — adding Codex and Gemini as runner backends via ACP
- **Install simplification** — reducing setup to a single command
- **Telegram integration** — proper bidirectional chat (approve/reject from mobile)
- **Enterprise hardening** — rate limiting, budget controls, session isolation

Star us on [GitHub](https://github.com/OneStepAt4time/aegis). Read the [docs](https://github.com/OneStepAt4time/aegis/tree/develop/docs). Join the [community](https://discord.com/invite/clawd).

**One step at a time.** ⭐

---

*This post is part of the [Aegis Blog](./). For the full competitive analysis, see the [Competitive Threat Matrix](../competitive-threat-matrix.md) and [Competitive Differentiators](../competitive-differentiators.md).*
