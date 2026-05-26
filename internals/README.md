# Aegis Internals — CC Source Reference

## Leaked Claude Code Source
- **Repo:** `nirholas/claude-code` (GitHub)
- **Local:** `~/projects/aegis-internals/claude-code`
- **Cloned:** 2026-03-31
- **Stats:** ~2200 files, ~266K lines TypeScript
- **Origin:** Leaked via .map files on npm package `@anthropic-ai/claude-code`

## Key Directories
- `src/tools/` — tool implementations (Bash, Read, Write, Edit, Search, etc.)
- `src/permissions/` — permission system (auto-approve, deny, prompts)
- `src/mcp/` — MCP bridge protocol
- `src/hooks/` — hook system (PreToolUse, PostToolUse, Stop, etc.)
- `src/session/` — session management, JSONL, context
- `src/terminal/` — terminal rendering, ink components
- `src/cli/` — CLI entry point, argument parsing
- `src/plugins/` — plugin system
- `src/skills/` — skill system
- `src/commands/` — slash commands
- `src/bridge/` — bridging/proxy layer
- `src/services/` — core services
- `src/assistant/` — assistant orchestration
- `src/context/` — context window management
- `src/coordinator/` — task coordination
- `src/state/` — state persistence
- `src/server/` — server components
- `src/schemas/` — Zod schemas (config, settings, etc.)
- `src/types/` — TypeScript type definitions
- `src/utils/` — utility functions
- `src/vim/` — vim mode
- `src/voice/` — voice mode

## How to Use
```bash
cd ~/projects/aegis-internals/claude-code
grep -r "permissionMode" src/ --include='*.ts' -l
cat src/tools/bash.ts
find src/ -type f -name '*.ts' | wc -l
```

## ⚠️ Important
- Leaked source — not officially released by Anthropic
- Use for understanding internals, architecture, and patterns
- Do NOT copy code directly
- The official repo `anthropics/claude-code` may differ significantly
