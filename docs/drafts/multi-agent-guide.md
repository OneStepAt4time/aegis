<!--
  MULTI-AGENT GUIDE — STUB
  Issue: #3180 (Multi-Agent Support)
  Status: DRAFT — pending implementation
  
  Will be: docs/guides/multi-agent.md
  Linked from: getting-started.md, README
-->

# Multi-Agent Support — Using Codex and Gemini CLI with Aegis

Aegis supports multiple AI coding agents through its Runner system. Use Claude Code, OpenAI Codex, or Google Gemini CLI — all managed from the same dashboard, with the same approvals, audit trail, and MCP integration.

## Which Agents Are Supported?

| Agent | Transport | MCP | Custom Prompts | Tool Permissions | Multi-turn |
|-------|-----------|-----|----------------|-----------------|------------|
| Claude Code | ACP | ✅ | ✅ | ✅ | ✅ |
| Codex CLI | subprocess | ❌ | ❌ | ❌ | ✅ |
| Gemini CLI | subprocess | ❌ | ❌ | ❌ | ✅ |

> **Feature support varies by runner.** Check `GET /v1/runners` for the latest capabilities.

## Zero-Config Setup

Runners are discovered automatically. If `codex` or `gemini` is in your PATH, Aegis detects them at startup:

```bash
# Check what's available
ag runners list

# Output:
# claude-code   ✅ available   v2.1.145   /usr/local/bin/claude
# codex         ✅ available   v1.2.0     /usr/local/bin/codex
# gemini-cli    ❌ not found
```

No configuration needed. Install the CLI, restart Aegis, and it's available.

## Quick Start: Codex

```bash
# 1. Install Codex CLI
npm install -g @openai/codex

# 2. Set your API key
export OPENAI_API_KEY=sk-...

# 3. Create an agent profile for Codex
ag agent create \
  --name codex-dev \
  --runner codex \
  --model codex-mini

# 4. Run a session
ag run --agent codex-dev "Fix the TypeScript errors in src/auth/"
```

## Quick Start: Gemini CLI

```bash
# 1. Install Gemini CLI
npm install -g @anthropic-ai/gemini-cli
# or: pip install gemini-cli

# 2. Authenticate
gemini auth login

# 3. Create an agent profile for Gemini
ag agent create \
  --name gemini-dev \
  --runner gemini-cli \
  --model gemini-2.5-pro

# 4. Run a session
ag run --agent gemini-dev "Refactor the database layer to use connection pooling"
```

## Runner Configuration

Override defaults in `aegis.config.ts`:

```typescript
export default {
  runners: {
    // Custom binary path
    'claude-code': {
      command: '/opt/claude/bin/claude',
    },
    // Extra CLI args
    'codex': {
      args: ['--json', '--approval-mode', 'suggest'],
    },
    // Disable a runner (even if installed)
    'gemini-cli': {
      disabled: true,
    },
  },
  defaultRunner: 'claude-code',
};
```

| Config Option | Type | Description |
|--------------|------|-------------|
| `command` | string | Override binary path |
| `args` | string[] | Extra CLI arguments |
| `disabled` | boolean | Skip this runner even if installed |
| `env` | object | Extra environment variables |

## Runner Capabilities API

```
GET /v1/runners
```

```json
{
  "runners": [
    {
      "name": "claude-code",
      "family": "local",
      "protocol": "acp",
      "available": true,
      "version": "2.1.145",
      "binaryPath": "/usr/local/bin/claude",
      "capabilities": {
        "mcp": true,
        "customPrompts": true,
        "toolPermissions": true,
        "multiTurn": true,
        "streaming": true
      }
    },
    {
      "name": "codex",
      "family": "local",
      "protocol": "subprocess",
      "available": true,
      "version": "1.2.0",
      "binaryPath": "/usr/local/bin/codex",
      "capabilities": {
        "mcp": false,
        "customPrompts": false,
        "toolPermissions": false,
        "multiTurn": true,
        "streaming": false
      }
    }
  ]
}
```

## How It Works

```
ag run --agent codex-dev "fix the tests"
         │
         ▼
   ┌──────────────────┐
   │  Agent Profile    │  runner: "codex"
   │  (from #3971)     │  model: "codex-mini"
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Runner Registry  │  get("codex") → CodexRunner
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Transport Layer  │  subprocess: spawn `codex`
   └────────┬─────────┘
            │
            ▼
   ┌──────────────────┐
   │  Aegis Session    │  SSE, REST, MCP, dashboard
   │  (unchanged)      │  approve, reject, kill all work
   └──────────────────┘
```

The session layer is the same regardless of which runner is used. All existing features — approvals, transcripts, export, SSE events, audit trail — work identically.

## Graceful Degradation

When a feature isn't supported by a runner:

| Feature | CC supports, runner doesn't | Behavior |
|---------|-----------------------------|----------|
| MCP tools | ✅ | Agent starts without MCP. No error. |
| Custom prompts | ✅ | `instructions` field ignored. Session starts normally. |
| Tool permissions | ✅ | All tool use allowed (runner default). |
| Streaming | ✅ | Output delivered in chunks when session completes. |
| Binary not found | ❌ | `400 RUNNER_NOT_AVAILABLE`. Clear error with install instructions. |

## Troubleshooting

### "Runner not available"

```bash
# Check if binary is in PATH
which codex
which gemini

# Verify Aegis detected it
ag runners list

# Restart Aegis to re-discover
ag restart
```

### "Session hangs with Codex/Gemini"

Subprocess runners can hang if the CLI is waiting for interactive input. Make sure:
- API keys are set in environment or agent config
- The CLI is authenticated (`codex auth status`, `gemini auth status`)
- No interactive prompts are expected (use `--yes` or `--non-interactive` flags)

---

<!--
  TODO: Add when implementation ships
  - Bridge runner setup (cc-connect, OpenACP)
  - Per-runner cost tracking
  - Runner health monitoring
  - Feature comparison with competitors
-->
