<!-- 
  FIRST AGENT GUIDE — STUB
  Issue: #3971 (Agent Profiles)
  Status: DRAFT — pending API implementation
  
  This will be linked from getting-started.md as "Section 6: Your First Agent"
  or kept as a standalone guide in docs/guides/.
-->

# Your First Agent

Agents let you define reusable profiles for your AI coding sessions. Instead of passing the same flags every time, configure an agent once and reference it by name.

## What is an Agent?

An agent is a named configuration that bundles:

- **Runner** — which AI tool to use (Claude Code, Codex, Gemini CLI)
- **Model** — which model to prefer
- **Instructions** — custom system prompt additions
- **Environment** — API keys and config
- **MCP servers** — tool integrations

When you create a session with an agent, it inherits all of these settings automatically.

## Quick Start

### Create an Agent

```bash
# Create a backend-focused agent
ag agent create \
  --name backend-dev \
  --model claude-sonnet-4-20250514 \
  --instructions "Focus on backend TypeScript. Write tests first. Follow existing patterns."
```

### Use Your Agent

```bash
# Run a session with your agent
ag run --agent backend-dev "Refactor the auth module to use JWTs"
```

That's it. The session picks up the model, instructions, and any environment variables or MCP servers you configured.

## Managing Agents

```bash
# List all agents
ag agent list

# Get agent details
ag agent get backend-dev

# Update an agent
ag agent update backend-dev --model claude-opus-4-20250514

# Archive an agent (soft delete — existing sessions unaffected)
ag agent delete backend-dev

# Restore an archived agent
ag agent restore backend-dev
```

## Agent Config

You can also define agents in your `aegis.config.ts`:

```typescript
export default {
  agents: {
    'backend-dev': {
      runner: 'claude-code',
      model: 'claude-sonnet-4-20250514',
      thinkingLevel: 'high',
      maxConcurrentSessions: 3,
      instructions: 'Focus on backend TypeScript...',
      customEnv: {
        NODE_ENV: 'development',
      },
      mcpConfig: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', './src'],
        },
      },
    },
  },
};
```

## How Agents Work with Sessions

```
ag run --agent backend-dev "fix the tests"
         │
         ▼
   ┌─────────────────┐
   │  Agent Profile   │  ← your configuration
   │  - model         │
   │  - instructions  │
   │  - env vars      │
   │  - MCP servers   │
   └────────┬────────┘
            │ applied to
            ▼
   ┌─────────────────┐
   │  CC Session      │  ← inherits agent config
   │  - same model    │
   │  - prompt merged │
   │  - env injected  │
   │  - tools ready   │
   └─────────────────┘
```

Existing sessions are **never modified** by agent changes. Only new sessions pick up the updated config.

---

<!--
  TODO: Add when implementation ships
  - Multi-agent example (backend-dev + frontend-dev + reviewer)
  - Agent permissions (RBAC)
  - Agent limits (max concurrent sessions)
  - Dashboard screenshots
-->
