# Claude Code Competitive Intel — 2.1.92 → 2.1.138

## Installed: 2.1.92 | Latest: 2.1.138 (46 versions behind)

---

## HIGH IMPACT on Aegis

### 1. ACP Session ID now in env var (2.1.132)
- `CLAUDE_CODE_SESSION_ID` added to Bash tool subprocess env
- Aegis already tracks session IDs but CC now exposes it to subprocesses too
- **Action:** Verify Aegis passes this through correctly

### 2. Worktree baseRef change (2.1.133)
- `worktree.baseRef` setting: `fresh` (default, from origin) vs `head` (from local HEAD)
- Default changed BACK to `origin/<default>` — unpushed commits dropped in new worktrees
- **Action:** Aegis should set `worktree.baseRef: "head"` or be aware of this behavior

### 3. MCP OAuth improvements (2.1.133, 2.1.136)
- Fixed OAuth refresh race — multiple MCP servers no longer clobber each other's tokens
- Fixed HTTP(S)_PROXY not respected for MCP OAuth flow
- **Action:** Verify Aegis MCP server registration works with these fixes

### 4. Hooks receive effort level (2.1.133)
- Hooks now get `effort.level` JSON input and `$CLAUDE_EFFORT` env var
- **Action:** Aegis hooks should propagate effort level if applicable

### 5. Memory pressure handling (2.1.133)
- CC releases warm-spare background workers under memory pressure
- **Action:** Good — Aegis was hitting OOM. This may help with our memory issues

### 6. Subprocesses no longer inherit OTEL_* (2.1.128)
- Bash, hooks, MCP, LSP subprocesses no longer get OTEL env vars
- **Action:** Aegis OTEL setup may need adjustment if we relied on inheritance

### 7. Plan mode fixes (2.1.132, 2.1.136)
- Plan mode now blocks file writes even with matching Edit allow rule
- --permission-mode preserved on resume
- **Action:** Verify Aegis permission mode handling is compatible

### 8. MCP server name "workspace" reserved (2.1.128)
- **Action:** Ensure Aegis doesn't register an MCP server named "workspace"

## MEDIUM IMPACT

### 9. --resume / --continue fixes (2.1.132, 2.1.136)
- Fixed session finding when project path contains underscores
- Fixed emoji corruption on resume
- **Action:** Verify Aegis session resume paths don't hit these bugs

### 10. Sub-agent improvements (2.1.128, 2.1.133)
- Fixed subagents not discovering skills
- Fixed sub-agent summaries missing prompt cache
- Fixed sub-agent summaries firing repeatedly on idle
- **Action:** Aegis uses subagents — these fixes improve reliability

### 11. Context window token count fix (2.1.132)
- `context_window` now shows current usage, not cumulative
- **Action:** Aegis dashboard context meter may need to adapt

### 12. Gateway model discovery opt-in (2.1.129)
- `/v1/models` discovery now requires `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`
- **Action:** If Aegis uses gateway model discovery, need this env var

## LOW IMPACT (UI/UX fixes)

- Various terminal rendering fixes
- Plugin system improvements
- Slash command improvements
- Better error messages

## RECOMMENDATION

**Upgrade CC to 2.1.138.** Key reasons:
1. Memory pressure handling helps our OOM issues
2. OAuth race fix prevents credential loss with multiple MCP servers
3. Sub-agent fixes improve Aegis reliability
4. Worktree baseRef needs config awareness

The ACP child process (`claude-agent-acp`) is separate from the CLI and updates independently via `@agentclientprotocol/claude-agent-acp`. But the CLI version affects `ag run` behavior.
