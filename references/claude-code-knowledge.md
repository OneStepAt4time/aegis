# Claude Code Knowledge Base — Hephaestus

> Maintained by Hephaestus. Updated every heartbeat.
> CC is proprietary (native binary, npm wrapper only). Source not available on GitHub.

## Version Tracking
- **npm latest:** 2.1.119 (2026-04-25)
- **Native install (local):** 2.1.92 (outdated)
- **Binary shape:** bun-packed `cli.js`

## Key Architectural Facts
- CC is distributed as a native binary (not readable JS source)
- npm package `@anthropic-ai/claude-code` is a thin wrapper that downloads the binary
- GitHub repo `anthropics/claude-code` contains only plugins, scripts, docs
- Terminal UI: Ink (React-for-terminal) renderer
- Session format: JSONL transcripts
- MCP support: HTTP/SSE/WebSocket transports, OAuth support
- Agent teams: experimental (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), tmux-based teammate spawning

## Relevant CHANGELOG Highlights (2.1.117-2.1.119)

### 2.1.119
- `/config` settings persist to `~/.claude/settings.json`
- `--from-pr` now accepts GitLab MR, Bitbucket PR, GitHub Enterprise URLs
- `--print` mode honors agent `tools:` and `disallowedTools:` frontmatter
- `--agent <name>` honors agent definition's `permissionMode`
- Hooks: `PostToolUse`/`PostToolUseFailure` now include `duration_ms`
- Subagent and SDK MCP server reconfiguration now connects in parallel
- Fixed Agent tool with `isolation: "worktree"` reusing stale worktrees
- Fixed PR not linked to session when working in git worktree

### 2.1.118
- Hooks can invoke MCP tools directly via `type: "mcp_tool"`
- `--continue`/`--resume` finds sessions added via `/add-dir`
- Fixed `/fork` writing full conversation to disk per fork (now pointer + hydrate)
- Fixed subagents resumed via `SendMessage` not restoring explicit `cwd`

### 2.1.117
- Forked subagents enabled on external builds via `CLAUDE_CODE_FORK_SUBAGENT=1`
- Agent frontmatter `mcpServers` loaded for main-thread agent sessions via `--agent`
- Faster startup with concurrent MCP server connect (local + claude.ai)
- Native builds: Glob/Grep replaced by embedded `bfs`/`ugrep` via Bash tool

## Known Bugs Affecting Aegis

### CRITICAL: Ink renderer crash in tmux teammate mode (#52139)
- **CC issue:** anthropics/claude-code#52139 (2026-04-22)
- **Impact:** Ink renderer crashes in spawned teammate agents during tmux mode
- **Trigger:** Large MCP results, long single-line text, or specific character sequences
- **Aegis risk:** If we use teammate mode + tmux, subprocess crashes possible
- **Workaround:** Avoid teammate mode; use single-session orchestration

### IMPORTANT: MCP tools still prompt despite bypass-all (#52698)
- **CC issue:** anthropics/claude-code#52698 (2026-04-24)
- **Impact:** MCP tool calls trigger permission prompts even with bypass-all
- **Aegis risk:** Our permission handling may not suppress MCP prompts
- **Note:** Non-MCP tools (Bash, Read, Write, Edit) correctly bypass

### DESIGN: --tmux requires --worktree (#44355)
- **CC issue:** anthropics/claude-code#44355 (2026-04-06)
- **Impact:** Cannot use `--tmux` without `--worktree`
- **Aegis note:** We manage our own tmux panes, so this may not affect us directly
- **But:** If we ever use CC's native tmux mode, this constraint applies

### MONITOR: tmux session detachment on monitor events (#45976)
- **CC issue:** anthropics/claude-code#45976 (2026-04-10)
- **Impact:** Monitor events cause tmux session detachment
- **Aegis risk:** If CC detaches from tmux, Aegis loses the session

## Aegis-Relevant CC Behaviors
- CC writes JSONL transcripts for each session
- `--print` mode: non-interactive, good for one-shot tasks
- Permission modes: default, bypassPermissions (but MCP may still prompt)
- Worktree isolation available via Agent tool `isolation: "worktree"`
- `/resume` and `--continue` for session continuity
- Hooks: PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStop
