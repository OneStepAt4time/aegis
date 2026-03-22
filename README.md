# 🛡️ Aegis

**Orchestrate Claude Code sessions via API.**

Create, brief, monitor, refine, ship. The shield between your orchestrator and your coding agent.

---

## What is Aegis?

Aegis is an HTTP bridge that manages interactive [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions via tmux. It lets AI orchestrators (or humans) programmatically:

- **Create** Claude Code sessions with a project brief
- **Monitor** real-time progress via transcript parsing
- **Send** follow-up messages (refine, nudge, unblock)
- **Detect** session states (working, idle, stalled, asking questions)
- **Control** sessions (approve, reject, interrupt, kill)

Built for multi-agent systems where an orchestrator (like [OpenClaw](https://openclaw.ai)) delegates coding tasks to Claude Code.

## Quick Start

```bash
# Install
git clone https://github.com/OneStepAt4time/aegis.git
cd aegis
npm install
npm run build

# Run
npm start
# → Aegis listening on http://localhost:9100
```

## API

### Create a session
```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "feature-champion-stats",
    "cwd": "/path/to/project",
    "brief": "Build a ChampionStatsPage component..."
  }'
```

### Read session transcript
```bash
curl http://localhost:9100/v1/sessions/{id}/read
```

### Send a message (refine, nudge)
```bash
curl -X POST http://localhost:9100/v1/sessions/{id}/send \
  -H "Content-Type: application/json" \
  -d '{"message": "The nav links are missing from Header.tsx. Add them."}'
```

### Session lifecycle
```bash
# Approve a permission prompt
curl -X POST http://localhost:9100/v1/sessions/{id}/approve

# Interrupt current work
curl -X POST http://localhost:9100/v1/sessions/{id}/interrupt

# Kill session
curl -X DELETE http://localhost:9100/v1/sessions/{id}
```

## Architecture

```
Orchestrator (Zeus/OpenClaw/you)
    │
    ▼
  Aegis (HTTP API)
    │
    ├── Creates tmux windows
    ├── Launches Claude Code CLI
    ├── Sends briefs via tmux send-keys
    ├── Parses JSONL transcripts
    ├── Detects terminal state (idle/working/asking)
    └── Forwards events (Telegram, webhooks)
    │
    ▼
  Claude Code (interactive CLI in tmux)
```

## Session States

| State | Meaning |
|-------|---------|
| `working` | Claude Code is actively generating |
| `idle` | Waiting for input (task complete or paused) |
| `asking` | Claude Code asked a question |
| `permission_prompt` | Waiting for tool approval |
| `stalled` | No output for >5 minutes |

## Configuration

Aegis reads from `~/.aegis/config.json` (falls back to `~/.manus/config.json` for migration):

```json
{
  "port": 9100,
  "tmuxSession": "aegis",
  "claudePath": "claude",
  "stallThresholdMs": 300000,
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "your-bot-token",
      "chatId": "-100xxx"
    }
  }
}
```

## Notifications

Aegis can forward session events to:
- **Telegram** — topic per session, bidirectional replies
- **Webhooks** — POST events to any URL

## Built With

- [Fastify](https://fastify.dev) — HTTP server
- [tmux](https://github.com/tmux/tmux) — terminal multiplexer
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — AI coding agent
- TypeScript

## License

MIT — [Emanuele Santonastaso](https://github.com/OneStepAt4time)
