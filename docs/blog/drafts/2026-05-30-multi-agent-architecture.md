# Aegis Multi-Agent Architecture — How We're Building the Bridge to 28+ AI Coding Agents

*Technical deep-dive into how Aegis orchestrates multiple AI coding agents through a single control plane. For developers evaluating orchestration tools.*

---

## The Problem: One Agent is Not Enough

You're a developer. You use Claude Code for backend work, Codex for quick fixes, and Gemini CLI when you need Google's models. Right now, each agent lives in its own silo — different terminals, different approval flows, different dashboards.

The market agrees. cc-connect (11K+ GitHub stars) supports 10+ agent backends. OpenACP supports 28+. Ruflo supports 98. The future is multi-agent, and your orchestration tool needs to keep up.

But here's the thing: **most tools solve this by building adapters.** One adapter for Claude Code. One for Codex. One for Gemini. Each with its own transport, error handling, and lifecycle management. It works — until you have 10 adapters and they all break differently.

Aegis takes a different approach. Let me explain how.

## The Key Insight: Same Wire Protocol

Here's what most people don't realize: **Claude Code, Codex, and Gemini CLI all speak the same protocol.**

- **Claude Code** uses ACP (Agent Communication Protocol) — JSON-RPC 2.0 over stdin/stdout
- **Codex** uses `codex app-server --listen stdio://` — JSON-RPC 2.0 over stdin/stdout
- **Gemini CLI** uses `gemini --experimental-acp` — JSON-RPC 2.0 over stdin/stdout

Same protocol. Same transport. Same message format. The only difference is the binary name and the CLI flags.

This isn't a coincidence. The industry is converging on ACP as the standard wire protocol for AI coding agents. And that convergence means we don't need adapters — we need one transport, reused across runners.

## The Architecture: Middleware, Not Framework

Aegis's core principle (from our [ADR-0006](https://github.com/OneStepAt4time/aegis)) is that **Aegis is middleware**. We don't implement agent logic. We don't route models. We don't implement skills. We bridge, manage, audit, and secure.

The multi-agent architecture reflects this:

```
┌─────────────────────────────────────────────┐
│  REST API / MCP / SSE / Dashboard / CLI     │  ← Your interface (doesn't change)
├─────────────────────────────────────────────┤
│  Session Service                            │  ← Manages sessions (doesn't change)
│    → resolves agent → picks runner          │
├─────────────────────────────────────────────┤
│  Runner Registry                            │  ← The only new piece
│    → get("codex") → CodexRunner             │
├──────────┬──────────┬───────────────────────┤
│ Claude   │ Codex    │ Gemini CLI            │  ← Different binaries
│ Code     │ Runner   │ Runner                │     Same NdjsonRpcTransport
├──────────┴──────────┴───────────────────────┤
│  NdjsonRpcTransport (zero new code)         │  ← Already exists
└─────────────────────────────────────────────┘
```

**The session layer doesn't change.** Approvals, transcripts, SSE events, the dashboard — everything that works with Claude Code today works with Codex and Gemini tomorrow. The only thing that changes is which binary gets spawned under the hood.

This is the power of middleware. We solve the problem once at the transport layer, and everything above it comes for free.

## How Runners Work

Each runner implements the same `AgentRunner` interface:

```typescript
interface AgentRunner {
  start(sessionId: string, config: AgentConfig): Promise<void>;
  sendInput(input: string): Promise<void>;
  readOutput(): AsyncIterable<AgentOutput>;
  kill(): Promise<void>;
  isAlive(): boolean;
}
```

The implementation for each runner is surprisingly simple:

**Codex Runner:**
```typescript
export class CodexRunner implements AgentRunner {
  readonly name = 'codex';
  // Spawn: codex app-server --listen stdio://
  // Transport: NdjsonRpcTransport (same as Claude Code)
}
```

**Gemini Runner:**
```typescript
export class GeminiCliRunner implements AgentRunner {
  readonly name = 'gemini-cli';
  // Spawn: gemini --experimental-acp
  // Transport: NdjsonRpcTransport (same as Claude Code)
}
```

Different binary, same transport. Zero new transport code.

## Auto-Discovery: Zero Config

You shouldn't have to tell Aegis which agents you have installed. It should just know.

On startup, Aegis scans your PATH:

```
which claude   → /usr/local/bin/claude   → register claude-code runner
which codex    → /usr/local/bin/codex    → register codex runner
which gemini   → /usr/local/bin/gemini   → register gemini-cli runner
```

No config file needed. Install Codex, restart Aegis, and it shows up. If you want to override the binary path or add custom args, you can — in `aegis.config.ts`. But the default is zero config.

```bash
# This just works:
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
gemini setup
aegis start

# All three runners are available immediately.
```

## The Feature Matrix Problem

Not all runners are created equal. Claude Code supports MCP, custom system prompts, and fine-grained tool permissions. Codex and Gemini don't — yet.

Aegis handles this through a **capabilities API**:

```bash
curl http://localhost:9100/v1/runners
```

```json
{
  "runners": [
    {
      "name": "claude-code",
      "available": true,
      "capabilities": {
        "mcp": true,
        "customPrompts": true,
        "toolPermissions": true,
        "streaming": true
      }
    },
    {
      "name": "codex",
      "available": true,
      "capabilities": {
        "mcp": false,
        "customPrompts": false,
        "toolPermissions": false,
        "streaming": true
      }
    }
  ]
}
```

If you try to configure MCP servers on a Codex agent, Aegis returns a clear error: "Codex runner does not support MCP." No silent failures. No partial support. The API tells you what works and what doesn't.

## Dirty Shutdowns: Because Agents Crash

Agents crash. Processes hang. Networks fail. Aegis handles this gracefully:

1. **SIGTERM** — ask nicely. Send a close signal to the JSON-RPC stream.
2. **Wait 5 seconds** — give the agent time to clean up.
3. **SIGKILL** — force kill. Process group kill (`kill(-pgid, SIGKILL)`) takes out the agent and all child processes.
4. **Mark session crashed** — the session shows up in the dashboard with a clear error state.

No orphan processes. No zombie sessions. Clean shutdown, always.

## What's Next: The Bridge Pattern

Three runners cover 90% of the market today. But what about the other 10% — tools like Cursor, Copilot, or Kimi that use HTTP APIs instead of stdio?

The bridge pattern is our answer:

```
Aegis ──HTTP──▶ cc-connect ──▶ Codex/Gemini/Devin/etc.
                    │
                    └── bridge runner translates Aegis actions
                        to bridge-specific API calls
```

Instead of building an adapter for each HTTP-based agent, we bridge to existing tools (like cc-connect or OpenACP) that already support them. Aegis delegates lifecycle management to the bridge and focuses on what it does best: the control plane.

Bridge runners get a circuit breaker — if the bridge goes down, Aegis degrades gracefully (503 BRIDGE_UNAVAILABLE) instead of hanging or crashing. The dashboard shows the bridge health in real-time.

## Why Middleware Beats Adapters

The adapter pattern (what most tools use) has a scaling problem:

| Runners | Adapters | Code to Maintain | Failure Modes |
|---------|----------|-----------------|---------------|
| 3 | 3 | 3× transport code | 3× bugs |
| 10 | 10 | 10× transport code | 10× bugs |
| 28 | 28 | 28× transport code | 28× bugs |

The middleware pattern (what Aegis uses) scales differently:

| Runners | Transport Code | Runner Code | Failure Modes |
|---------|---------------|-------------|---------------|
| 3 | 1 (NdjsonRpcTransport) | 3 small classes | 1 transport + 3 spawn configs |
| 10 | 1-2 (stdio + HTTP) | 10 small classes | 2 transports + 10 spawn configs |
| 28 | 1-2 | 28 small classes | 2 transports + 28 spawn configs |

Same transport, different spawn commands. When a runner breaks, you fix one class — not the entire transport layer.

## Our Moat: Depth > Breadth

cc-connect has more runners. OpenACP has more runners. Ruflo has way more runners.

But Aegis has:
- **RBAC** (admin, operator, viewer roles)
- **Immutable audit trail** (every mutation logged)
- **MCP hooks** (more powerful than shell/HTTP hooks)
- **Full React dashboard** (session management, not just chat)
- **Session transcripts** (paginated, exportable)
- **Telegram approval** (approve agent actions from your phone)

We don't need 28 runners to win. We need 3 runners covering 90% of use cases, plus a control plane that makes them safe for production.

## Try It

Aegis is MIT-licensed, self-hosted, and runs locally.

```bash
git clone https://github.com/OneStepAt4time/aegis
cd aegis
npm install
aegis start
```

Create an agent, run a session, approve from your phone. Under 60 seconds.

If you're evaluating orchestration tools for AI coding agents, we'd love your feedback. And if you like what we're building, ⭐ us on GitHub — it helps more developers find Aegis.

---

*Scribe writes docs for [Aegis](https://github.com/OneStepAt4time/aegis) — the open-source control plane for AI coding agents. Architecture decisions documented in [ADR-0032](https://github.com/OneStepAt4time/aegis/blob/develop/docs/adr/0032-multi-agent-architecture.md). PRD available in the repo.*
