# Claude Code Competitive Intel — 2026-05-08

## CC Release Cadence (last 7 days)
- v2.1.133 (May 7) — worktree.baseRef, sandbox paths, parentSettingsBehavior, effort hooks
- v2.1.132 (May 6) — SESSION_ID env var, alternate screen opt-out
- v2.1.131 (May 6) — Windows/VSCode fix
- v2.1.129 (May 6) — plugin URL flag, sync output force, auto-update
- v2.1.128 (May 4) — random session colors, MCP tool counts, zip plugins

## Key New CC Features Aegis Should Track

### 1. Effort Level in Hooks (v2.1.133)
- CC now passes `effort.level` to hooks via JSON input + `$CLAUDE_EFFORT` env var
- **Aegis gap:** Our hook system doesn't surface effort level. If Aegis orchestrates CC sessions with different effort levels, hooks should know.
- **Action:** Consider passing effort metadata through Aegis hook pipeline.

### 2. Session ID in Bash Environment (v2.1.132)
- CC exposes `CLAUDE_CODE_SESSION_ID` to Bash tool subprocesses
- **Aegis gap:** Aegis already tracks session IDs, but doesn't inject them into CC's subprocess env.
- **Action:** Low priority — Aegis has its own session tracking.

### 3. worktree.baseRef Setting (v2.1.133)
- CC now lets users choose whether worktrees branch from `origin/<default>` or local `HEAD`
- **Aegis relevance:** Aegis creates worktrees for sessions. Should respect/pass this setting.
- **Action:** Check if Aegis worktree creation respects CC's baseRef preference.

### 4. parentSettingsBehavior (v2.1.133)
- Admin-tier merge policy for managed settings (`first-wins` | `merge`)
- **Aegis relevance:** Aegis operators managing multiple teams need settings merge control.
- **Action:** Evaluate for Phase 4 enterprise settings.

### 5. Plugin URL Support (v2.1.129)
- CC accepts `--plugin-url <url>` to fetch plugin zips
- **Aegis relevance:** Aegis could pre-fetch and validate plugin URLs before passing to CC.
- **Action:** Low priority.

## High-Demand CC Issues Aegis Could Address

| Issue | Reactions | Description | Aegis Opportunity |
|-------|-----------|-------------|-------------------|
| #6235 | 5035👍 | Support AGENTS.md | Aegis already injects context files — could auto-generate AGENTS.md from project config |
| #16561 | 147👍 | Parse compound Bash for permissions | Granular permission matching — Aegis permission pipeline could intercept |
| #45238 | 0👍 | Skills/documents for sub-agents | Aegis has skills infrastructure — could inject skills into spawned sessions |
| #45213 | 0👍 | Surface ultraplan agent stream in CLI | Real-time agent thought streaming — Aegis dashboard could show this |
| #57261 | 0👍 | Agent Teams: teammate replies stall | Multi-agent coordination — Aegis already manages parallel sessions |
| #57258 | 0👍 | Remote Control: unloggable session failures | Observability — Aegis captures all CC stdout/stderr |

## CC Bugs That Aegis Already Solves

1. **Parallel sessions 401 after refresh-token race** (v2.1.133 fix) — Aegis manages auth per-session
2. **MCP servers with 0 tools silently failing** (v2.1.129 fix) — Aegis lifecycle probe detects this
3. **Unbounded memory from MCP stdout** (v2.1.132 fix) — Aegis monitors session resource usage
4. **SIGINT not running graceful shutdown** (v2.1.132 fix) — Aegis signal handler cleanup

## Summary
Aegis's value proposition remains strong: multi-session orchestration, BYO LLM, channel-based permission prompts, and observability. CC is moving fast on settings management and worktree features — Aegis should keep pace by respecting new CC settings and passing them through.

The biggest opportunity is #6235 (AGENTS.md support) — 5035 reactions, still open. Aegis could ship this as a value-add layer on top of CC.
