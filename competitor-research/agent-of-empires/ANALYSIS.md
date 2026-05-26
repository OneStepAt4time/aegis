# agent-of-empires — Competitor Analysis
**Date:** 2026-04-07
**Stars:** 1,457
**Language:** Rust

## What It Does
Terminal session manager per AI coding agents. Multi-agent parallelo su tmux.

## Key Features
| Feature | AoE | Aegis |
|---------|-----|-------|
| TUI dashboard | ✅ Rust | ❌ Web only |
| Multi-agent | ✅ 8+ types | ❌ CC only |
| Docker sandboxing | ✅ | ❌ |
| Diff view in TUI | ✅ | ❌ |
| Profiles/workspaces | ✅ | ❌ |
| MCP server | ❌ | ✅ |
| HTTP API | ❌ | ✅ |
| npm package | ❌ | ✅ |

## Gaps for Aegis
1. **TUI dashboard** — usabilità CLI senza browser
2. **Multi-agent** — Codex, Gemini CLI support
3. **Docker sandboxing** — isolation per test
4. **Diff view** — review senza lasciare tool
5. **Sound effects** — feedback audio status

## Source
`/tmp/agent-of-empires-src/`

## Deep Reading — Source Architecture (2026-04-08 01:52 AM)

### agents.rs — Centralized Agent Registry
- `AgentDef` struct: name, binary, aliases, detection method, yolo mode, instruction_flag, detect_status fn, container_env, hook_config, host_only
- `DetectionMethod` enum: Which (binary check) or RunWithArg
- `YoloMode` enum: CliFlag, EnvVar, AlwaysYolo
- `AgentHookConfig` struct: settings_rel_path, events (HookEvent[])
- Pattern: **Adding a new agent = adding one AgentDef entry + writing a status detection function**
- This is EXTREMELY clean and extensible — Aegis should adopt this pattern

### Key Insight for Aegis Multi-Agent
Instead of hardcoding Claude Code support, Aegis should have:
1. Agent registry with AgentDef-like structs
2. Pluggable status detection per agent
3. Hook-based status detection (not just tmux pane parsing)
4. YOLO mode support per agent type
5. Container env injection for sandboxing

### Architecture Comparison
| Aspect | AoE | Aegis |
|--------|-----|-------|
| Agent registry | ✅ AgentDef centralizzato | ❌ Hardcoded CC |
| Status detection | ✅ Hook + pane parsing | ✅ Pane parsing only |
| Multi-agent | ✅ 8+ agents | ❌ CC only |
| YOLO mode | ✅ Per-agent config | ✅ bypassPermissions |
| Sandbox | ✅ Docker | ❌ None |
| TUI | ✅ Rust TUI | ❌ Web only |
