# Agent Profiles — Getting Started Guide

**Agent Profiles** let you define reusable configuration templates for your AI coding sessions. Instead of passing model, instructions, and MCP config on every session, you create an agent once and reference it by name.

## Quick Start

### 1. Create your first agent

```bash
ag agent create \
  --name backend-dev \
  --model claude-sonnet-4-20250514 \
  --instructions "You are a backend TypeScript developer. Follow existing patterns. Write tests for every function." \
  --max-concurrent 3
```

### 2. Run a session with it

```bash
ag run --agent backend-dev "Add input validation to the /api/users endpoint"
```

That's it. The session automatically uses the model, instructions, and constraints from the `backend-dev` agent.

### 3. See your agents

```bash
ag agent list
```

```
NAME           MODEL                     SESSIONS  STATUS
backend-dev    claude-sonnet-4-20250514  0/3       active
reviewer       claude-opus-4-20250514    0/1       active
codex-fix      codex                     0/1       archived
```

## Agent Configuration

### What an agent configures

When you create a session with an agent, these settings are applied automatically:

| Field | What it does | Default |
|-------|-------------|---------|
| `model` | Which AI model to use | Runner default (Claude: Sonnet, Codex: GPT-5-mini, etc.) |
| `instructions` | Custom system prompt additions | None |
| `thinkingLevel` | Reasoning depth: none, low, medium, high | none |
| `customEnv` | Environment variables passed to the session | None |
| `customArgs` | Extra CLI flags passed to the runner | None |
| `mcpConfig` | MCP servers available to the session | None |
| `maxConcurrentSessions` | How many sessions can run simultaneously | 1 |
| `permissions` | What actions the session can perform | Inherited from your API key |

### Override behavior

Explicit flags **override** agent config. This means you can tweak without editing the agent:

```bash
# Override the model for this one session
ag run --agent backend-dev --model claude-opus-4-20250514 "Refactor the auth module"

# Override instructions
ag run --agent backend-dev --instructions "Focus only on the database layer" "Fix the migration"
```

Priority: **CLI flags > agent config > runner defaults**

## Common Patterns

### The Specialist

Create agents for different tasks. Each has its own model, instructions, and constraints.

```bash
# Backend developer — fast, follows patterns
ag agent create \
  --name backend \
  --model claude-sonnet-4-20250514 \
  --instructions "Write production TypeScript. Follow existing patterns in the codebase." \
  --max-concurrent 5

# Code reviewer — thorough, catches bugs
ag agent create \
  --name reviewer \
  --model claude-opus-4-20250514 \
  --instructions "Review code for bugs, security issues, and performance problems. Be thorough." \
  --max-concurrent 2

# Quick fixer — cheap, fast
ag agent create \
  --name fixer \
  --model claude-sonnet-4-20250514 \
  --thinking-level low \
  --instructions "Fix the specific issue. No refactoring, no scope creep." \
  --max-concurrent 10
```

```bash
ag run --agent backend "Add rate limiting to the API"
ag run --agent reviewer "Review PR #42"
ag run --agent fixer "Fix the failing test in auth.test.ts"
```

### The MCP-Enabled Agent

Give an agent access to specific MCP servers:

```bash
ag agent create \
  --name db-admin \
  --model claude-sonnet-4-20250514 \
  --instructions "You manage database migrations and schema changes." \
  --mcp-config '{
    "postgres": {
      "command": "npx",
      "args": ["@anthropic-ai/mcp-server-postgres"],
      "env": { "DATABASE_URL": "postgresql://localhost/mydb" }
    }
  }'
```

Every session with this agent gets the PostgreSQL MCP server automatically.

### The Constrained Agent

Limit what an agent can do:

```bash
ag agent create \
  --name readonly-reviewer \
  --model claude-opus-4-20250514 \
  --instructions "Review code. You can read files but not modify them." \
  --permissions "session:create,session:read,session:send"
```

> **Note:** Agent permissions can never exceed your API key's permissions. If your key doesn't have `session:kill`, your agent won't either — even if you try to set it.

## Managing Agents

### Update an agent

```bash
ag agent update backend-dev --model claude-opus-4-20250514 --max-concurrent 5
```

Changes affect **new sessions only**. Running sessions keep their original config.

### Archive an agent

```bash
ag agent archive old-reviewer
```

Archived agents:
- Disappear from the default list
- Can't be used for new sessions
- **Existing sessions continue running normally** — archive doesn't kill them

### Restore an agent

```bash
ag agent restore old-reviewer
```

### Delete permanently

Agent profiles use soft-delete (archive). There is no permanent delete — session history must survive agent deactivation. If you need to remove an agent completely, contact your admin.

## Using the API

### Create an agent

```bash
curl -X POST http://localhost:9100/v1/agents \
  -H "Authorization: Bearer $AEGIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "backend-dev",
    "description": "Backend TypeScript specialist",
    "model": "claude-sonnet-4-20250514",
    "instructions": "Write production TypeScript. Follow existing patterns.",
    "maxConcurrentSessions": 3
  }'
```

### Run a session with an agent

```bash
curl -X POST http://localhost:9100/v1/sessions \
  -H "Authorization: Bearer $AEGIS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "backend-dev",
    "message": "Add input validation to the /api/users endpoint"
  }'
```

### List agents

```bash
curl http://localhost:9100/v1/agents \
  -H "Authorization: Bearer $AEGIS_API_KEY"
```

## Security Model

### Permission inheritance

Agent permissions are always **≤ your API key's permissions**. The system enforces this:

1. **At creation:** You can only set permissions that your key has
2. **At session start:** Effective permissions = agent permissions ∩ current key permissions
3. **If your key changes:** Active sessions pick up the new permissions at the next API call

### Key rotation

If the API key that owns an agent is revoked:
- **Active sessions fail at the next API call** (hard fail, not graceful)
- **New sessions are rejected** — the agent's owner key is invalid
- **No fallback to default key** — explicit error: "Agent owner's API key is invalid"

### Archive vs. revoke

- **Archive** = prevents new sessions, active sessions continue
- **Key revoke** = kills everything at next API call

These are different tools for different situations. Archive when you want to phase out an agent. Revoke when there's a security concern.

### Rate limiting

| Action | Rate limit |
|--------|-----------|
| Create agent | 10 per minute per key |
| All mutations | 30 per minute per key |

## Naming Rules

Agent names must match `^[a-zA-Z0-9_-]+$`:
- ✅ `backend-dev`
- ✅ `code_reviewer_v2`
- ✅ `fixer`
- ❌ `Backend Dev` (spaces)
- ❌ `reviewer@main` (special characters)

Names must be unique within your API key scope. If the name is taken, you get `409 Conflict`.

## Dashboard

When the dashboard integration ships, you'll be able to:

- Browse all agents in a list view
- Create and edit agents with a form
- See which sessions are using each agent
- View agent usage metrics

## What's Next

- **Multi-Agent Support (#3180):** Use different runners (Codex, Gemini CLI) per agent
- **Squads (#3981):** Group agents into teams that collaborate on tasks
- **Task Queue (#3970):** Queue work items for agents to pick up

## Reference

- **API Reference:** `docs/api-reference.md` — full endpoint documentation
- **CLI Reference:** `docs/cli.md` — `ag agent` commands
- **PRD:** `references/prd-3971-agent-profiles.md` — product requirements
- **ADR-0024:** Agent Identity Model — architectural decisions
