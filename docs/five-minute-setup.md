# 5-Minute Setup Guide

**From zero to your first Claude Code session — no config, no tokens, no friction.**

## What you need (1 minute)

- [Node.js ≥ 20](https://nodejs.org/) — check with `node --version`
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — check with `claude --version`
- Claude Code authenticated — check with `claude auth status`

> Don't have Claude Code? Install it: `npm install -g @anthropic-ai/claude-code` then run `claude` to authenticate. This is the only thing that takes real time — do it first.

## Run your first session (2 minutes)

```bash
npx --package=@onestepat4time/aegis ag run "Summarize this folder" --cwd ./my-project
```

That's it. You'll see Claude's response stream directly in your terminal.

Behind the scenes, `ag run`:
1. Bootstraps config (first run only — no prompts on localhost)
2. Starts the server on `http://127.0.0.1:9100`
3. Creates a Claude Code session
4. Streams the response to your terminal

When Claude needs permission (to run a command, write a file), you'll see a prompt. Approve or deny right there.

> **Tip:** Run from a directory under your home folder (`~/projects/`, `~/code/`, etc.). System temp dirs (`/tmp`) are not allowed by default. If you need to allow additional directories, set `allowedWorkDirs` in `~/.aegis/config.yaml` — changes take effect immediately without restart.

<details>
<summary>What you'll see</summary>

```
  🚀 ag run: Summarize this folder
  ✅ Session: my-project (abc12345)
  📊 Dashboard: http://127.0.0.1:9100

  📡 Streaming session output (Ctrl+C to stop)...

  👤 Summarize this folder
  🤖 This project contains a Node.js web server with...
```

</details>

## See it on the dashboard (30 seconds)

Open **http://127.0.0.1:9100/dashboard/** in your browser.

You'll see your session running, with status, cost tracking, and the full transcript.

## Manage sessions from the terminal (30 seconds)

```bash
# List all sessions
ag list

# Read a session's output (prefix matching works with ag read)
ag read abc12345

# Stream output live
ag tail abc12345-de12-4567-8910-abcdefgh1234

# Kill a session
ag kill abc12345-de12-4567-8910-abcdefgh1234
```

> Use `ag list --full-ids` to see complete UUIDs. `ag read` accepts short prefixes; `ag tail` and `ag kill` require the full UUID.

## Optional: Install globally (saves typing)

If you'll use Aegis regularly, install it globally — then you can skip the `npx` prefix:

```bash
npm install -g @onestepat4time/aegis
ag run "Your prompt here" --cwd ./my-project
```

## Optional: Approve from your phone (1 minute)

Set two environment variables, then restart Aegis:

```bash
export AEGIS_TG_BOT_TOKEN="<your-bot-token>"
export AEGIS_TG_GROUP="<your-chat-id>"   # positive for DM, negative for group
```

Or add them to `aegis.config.json`:

```json
{ "tgBotToken": "<token>", "tgGroupId": "<chat-id>" }
```

After restart, Claude's permission prompts arrive on Telegram — approve or deny from anywhere.

> 📖 For the full walkthrough (create a bot, get chat ID, configure security), see the [Phone Approvals guide](./guides/phone-approvals.md).

## Optional: Let Claude Code control Aegis (30 seconds)

Register Aegis as an MCP server in Claude Code:

```bash
claude mcp add --scope user aegis -- ag mcp
```

Now Claude can create sessions, read transcripts, and manage Aegis directly through MCP tools.

## Flags you might use

| Flag | What it does |
|------|-------------|
| `--cwd <path>` | Project directory (default: current dir) |
| `--name <name>` | Custom session name |
| `--yes` | Suppress status messages (CI / non-interactive) |
| `-y` | Auto-approve all permission prompts |
| `--model <model>` | Override the model for this session |
| `--effort <level>` | Reasoning effort: `low`, `medium`, `high` |
| `--no-stream` | Wait for session completion and print output (non-streaming) |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `claude: command not found` | `npm install -g @anthropic-ai/claude-code` then `claude login` |
| Session hangs without output | Run `claude auth status` — you must be logged in |
| `workDir is not in the allowed directories list` | Run from your home directory, or add the path to `allowedWorkDirs` in `~/.aegis/config.yaml` |
| `401 Unauthorized` | On localhost with a fresh install, this shouldn't happen. If it does, delete `~/.aegis/` and retry |
| `EADDRINUSE` | Port 9100 in use: `AEGIS_PORT=9200 ag run "..." --cwd ./my-project` |
| Dashboard won't load | Check Aegis is running: `curl http://127.0.0.1:9100/v1/health` |
| Session stuck | Interrupt it: `ag kill <full-session-id>` |

## Next

- [Getting Started](./getting-started.md) — full configuration reference
- [API Reference](./api-reference.md) — every endpoint documented
- [MCP Tools](./mcp-tools.md) — 34 tools for multi-agent workflows
- [Advanced Features](./advanced.md) — session export, pipelines, memory bridge

---

**Total time: ~5 minutes.** If it took longer, [file an issue](https://github.com/OneStepAt4time/aegis/issues/new) — that's a bug.
