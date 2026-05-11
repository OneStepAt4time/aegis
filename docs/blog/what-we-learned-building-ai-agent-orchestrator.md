# What We Learned Building an Open-Source AI Coding Agent Orchestrator

*Architecture decisions, protocol choices, and the enterprise-vs-simplicity tradeoff — 6 months of lessons from building Aegis.*

---

## The Problem That Found Us

We started with a simple need: run Claude Code from CI. Not "open a terminal and type a prompt." Run it *programmatically* — create a session, send a task, get the result, move on.

Claude Code has a CLI. It's great for interactive use. But when you want to:

- Run a code review on every PR automatically
- Let your team trigger coding sessions from Telegram or Slack
- Monitor what the AI is doing in real time from a web dashboard
- Audit every action for compliance

...the CLI alone doesn't cut it. You need orchestration.

So we built Aegis — an open-source orchestration server that sits between you and Claude Code. REST API, MCP server, web dashboard, Telegram/Slack integration. The whole stack.

Here's what we learned.

## Lesson 1: JSON-RPC Over Stdio Is Underrated

Claude Code speaks JSON-RPC over stdio. No HTTP server. No WebSocket. Just stdin/stdout with structured messages.

At first this felt limiting. "How do you build a web API on top of stdio?"

It turns out, this is a feature. The ACP (Agent Client Protocol) is beautifully simple:

```
Your App → spawn child process → write JSON-RPC to stdin → read JSON-RPC from stdout
```

No port conflicts. No firewall issues. No authentication between your orchestrator and the agent — the process boundary *is* the security boundary.

We built a `JsonRpcClient` that wraps this with timeout handling, cancellation, and notification listeners. The whole thing is ~500 lines of TypeScript. It's the most reliable part of our codebase.

**Takeaway:** If you're building agent infrastructure, stdio-based protocols are simpler and more reliable than network protocols. Use them when you can.

## Lesson 2: Events Are the Architecture

The hardest part of orchestrating an AI agent isn't sending commands. It's handling the responses.

Claude Code doesn't just return a result. It streams:
- Text deltas (partial output as it's generated)
- Tool calls (the agent wants to read a file, run a command, etc.)
- Permission requests ("I want to run `rm -rf`, is that okay?")
- Usage updates (token counts)
- Status transitions (running → idle → completed)

We modeled this as an event stream. Every ACP notification gets mapped to a normalized domain event:

```
ACP event → EventMapper → SessionEvent → fan-out to channels
```

The fan-out is critical. The same event that updates the web dashboard via SSE also sends a Telegram notification, triggers a webhook, and writes to the audit log. One event, multiple consumers.

**Takeaway:** Don't build request-response systems for agents. Build event-driven systems. The agent is a firehose of state changes, not a function that returns a value.

## Lesson 3: Permission Management Is a Security Surface

AI agents need permissions. "Can I read this file?" "Can I run this command?" "Can I write to this directory?"

In interactive use, Claude Code asks the user. In orchestrated use, you need to route these decisions:

1. **Auto-approve** — trusted operations in CI
2. **Route to human** — dangerous operations get forwarded to Telegram/Slack for approval
3. **Policy-based** — allow reads, deny deletes, require approval for network access

We built a permission guard that intercepts ACP permission requests and routes them based on configuration. The Telegram integration lets you approve or reject from your phone — the approval flows back through the server to the agent.

This is the feature people get most excited about. Not the REST API. Not the dashboard. The ability to say "yes, that's fine" from Telegram while you're away from your desk.

**Takeaway:** Permission management isn't a nice-to-have for agent orchestration. It's the primary security boundary. Design it early.

## Lesson 4: Session State Is Harder Than It Looks

"Create a session, send a task, get the result." Simple, right?

Here's what actually happens:

1. You create a session
2. The agent starts working
3. It asks a permission question
4. You don't answer for 2 hours
5. The server restarts (deployment, crash, update)
6. You come back and want to approve the permission

Now you need:
- Persistent state (what sessions exist, what state are they in)
- Session recovery (reconnect to still-running child processes after restart)
- Orphan reaping (clean up zombie processes)
- Terminal state handling (killed, completed, crashed — each has different cleanup)

We use a pluggable state store: JSON files for local dev, PostgreSQL + Redis for production. The state machine tracks transitions: `pending → running → idle → completed | killed | crashed`.

The hardest bug we fixed: `kill_session` wasn't reaping the child process. The session was dead in our state but Claude Code was still running in the background, consuming memory. For days.

**Takeaway:** Agent sessions have complex lifecycles. Model state transitions explicitly. Test crash recovery. Reap your child processes.

## Lesson 5: The Enterprise Tax Is Real (And Worth Paying)

We debated this one a lot. Do we add RBAC, audit trails, and rate limiting, or do we keep it simple?

The answer depends on your users. If you're building for solo developers, skip it. If you're building for teams — especially teams at companies with compliance requirements — you need:

- **Role-based access control.** Viewer (read-only), operator (create sessions, approve permissions), admin (manage keys, rotate tokens). Not a shared API key.
- **Audit trail.** SHA-256 chained logs with daily rotation. Tamper-evident. You need to be able to answer "who approved this change and when?"
- **Rate limiting.** Per-IP and per-key. Because someone will write a script that creates 10,000 sessions.
- **SSRF protection.** Blocklist for RFC 1918, loopback, link-local. Because someone will try to make your agent hit internal services.

Each of these adds complexity. But "add it later" means "rewrite the auth layer later." We chose to build it upfront.

**Takeaway:** Enterprise features aren't glamorous, but they compound. Every month you don't have RBAC is a month you can't close an enterprise adoption.

## Lesson 6: One Command Matters More Than You Think

Our original install flow:

```bash
npm install -g @onestepat4time/aegis
ag init          # 3 interactive prompts
ag               # start server
ag create "task" # create session
```

Four steps. Three of them require reading docs.

We just shipped `ag run`:

```bash
ag run "Build a REST API for managing tasks"
```

One command. If no server is running, it boots one. If no config exists, it creates one with defaults. Then it creates the session and streams output to your terminal.

Usage went up 3x internally. Not because the features changed — because the onboarding friction dropped to zero.

**Takeaway:** Your first-time experience is your most important feature. Optimize for "working in under 60 seconds" before you optimize for anything else.

## Lesson 7: The Dashboard Is the Debug Tool

We built a web dashboard thinking it would be a management tool. It turned out to be the most valuable debugging tool we have.

When a session stalls, you can:
- See the full event timeline (text, tool calls, permissions, usage)
- Watch the terminal output in real time
- See token usage breakdown (input vs. output vs. cache reads)
- Export the full transcript as JSONL or Markdown

You can't debug what you can't see. The dashboard made our orchestration debuggable.

**Takeaway:** Build observability into your agent infrastructure from day one. Not as an afterthought. Metrics, event streams, and a visual timeline are not luxuries — they're how you understand what the agent is doing.

## What We'd Do Differently

Honest retrospective:

1. **We should have started with multi-agent support.** We focused on Claude Code only. The ecosystem is moving to multi-agent (Codex, Gemini CLI, Cursor). Now we're retrofitting.
2. **We should have shipped `ag run` first.** The 4-step install was fine for power users but terrible for first impressions.
3. **We should have registered on distribution channels earlier.** Plugin marketplaces, awesome lists, ACP registries. We built a good product and then realized nobody could find it.

## Where We're Going

Aegis is open source (MIT), built in TypeScript, runs on Node.js 20+. We're working on multi-agent support, better CI/CD integration, and Kubernetes-native deployment.

If you're building with AI coding agents and need orchestration, come take a look. If you're building your own orchestration, hopefully these lessons save you some time.

---

*We're [Aegis](https://github.com/OneStepAt4time/aegis) — open-source Claude Code orchestration with REST API, MCP, RBAC, audit trails, and a web dashboard. Install in 2 commands:*

```bash
npm install -g @onestepat4time/aegis
ag run "Your task here"
```

---

*Published 2026-05-11. Feedback welcome — find us on [GitHub](https://github.com/OneStepAt4time/aegis) or [Discord](https://discord.com/invite/clawd).*
