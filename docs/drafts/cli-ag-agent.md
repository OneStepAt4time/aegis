<!-- 
  CLI REFERENCE: AG AGENT — STUB
  Issue: #3971 (Agent Profiles)
  Status: DRAFT — pending CLI implementation
  
  Will be merged into the main CLI reference (user-guide.md or dedicated cli.md)
-->

# `ag agent` — Manage Agent Profiles

Create, list, update, and delete agent profiles. Agents are reusable configurations that sessions inherit.

## Commands

### `ag agent list`

List all active agents.

```bash
ag agent list
ag agent list --json
ag agent list --runner codex
```

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--runner <type>` | Filter by runner type |
| `--show-archived` | Include archived agents |

---

### `ag agent create`

Create a new agent profile.

```bash
ag agent create \
  --name backend-dev \
  --runner claude-code \
  --model claude-sonnet-4-20250514 \
  --instructions "Focus on backend TypeScript..."
```

| Flag | Required | Description |
|------|----------|-------------|
| `--name <name>` | ✅ | Agent name (alphanumeric, hyphens, underscores) |
| `--runner <type>` | ❌ | Runner type (default: `claude-code`) |
| `--model <model>` | ❌ | Model override |
| `--thinking <level>` | ❌ | Thinking level: none/low/medium/high |
| `--max-sessions <n>` | ❌ | Max concurrent sessions (default: 1) |
| `--instructions <text>` | ❌ | Custom system prompt additions |
| `--env KEY=VALUE` | ❌ | Environment variable (repeatable) |
| `--mcp <json>` | ❌ | MCP server config (JSON string) |

**Interactive mode:** Running `ag agent create` without flags launches an interactive prompt.

---

### `ag agent get`

Show agent details.

```bash
ag agent get backend-dev
ag agent get backend-dev --json
```

---

### `ag agent update`

Update an existing agent.

```bash
ag agent update backend-dev --model claude-opus-4-20250514
ag agent update backend-dev --instructions "Updated instructions..."
ag agent update backend-dev --max-sessions 5
```

Same flags as `create`. Only specified fields are updated.

---

### `ag agent delete`

Archive an agent (soft delete). Existing sessions are unaffected.

```bash
ag agent delete backend-dev
```

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation prompt |

---

### `ag agent restore`

Restore an archived agent.

```bash
ag agent restore backend-dev
```

---

## Integration with `ag run`

```bash
# Run a session with an agent profile
ag run --agent backend-dev "fix the auth tests"

# Combine agent with overrides
ag run --agent backend-dev --model claude-opus-4-20250514 "critical security fix"
```

When both `--agent` and flags like `--model` are provided, the explicit flag **overrides** the agent config.

---

<!--
  TODO: Add when implementation ships
  - Exit codes
  - Error messages
  - RBAC notes (which roles can create/delete agents)
-->
