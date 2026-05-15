# Claude Code Configuration Best Practices for Aegis

_Reference: how to configure CC for optimal use with Aegis (and in general)._

---

## Directory Structure

Every project using CC should have:
```
.claude/
├── settings.json          # Project settings (committed to git)
├── settings.local.json    # Local/secret settings (gitignored!)
├── hooks/                 # Automation hooks
│   ├── build-on-stop.sh   # Runs when CC finishes a task
│   └── type-check.sh      # Runs after every Edit/Write
├── skills/                # Reusable skill files
│   └── aegis-task.md      # How to work on this project
├── agents/                # Agent personas (optional)
├── commands/              # Slash commands (optional)
└── plans/                 # Saved plans (optional)
```

## settings.json (committed — no secrets)

Key sections:
- **permissions.allow**: Whitelist safe commands (git, npm, grep, etc.)
- **permissions.deny**: Block dangerous commands (rm -rf, push to main, read .env)
- **permissions.defaultMode**: `"acceptEdits"` for shared, `"bypassPermissions"` in local override
- **plansDirectory**: `.claude/plans`
- **attribution**: Set commit/PR author to the agent name

```json
{
  "permissions": {
    "allow": ["Bash(git *)", "Bash(npm *)", "Bash(npx *)", "Read", "Edit", "Write"],
    "deny": ["Bash(rm -rf /*)", "Bash(git push * main)", "Read(./.env)"],
    "defaultMode": "acceptEdits"
  }
}
```

## settings.local.json (gitignored — has secrets)

Key sections:
- **env**: API tokens, base URLs, model overrides
- **enabledMcpjsonServers**: Which MCP servers to enable
- **hooks**: PostToolUse / Stop hooks
- **enabledPlugins**: Superpowers marketplace plugins
- **permissions.defaultMode**: Override to `"bypassPermissions"` for autonomous agents
- **teammateMode**: `"tmux"` for Aegis-managed sessions

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "<token>",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5"
  },
  "enabledPlugins": {
    "claude-session-driver@superpowers-marketplace": true,
    "superpowers-lab@superpowers-marketplace": true
  },
  "permissions": {
    "defaultMode": "bypassPermissions"
  }
}
```

### Model overrides via env
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` — cheapest model for quick tasks
- `ANTHROPIC_DEFAULT_SONNET_MODEL` — main model
- `ANTHROPIC_DEFAULT_OPUS_MODEL` — most capable model
- These point CC to z.ai free models (GLM-5, GLM-5-turbo)

## Superpowers Plugin (RECOMMENDED)

The Superpowers marketplace adds useful capabilities:
- **claude-session-driver**: Session management, restore, continue
- **superpowers-lab**: Experimental features

Enable in settings.json:
```json
{
  "extraKnownMarketplaces": {
    "superpowers-marketplace": {
      "source": { "source": "github", "repo": "obra/superpowers-marketplace" }
    }
  },
  "enabledPlugins": {
    "claude-session-driver@superpowers-marketplace": true,
    "superpowers-lab@superpowers-marketplace": true
  }
}
```

## Hooks (CRITICAL for quality)

### PostToolUse — Edit|Write
Runs after every file edit. Use for:
- **Type checking**: `npx tsc --noEmit` catches TS errors immediately
- **Import validation**: Block forbidden imports
- **Style enforcement**: Block hardcoded values that should be variables

### Stop
Runs when CC finishes a task. Use for:
- **Full build verification**: tsc + build + test
- **Bundle size check**: Alert if bundle grew significantly
- **Stats reporting**: Show what changed

### Hook template
```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
# ... check FILE_PATH extension, run verification ...
exit 0  # Always exit 0 — hooks are informational, not blocking
```

## Skills

Skills are markdown files that teach CC how to work on your project. They appear as options when CC needs guidance.

A good skill has:
1. **Context**: Stack, architecture, patterns
2. **Workflow**: Step-by-step process
3. **Quality bar**: What "done" looks like
4. **Examples**: Real code patterns to follow

## Aegis-Specific Recommendations

For projects that use Aegis to manage CC sessions:

1. **Always set `bypassPermissions` in settings.local.json** — Aegis sessions run unattended
2. **Always have a Stop hook** — catches build failures before the orchestrator tries to merge
3. **Use PostToolUse hooks for fast feedback** — type-check on every edit, not just at the end
4. **Set `teammateMode: "tmux"`** — required for Aegis tmux-based session management
5. **Keep settings.json minimal and public** — it documents your project's coding standards
6. **Keep secrets in settings.local.json** — always gitignored

## Global CC Settings

Located at `~/.claude/settings.json`:
```json
{
  "extraKnownMarketplaces": { ... },
  "skipDangerousModePermissionPrompt": true,
  "enabledPlugins": { ... },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node .../hook.js", "timeout": 5 }] }]
  }
}
```

The SessionStart hook is how Aegis discovers new CC sessions (writes session_map.json).
