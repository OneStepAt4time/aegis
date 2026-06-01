# Claude Code CHANGELOG Scan — Aegis Impact Analysis
# Scanned: v2.1.145 → v2.1.158 (May 2026)
# Scanner: Scribe, 2026-05-30

## HIGH IMPACT — Affects Aegis API Surface or Runner Interface

### 1. `CLAUDE_CODE_SESSION_ID` env var (v2.1.154)
- **What:** Stdio MCP server subprocesses now receive `CLAUDE_CODE_SESSION_ID` and `CLAUDECODE=1` in their environment
- **Aegis impact:** Our session spawn must pass these env vars to the CC runner subprocess. If Aegis doesn't set `CLAUDE_CODE_SESSION_ID`, CC won't propagate it to MCP servers.
- **Action:** Update CodexRunner/GeminiCliRunner to set `CLAUDE_CODE_SESSION_ID` in spawn env. PRD #3180 Section 7.4 (Environment Variable Isolation) already blocks overriding `AEGIS_*` vars — but we should explicitly pass CC's expected vars.
- **PRD update needed:** Yes — add `CLAUDE_CODE_SESSION_ID` and `CLAUDECODE=1` to the "required env vars for CC runner" list.

### 2. `agent` field in settings.json (v2.1.157)
- **What:** `claude agents` honors the `agent` field from settings.json for dispatched sessions, with `--agent <name>` override
- **Aegis impact:** CC now has its own agent concept. Aegis's Agent Profiles (#3971) may conflict or overlap with CC's native agent system.
- **Action:** Ensure Aegis's `agentId` → CC mapping is clean. When Aegis creates a session with `agentId: "codex-reviewer"`, it should NOT pass `--agent` to CC (CC's agents are different from Aegis's). Document the distinction clearly.
- **PRD update needed:** Yes — add clarification to #3971 PRD that Aegis agents ≠ CC agents.

### 3. `SessionStart` hook enhancements (v2.1.152)
- **What:** SessionStart hooks can now return `reloadSkills: true` and set `sessionTitle` via `hookSpecificOutput.sessionTitle`
- **Aegis impact:** Aegis's hook bridge already supports hooks. These new return fields need to be supported in our hook response handling.
- **Action:** Verify `POST /v1/hooks/SessionStart` response parsing handles `reloadSkills` and `sessionTitle` fields.
- **Docs update needed:** Yes — update hooks documentation with new response fields.

### 4. `MessageDisplay` hook event (v2.1.152)
- **What:** New hook event that lets hooks transform or hide assistant message text as it is displayed
- **Aegis impact:** New hook event type. Aegis's hook system may not support this event yet.
- **Action:** Check if `POST /v1/hooks/MessageDisplay` is supported. If not, add to roadmap.
- **Docs update needed:** Yes — add to API reference.

### 5. `disallowed-tools` in skill frontmatter (v2.1.152)
- **What:** Skills can now set `disallowed-tools` to remove tools from the model while active
- **Aegis impact:** If Aegis agents use skills with `disallowed-tools`, the runner needs to pass this through correctly.
- **Action:** Verify CC runner respects skill-level tool restrictions. No code change likely needed (CC handles it), but docs should note it.

### 6. `agent_id` in hook events (v2.1.145)
- **What:** Stop and SubagentStop hook input now includes `background_tasks` and `session_crons` fields. `agent_id` added to OTEL spans.
- **Aegis impact:** Hook events gain new fields. Our hook event processing should be forward-compatible (ignore unknown fields).
- **Action:** Verify hook event parsing doesn't break on unknown fields. Should be fine if we use JSON parsing with unknown field tolerance.

### 7. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` (v2.1.83, earlier)
- **What:** Strips Anthropic and cloud provider credentials from subprocess environments
- **Aegis impact:** If Aegis sets this env var, CC will strip credentials from MCP servers spawned within sessions. This could break MCP auth.
- **Action:** Do NOT set this var unless explicitly wanted. Document the interaction.

## MEDIUM IMPACT — Worth Noting

### 8. `--dangerously-skip-permissions` persistence (v2.1.143)
- CC now persists `--dangerously-skip-permissions` across retire→wake for background sessions
- Aegis should be aware that sessions with this flag stay permissive across restarts

### 9. `worktree.bgIsolation: "none"` setting (v2.1.143)
- Lets background sessions edit working copy directly without worktrees
- Could affect Aegis session isolation model if we spawn CC in background mode

### 10. MCP stdio servers receive `CLAUDE_PROJECT_DIR` (v2.1.139)
- MCP servers now know which project directory they're running in
- Aegis should pass this through when spawning CC with project context

## LOW IMPACT — No Action Needed

- Opus 4.8 support, fast mode, effort slider — model changes, not transport
- Plugin system improvements — CC-internal, Aegis doesn't manage CC plugins
- Background agent fixes — CC-internal lifecycle, Aegis manages at session level
- Terminal rendering fixes — not relevant to Aegis's stdio transport
- `/simplify` → `/code-review` rename — CC-internal command
