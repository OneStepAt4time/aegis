# Reddit Post — v0.7.0 Release

**Target subreddits:** r/ClaudeAI (primary), r/LocalLLaMA (secondary)  
**Title options below — pick one per subreddit**

---

## Title (r/ClaudeAI)

> I built open-source middleware that lets you approve Claude Code sessions from your phone — Aegis v0.7.0 ships Telegram one-tap approvals + zero-config init

## Title (r/LocalLLaMA)

> Open-source agent orchestration server with Telegram phone approvals — Aegis v0.7.0 (MIT, TypeScript, self-hosted)

---

## Body

We just shipped Aegis v0.7.0 — two features that solve the biggest pain point of running AI coding agents: **babysitting your terminal**.

### The problem

If you're running Claude Code for anything non-trivial, you know the cycle:

1. Start a session
2. Agent asks for permission to run a command
3. You approve
4. Agent works for 5 minutes
5. Agent asks for permission again
6. You approve again
7. Repeat until your agent is done or you get tired of watching

You're effectively chained to your terminal. Go to lunch? Your agent is stuck waiting. Step away? Everything pauses.

### What shipped

**1. One-tap Telegram session approval**

When Claude Code needs permission, Aegis sends a Telegram push notification with inline Approve ✅ / Reject ❌ buttons. Two taps from your phone. Your agent keeps running.

It works for session creation too — new session starts, you get a notification, approve it from your phone, agent goes to work.

Setup — set two env vars and restart Aegis:

```bash
export AEGIS_TG_BOT_TOKEN="<your-bot-token>"
export AEGIS_TG_GROUP="<your-chat-id>"   # positive for DM, negative for group
```

(or add `tgBotToken` / `tgGroupId` to `aegis.config.json`)

See [`docs/guides/phone-approvals.md`](https://github.com/OneStepAt4time/aegis/blob/develop/docs/guides/phone-approvals.md) for the full walkthrough.

The approval state machine is: `pending_approval → approved → running` or `rejected`. Timeout auto-reject if you don't respond within the configured window.

**2. Zero-config init**

```bash
npx @onestepat4time/aegis init
```

On a fresh machine with Node 22:
- Scaffolds `.aegis/config.yaml` with safe defaults
- Auto-detects a free port (9100 default)
- Starts the Aegis server as a detached process
- Waits for health check (up to 30s)
- Opens the dashboard in your browser

Under 60 seconds from `npx` to a running dashboard.

### What Aegis actually is

Because "middleware" can mean anything — here's the concrete architecture:

- **TypeScript + Fastify** server that spawns Claude Code as a child process via the Agent Client Protocol (ACP)
- JSON-RPC over stdio — no SDK dependency, no browser automation
- Normalizes ACP events into a unified API: REST endpoints, SSE streams, MCP tools
- Fans out to Telegram, Slack, Email, webhooks
- Stores session state in Postgres (file-backed by default for local use)

The API surface:
- 25+ REST endpoints (`/v1/sessions`, `/v1/pipelines`, `/v1/templates`, etc.)
- 34 MCP tools (`create_session`, `send_message`, `approve_permission`, `batch_create_sessions`, etc.)
- 3 MCP resources + 3 MCP prompts
- SSE event streams for real-time monitoring
- OpenAPI spec with generated TypeScript + Python client SDKs

Dashboard features: real-time session monitoring, cost analytics, audit trails, session search with date filtering, CSV export, dark/light theme, WCAG AA accessibility, keyboard shortcuts, i18n scaffolding.

Security: bearer token auth, SSE token separation, per-IP rate limiting, immutable hash-chained audit trail, OpenTelemetry tracing, Prometheus metrics, localhost-by-default binding.

### Why self-hosted

No telemetry. No phone-home. No data leaves your infrastructure. MIT license means no copyleft concerns. Your compliance team signs off faster.

### Tech stack

- TypeScript + Fastify (server)
- React + Vite (dashboard)
- Postgres (session store, enterprise tier)
- Vitest (tests — 5,200+ passing)
- OpenTelemetry + Prometheus (observability)

### Try it

```bash
# Zero to running in 60 seconds
npx @onestepat4time/aegis init

# Run your first agent
ag run "Summarize this project and suggest improvements" --cwd ./my-project

# Set up phone approvals (env vars AEGIS_TG_BOT_TOKEN and AEGIS_TG_GROUP)
# see docs/guides/phone-approvals.md for the full walkthrough
```

GitHub: https://github.com/OneStepAt4time/aegis  
npm: https://www.npmjs.com/package/@onestepat4time/aegis  
Discord: https://discord.com/invite/clawd  

MIT license. Self-hosted. No vendor lock-in.

Happy to answer questions or take feature requests in the comments.

---

**Posting notes for r/ClaudeAI:**
- Post timing: weekday morning US time for max visibility
- Monitor comments for first 2 hours, reply to every substantive response
- If someone asks "how is this different from cc-connect" — give the honest answer (cc-connect wins on breadth/messaging platforms, Aegis wins on dashboard/audit/API-first)
- Flair: "Show & Tell" or "Open Source"

**Posting notes for r/LocalLLaMA:**
- Lead with "self-hosted, MIT, TypeScript" — this community values that
- Emphasize the API/SDK surface and MCP tools
- De-emphasize Claude Code specifics — they care about the orchestration pattern
- Flair: "Project" or "Open Source"
