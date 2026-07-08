# Multi-CLI runtime — run Kimi Code & Gemini CLI through Aegis

Aegis is the control plane for **ACP-compatible** coding-agent CLIs. Claude Code
is the default and reference runtime; [Kimi Code](https://github.com/MoonshotAI/kimi-code)
and [Gemini CLI](https://github.com/google-gemini/gemini-cli) run as first-class
peers. One REST API, one dashboard, one approval flow — every ACP-speaking agent.

> Decision record: [ADR-0034](../adr/0034-positioning-multi-cli-agent-runtime.md).
> Phase 3.6 of the [ROADMAP](../../ROADMAP.md).

## How it works

Each agent CLI that speaks the [Agent Client Protocol](https://agentclientprotocol.com/)
(JSON-RPC over stdio: `initialize`, `session/new`, `session/prompt`,
`session/request_permission`, …) plugs into the same `AcpBackend`. Aegis only
swaps the **spawn config** per runner — binary, auth env prefixes, and the
permission-mode strategy. The whole protocol layer (events, approvals, fan-out,
event store) is reused unchanged.

| Runner | ACP | Binary | Auth env | Status |
|---|---|---|---|---|
| `claude-code` (default) | via Zed adapter | `claude-agent-acp` | `ANTHROPIC_*` / `CLAUDE_*` | production |
| `kimi` | native (`kimi acp`) | `kimi` | `KIMI_*` / `MOONSHOT_*` | Phase 3.6 — experimental |
| `gemini-cli` | native (`gemini --acp`) | `gemini` | `GEMINI_*` | planned (track `agy` ACP) |

## Create a Kimi session

```bash
# 1. Install + auth the Kimi Code CLI (one-time): https://github.com/MoonshotAI/kimi-code
# 2. Create a session through Aegis:
curl -X POST http://127.0.0.1:9100/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{
        "workDir": "./my-project",
        "runnerName": "kimi",
        "permissionMode": "acceptEdits",
        "prompt": "Add a JSDoc comment to src/foo.ts"
      }'
```

Everything else is identical to a Claude Code session: stream output via
`GET /v1/sessions/{id}/read`, approve tool calls from the dashboard or Telegram,
observe in the audit trail.

## Runner selection

`runnerName` is optional and defaults to `claude-code`. It is validated at the
API boundary — unknown values are rejected. The chosen runner drives the agent;
Claude Code remains the default + hard-installed reference runtime.

## BYO LLM, per runner

Aegis owns no LLM cost. Each runner authenticates with its own provider:
Claude Code via `ANTHROPIC_*`, Kimi via Moonshot OAuth / `MOONSHOT_API_KEY`,
Gemini via paid Gemini / Vertex. Aegis passes the auth env through; it does not
proxy, cache, or own model cost.

## What's NOT supported yet

- **Codex CLI** — no native ACP; enters via a bridge once
  [openai/codex#30052](https://github.com/openai/codex/issues/30052) lands.
- **Copilot CLI** — SaaS-only / subscription-bound; ACP still in preview. Watch,
  not build.
- Non-ACP runners are never first-class (ADR-0034 Decision 4: no per-harness
  adapters inside the runtime).
