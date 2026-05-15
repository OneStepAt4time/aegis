# Claude Code — Knowledge Base

_Updated: 30 Aprile 2026 — v2.1.86 through v2.1.123 (38 versions)_

## Versione
- **Installata:** v2.1.123
- **npm latest:** v2.1.123 ✅ allineato
- **Previous tracked:** v2.1.92 (2026-04-04)
- **Installazione:** `curl -fsSL https://claude.ai/install.sh | bash` (npm deprecated)
- **Native binary:** v2.1.113+ — CLI spawns native binary via per-platform optional dependency (not bundled JS)

## CLI Flags Rilevanti per Aegis

```bash
claude                          # Interactive mode (default)
claude -p "prompt"              # Print mode (one-shot, no interaction)
claude --print                  # Same as -p
claude --resume [id]            # Resume session (opt-in, by ID) — up to 67% faster on 40MB+ (v2.1.116)
claude --continue               # Continue last conversation
claude --permission-mode bypassPermissions  # Skip all permission prompts
claude --model <model>          # Specify model
claude --output-format json     # JSON output for -p mode
claude --verbose                # Verbose logging
claude --bare                   # v2.1.81: scripted mode — skips hooks, LSP, plugin sync
claude --channels               # v2.1.81: permission relay to phone
claude --worktree               # Use git worktree directory
claude --console                # Auth via Anthropic Console (API billing)
claude --from-pr <url>          # v2.1.111: accepts GitHub, GitLab MR, Bitbucket PR, GHE URLs
claude --agent <name>           # v2.1.111+: honors agent's permissionMode
```

### Flags che NON esistono (Aegis ha provato)
- ❌ `--no-resume` — NON ESISTE. Claude CLI non ha modo di disabilitare auto-resume.
- ❌ `--fresh` — NON ESISTE
- `--session-id <id>` — esiste ma solo per SAVE, non impedisce resume

### Resume behavior (CRITICO per Aegis)
Claude CLI in interactive mode SEMPRE auto-resume la latest session nella project directory.
- Path: `~/.claude/projects/<project-hash>/*.jsonl`
- Project hash: `-` + workDir senza leading `/` con `/` → `-`
  - `/home/user/projects/foo` → `-home-user-projects-foo`
- **Aegis fix (v1.2.0):** archivia .jsonl in `_archived/` prima di spawnare Claude
- **v2.1.116:** `/resume` up to 67% faster on 40MB+ sessions
- **v2.1.119:** `/resume` offers to summarize stale large sessions
- **v2.1.121:** `--resume` on large sessions with corrupted transcript lines — now skips corrupt line instead of failing

### New env vars (v2.1.93–v2.1.123)
```bash
CLAUDE_STREAM_IDLE_TIMEOUT_MS=90000     # Streaming idle watchdog (default 90s)
CLAUDE_CODE_FORK_SUBAGENT=1             # v2.1.117+: Forked subagents on external builds
CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1 # v2.1.123: Fixed OAuth 401 retry loop with this set
ANTHROPIC_BEDROCK_SERVICE_TIER=<tier>    # v2.1.122: Bedrock service tier
AI_AGENT=<agent-name>                   # v2.1.120: Subprocess attribution (gh, etc.)
DISABLE_UPDATES=1                       # v2.1.118: Blocks ALL update paths
ENABLE_PROMPT_CACHING_1H=1             # v2.1.108: 1-hour prompt cache TTL (vs default 5min)
```

## JSONL Transcript Format

Path: `~/.claude/projects/<hash>/<session-id>.jsonl`

### Message types
```jsonl
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"timestamp":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]},"timestamp":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"...","name":"...","input":{...}}]},"timestamp":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]},"timestamp":"..."}
```

### Content block types
- `text` — regular text
- `thinking` — extended thinking block
- `tool_use` — tool invocation (name + input)
- `tool_result` — tool output

### Tool names (per Aegis transcript parser)
- `Read`, `ReadNotebook` — file read
- `Write`, `MultiWrite` — file write
- `Edit` — file edit
- `Bash`, `Terminal` — command execution
- `Grep`, `Search` — text search
- `Glob`, `ListFiles` — file listing (v2.1.117: replaced by embedded bfs/ugrep on native builds)
- `AskUserQuestion` — user question
- `TodoWrite` — todo management
- `EnterWorktree` — v2.1.105: now has `path` parameter to switch into existing worktree
- `RemoteTrigger` — remote trigger (v2.1.101: fixed `run` action sending empty body)
- `Monitor` — v2.1.98: streaming events from background scripts
- `PushNotification` — v2.1.110: Claude sends mobile push notifications

### Session index
`~/.claude/projects/<hash>/sessions-index.json` — maps sessionId → fullPath

## Terminal UI Patterns (what Aegis parses)

### Idle prompt
```
─────────────────────────
  ❯
─────────────────────────
```
Detection: `❯` on its own line between `─` chrome separators

### Working/spinner
```
✻ Reading src/server.ts…
```
Spinner chars: `·`, `✻`, `✽`, `✶`, `✳`, `✢`
- Active = spinner + text with `…` or `...`
- **Except:** `✻ Worked for Xs` = FINISHED, not working

### Permission prompt
```
  Do you want to proceed?
  ...
  Esc to cancel
```
Also: `❯ 1. Yes` pattern

### Bash approval
```
  Bash command
  ...
  Esc to cancel
```

### Plan mode
```
  Would you like to proceed?
  ...
  ctrl-g to edit in ...
  Esc to cancel
```

### Ask question
```
  ☐ option
  ...
  Enter to select
```

### Settings modal
```
  Settings:... tab to cycle
  ...
  Esc to cancel
```

### TUI modes (v2.1.110+)
- `/tui` command and `tui` setting — flicker-free rendering
- `/focus` — focus view (replaces old Ctrl+O behavior)
- Ctrl+O — toggles verbose transcript (v2.1.110: changed from focus toggle)
- `CLAUDE_CODE_NO_FLICKER=1` — flicker-free alt-screen rendering (tmux-friendly)

## Hooks — COMPLETE REFERENCE (25+ events, 5 handler types)

### Handler types
- `command` — shell script, JSON on stdin, exit code + stdout for decision
- **`http`** — POST JSON to URL, response body = decision. **GAME CHANGER for Aegis.**
- `prompt` — LLM single-turn evaluation, returns yes/no
- `agent` — spawns subagent with tools (Read, Grep, Glob) for verification
- **`mcp_tool`** — v2.1.118: hooks can invoke MCP tools directly. **NEW for Aegis.**

### HTTP hook fields
```json
{
  "type": "http",
  "url": "http://localhost:9100/hooks/session-start",
  "timeout": 30,
  "headers": {"Authorization": "Bearer $MY_TOKEN"},
  "allowedEnvVars": ["MY_TOKEN"]
}
```
- POST body = event JSON input (same as command hook stdin)
- Response body = decision JSON (same format)
- Non-2xx = non-blocking error (execution continues)
- To block: return 2xx with `decision: "block"` or `hookSpecificOutput.permissionDecision: "deny"`

### MCP tool hook (v2.1.118 — NEW)
Hooks can now invoke MCP tools directly:
```json
{
  "type": "mcp_tool",
  "serverName": "aegis",
  "toolName": "session_update",
  "input": {"session_id": "...", "status": "working"}
}
```
- **Aegis impact:** hooks can call Aegis MCP tools directly — no HTTP round-trip needed
- Can be used in any hook event's handler chain

### All Hook Events

**Lifecycle (7):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| SessionStart | startup\|resume\|clear\|compact | No |
| SessionEnd | clear\|resume\|logout\|prompt_input_exit\|... | No |
| UserPromptSubmit | (none, always fires) | No |
| Stop | (none, always fires) | No |
| StopFailure | rate_limit\|auth_failed\|billing_error\|server_error\|... | No |
| TeammateIdle | (none) | No |
| TaskCompleted | (none) | No |

**Tool hooks (4, in agentic loop):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| PreToolUse | tool name (Bash, Edit\|Write, mcp__server__tool) | YES (deny/block) |
| PermissionRequest | tool name | YES (approve/deny) |
| PostToolUse | tool name | No |
| PostToolUseFailure | tool name | No |

**Agent hooks (2):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| SubagentStart | agent type | No |
| SubagentStop | agent type | No |

**Context hooks (3):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| PreCompact | manual\|auto | YES (v2.1.105: can BLOCK via exit 2 or `{"decision":"block"}`) |
| PostCompact | manual\|auto | No |
| InstructionsLoaded | session_start\|nested_traversal\|path_glob_match\|include\|compact | No |

**Environment hooks (4):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| CwdChanged | (none, always fires) | No |
| FileChanged | filename (basename) | No |
| ConfigChange | user_settings\|project_settings\|local_settings\|policy_settings\|skills | No |
| WorktreeCreate | (none) | YES (hookSpecificOutput.worktreePath) |

**MCP hooks (2):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| Elicitation | MCP server name | YES |
| ElicitationResult | MCP server name | No |

**Notification (1):**
| Event | Matcher | Decision? |
|-------|---------|-----------|
| Notification | permission_prompt\|idle_prompt\|auth_success\|elicitation_dialog | No |

### MCP tool matching pattern
`mcp__<server>__<tool>` — regex matchable. Examples:
- `mcp__memory__.*` — all memory server tools
- `mcp__.*__write.*` — any write tool from any server

### Hook enhancements (v2.1.93–v2.1.123)

#### PostToolUse output replacement (v2.1.121 — MAJOR)
PostToolUse hooks can now replace tool output for **ALL tools** via `hookSpecificOutput.updatedToolOutput` (was MCP-only).
```json
{
  "hookSpecificOutput": {
    "updatedToolOutput": "sanitized or transformed output"
  }
}
```
- **Aegis impact:** can intercept and transform any tool output — security scanning, formatting, filtering

#### PreCompact blocking (v2.1.105)
PreCompact hooks can now BLOCK compaction:
- Exit code 2 = block
- JSON response: `{"decision": "block"}`
- **Aegis impact:** prevent context loss during compaction if Aegis needs to preserve state

#### UserPromptSubmit sessionTitle (v2.1.94)
`hookSpecificOutput.sessionTitle` — set session title from hook.

#### Other hook fixes
- v2.1.118: Fixed `prompt` hooks re-firing on tool calls made by agent-hook verifier subagent
- v2.1.110: Fixed `PreToolUse` hook `additionalContext` dropped when tool call fails
- v2.1.110: Fixed `PermissionRequest` hooks returning `updatedInput` not re-checked against deny rules
- v2.1.116: Same `PermissionRequest` fix applied again
- v2.1.101: Fixed `permissions.deny` rules not overriding PreToolUse hook's `permissionDecision: "ask"`
- v2.1.97: Fixed prompt-type Stop/SubagentStop hooks failing on long sessions

### Aegis HTTP Hook Architecture (PLANNED)
```json
{
  "hooks": {
    "SessionStart": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/session-start"}]}],
    "Stop": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/stop"}]}],
    "StopFailure": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/stop-failure"}]}],
    "PermissionRequest": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/permission"}]}],
    "PostToolUse": [{"matcher": "Edit|Write|MultiWrite", "hooks": [{"type": "http", "url": "http://localhost:9100/hooks/post-tool-use"}]}],
    "TaskCompleted": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/task-completed"}]}],
    "SessionEnd": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/session-end"}]}],
    "PreCompact": [{"hooks": [{"type": "http", "url": "http://localhost:9100/hooks/pre-compact"}]}]
  }
}
```

### Aegis current uses
- `SessionStart` (command) → writes `session_map.json` (maps tmux window → CC session ID)
- `Stop` (command) → receives stop event via /v1/sessions/:id/hooks/stop
- `PermissionRequest` (command) → receives via /v1/sessions/:id/hooks/permission
- **TODO:** Migrate ALL to HTTP hooks for zero-latency
- **TODO:** Add PreCompact hook to preserve Aegis state before compaction
- **TODO:** Explore `mcp_tool` hook type for direct Aegis MCP calls from hooks

## Version-by-Version Changes (v2.1.93 → v2.1.123)

Only Aegis-relevant changes listed. Full changelog at: https://docs.anthropic.com/en/docs/claude-code/changelog

### v2.1.123 (2026-04-30)
- Fixed OAuth 401 retry loop when `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`
- **Aegis:** stability fix if experimental betas env var is used

### v2.1.122 (2026-04-29)
- `ANTHROPIC_BEDROCK_SERVICE_TIER` env var
- `/mcp` shows hidden claude.ai connectors
- OpenTelemetry: numeric attrs on api_request/api_error now numbers not strings
- `claude_code.at_mention` OTEL event
- 🔴 **FIX:** Remote control idle status redrawing 2x/sec flooding tmux pipes — **CRITICAL for Aegis tmux management**. Was causing massive tmux pipe spam in idle sessions.
- Fixed blank assistant messages from stale view preference

### v2.1.121 (2026-04-28)
- 🔴 **`alwaysLoad` option for MCP server config** — tools skip deferred tool-search. Aegis MCP server should use this for zero-latency tool discovery.
- 🔴 **PostToolUse hooks: `hookSpecificOutput.updatedToolOutput` for ALL tools** (was MCP-only). **MAJOR for Aegis** — can now transform any tool output.
- `CLAUDE_CODE_FORK_SUBAGENT=1` works in non-interactive sessions
- MCP servers auto-retry up to 3 times on transient startup errors
- SDK: `mcp_authenticate` supports `redirectUri`
- Fixed unbounded memory growth (multi-GB RSS) with many images
- Fixed `/usage` leaking ~2GB on large histories
- Fixed Bash tool permanently broken when started directory is deleted/moved
- Fixed `--resume` on large sessions with corrupted transcript lines (now skips corrupt line)
- 🔴 **FIX:** Scrollback duplication on Ctrl+L/resize in tmux, GNOME Terminal, Windows Terminal, Konsole. **Relevant for Aegis tmux parsing.**
- Fixed "Always allow" rules for built-in tools in remote sessions not surviving worker restarts
- Fixed invalid legacy enum values in settings.json invalidating entire file

### v2.1.120 (2026-04-27)
- `claude ultrareview [target]` subcommand for CI/scripts
- `AI_AGENT` env var for subprocesses (gh attribution)
- 🔴 **FIX:** Pressing Esc during stdio MCP tool call closing entire server connection (regression in v2.1.105). **Critical for Aegis — was killing MCP connections.**
- Fixed `/rewind` not responding after `--resume`
- Fixed false-positive "Dangerous rm operation" in auto mode for multi-line bash with pipe+redirect
- 🔴 **FIX:** `find` in Bash tool exhausting file descriptors on large directory trees (host-wide crashes). **Security/stability fix.**

### v2.1.119 (2026-04-26)
- Forked subagents enabled on external builds via `CLAUDE_CODE_FORK_SUBAGENT=1`
- Agent frontmatter `mcpServers` loaded for main-thread agents via `--agent`
- `/resume` offers to summarize stale large sessions
- **Concurrent MCP server connect now default** — improves Aegis MCP startup
- Fixed Plain-CLI OAuth dying with "Please run /login" when access token expires mid-session — now refreshes reactively on 401
- Fixed WebFetch hanging on very large HTML pages (truncates before HTML→markdown)
- Fixed Opus 4.7 showing inflated `/context` percentages (was computing against 200K instead of 1M)

### v2.1.118 (2026-04-25)
- 🔴 **Hooks can invoke MCP tools directly via `type: "mcp_tool"`** — **NEW HOOK TYPE for Aegis**. Hooks can call Aegis MCP tools without HTTP.
- `/config` settings persist to settings.json
- `DISABLE_UPDATES` env var — blocks ALL update paths
- Auto mode: `"$defaults"` in allow/soft_deny/environment adds custom rules alongside built-ins
- Fixed MCP OAuth token refresh without cross-process lock under contention
- Fixed macOS keychain race overwriting fresh OAuth token
- Fixed credential save crash on Linux/Windows corrupting credentials.json
- Fixed connecting to remote session overwriting local model setting
- Fixed `prompt` hooks re-firing on tool calls made by agent-hook verifier subagent

### v2.1.117 (2026-04-24)
- Forked subagents on external builds via `CLAUDE_CODE_FORK_SUBAGENT=1`
- `cleanupPeriodDays` now covers tasks/, shell-snapshots/, backups/
- Native builds: Glob/Grep replaced by embedded bfs/ugrep via Bash tool (macOS/Linux)
- Default effort for Pro/Max on Opus 4.6/Sonnet 4.6 now `high`
- Fixed Plain-CLI OAuth dying mid-session on token expiry — reactive 401 refresh
- Fixed crash when proxy returns HTTP 204 No Content
- Fixed NO_PROXY not respected for remote API requests under Bun
- Fixed Opus 4.7 sessions showing inflated context (200K vs 1M)

### v2.1.116 (2026-04-23)
- `/resume` up to 67% faster on 40MB+ sessions
- **Faster MCP startup** — resources/templates deferred
- Bash tool hints when `gh` hits rate limits
- Security: sandbox auto-allow no longer bypasses dangerous-path check for rm/rmdir
- Fixed scrollback duplication in inline mode
- Fixed `/branch` rejecting >50MB transcripts
- Fixed `PermissionRequest` hooks returning `updatedInput` not re-checked against deny rules
- Fixed `setMode:'bypassPermissions'` now respects `disableBypassPermissionsMode`

### v2.1.114 (2026-04-22)
- Fixed crash in permission dialog when agent teams teammate requests tool permission

### v2.1.113 (2026-04-21)
- **Changed CLI to spawn native binary via per-platform optional dependency** (not bundled JS)
- `sandbox.network.deniedDomains` setting
- **Subagents stall mid-stream now fail after 10 minutes** instead of hanging — important for Aegis timeout handling
- Security: macOS `/private/{etc,var,tmp,home}` treated as dangerous removal targets
- Security: Bash deny rules now match commands wrapped in env/sudo/watch/ionice/setsid
- Security: `Bash(find:*)` no longer auto-approves `find -exec`/`-delete`
- 🔴 **FIX:** MCP concurrent-call timeout — message for one tool could disarm another's watchdog. **Critical for Aegis multi-tool concurrency.**
- Fixed `dangerouslyDisableSandbox` running commands outside sandbox without prompt
- Fixed `CLAUDE_CODE_EXTRA_BODY output_config.effort` causing 400 on subagent calls
- Fixed Remote Control not streaming subagent transcripts

### v2.1.112 (2026-04-20)
- Fixed "claude-opus-4-7 temporarily unavailable" for auto mode

### v2.1.111 (2026-04-19)
- Claude Opus 4.7 xhigh effort level
- Auto mode available for Max subscribers on Opus 4.7
- `/effort` interactive slider
- `/less-permission-prompts` skill — proposes allowlist from transcript
- `/ultrareview` for comprehensive code review
- **Auto mode no longer requires `--enable-auto-mode`** — now available by default
- Read-only bash with globs no longer triggers permission prompt
- `--from-pr` accepts GitLab MR, Bitbucket PR, GitHub Enterprise URLs
- `--print` mode honors agent's tools/disallowedTools
- `--agent <name>` honors agent's permissionMode
- Fixed terminal display tearing in iTerm2 + tmux when notifications sent
- Fixed 429 rate-limit errors referencing status.claude.com for Bedrock/Vertex
- Fixed plugin dependency errors distinguishing conflicting/invalid/complex requirements

### v2.1.110 (2026-04-18)
- `/tui` command and `tui` setting — flicker-free rendering
- Push notification tool — Claude sends mobile push notifications
- **Changed Ctrl+O to toggle verbose transcript; new `/focus` for focus view**
- `--resume`/`--continue` resurrects unexpired scheduled tasks
- Write tool informs model when user edits proposed content in IDE
- Session recap enabled for telemetry-disabled users
- 🔴 **FIX:** MCP tool calls hanging indefinitely when server drops mid-response. **Critical for Aegis MCP reliability.**
- Fixed `PermissionRequest` hooks returning `updatedInput` not re-checked against deny rules
- Fixed `PreToolUse` hook `additionalContext` dropped when tool call fails
- Fixed subagent transcript not cleaned up on session exit
- Fixed "Open in editor" command injection from untrusted filenames

### v2.1.109 (2026-04-17)
- Improved extended-thinking indicator with rotating progress hint

### v2.1.108 (2026-04-16)
- `ENABLE_PROMPT_CACHING_1H` env var for 1-hour prompt cache TTL
- Recap feature — context when returning to session
- Built-in slash commands discoverable via Skill tool
- `/undo` alias for `/rewind`
- Reduced memory for file reads/edits by loading language grammars on demand
- Fixed paste not working in /login code prompt (regression in v2.1.105)
- Fixed subscribers with DISABLE_TELEMETRY falling back to 5-min cache instead of 1hr
- Fixed session titles showing placeholder for short greetings
- Fixed diacritical marks dropped when language setting configured

### v2.1.107 (2026-04-15)
- Show thinking hints sooner

### v2.1.105 (2026-04-14)
- **`path` parameter on EnterWorktree tool** — switch into existing worktree
- 🔴 **PreCompact hook support** — hooks can block compaction (exit 2 or `{"decision":"block"}`)
- Background monitor support for plugins
- `/proactive` alias for `/loop`
- **Improved stalled API stream:** aborts after 5 min no data, retries non-streaming
- Improved stale agent worktree cleanup (handles squash-merged PRs)
- Fixed queued user prompts disappearing from focus mode
- 🔴 **FIX:** stdio MCP malformed output hanging session instead of failing fast. **Critical for Aegis — prevents MCP hangs.**
- Fixed MCP tools missing on first turn of headless sessions

### v2.1.101 (2026-04-10)
- `/team-onboarding` command
- OS CA certificate store trust by default
- Improved `/resume` to accept session titles set via `/rename`
- Fixed command injection in POSIX `which` fallback for LSP detection
- Fixed memory leak from historical message list copies in virtual scroller
- Fixed hardcoded 5-min request timeout aborting slow backends regardless of API_TIMEOUT_MS
- Fixed `permissions.deny` rules not overriding PreToolUse hook's `permissionDecision: "ask"`
- Fixed subagents not inheriting MCP tools from dynamically-injected servers
- Fixed sandboxed Bash commands failing with mktemp after fresh boot
- Fixed `claude mcp serve` tool calls failing with "Tool execution failed" in MCP clients validating outputSchema
- Fixed RemoteTrigger tool's `run` action sending empty body

### v2.1.98 (2026-04-07)
- Interactive Google Vertex AI setup wizard
- Monitor tool for streaming events from background scripts
- **Subprocess sandboxing with PID namespace isolation on Linux**
- `workspace.git_worktree` in status line JSON
- 🔴 **FIX:** Bash tool permission bypass via backslash-escaped flag
- 🔴 **FIX:** Compound Bash commands bypassing forced permission prompts in auto/bypass modes
- Fixed redirects to /dev/tcp or /dev/udp not prompting
- Fixed MCP OAuth `oauth.authServerMetadataUrl` not honored on token refresh
- 🔴 **FIX:** 429 retries burning all attempts in ~13s — was causing rapid exhaustion
- Fixed `Bash(cmd:*)` wildcard rules failing with extra spaces/tabs

### v2.1.97 (2026-04-06)
- Focus view toggle (Ctrl+O) in NO_FLICKER mode
- `refreshInterval` status line setting
- `disableSkillShellExecution` setting
- 🔴 **FIX:** MCP HTTP/SSE connections accumulating ~50MB/hr unreleased buffers. **Critical for Aegis long-running sessions.**
- Fixed prompt-type Stop/SubagentStop hooks failing on long sessions
- Improved Bash tool OTEL tracing: subprocesses inherit TRACEPARENT

### v2.1.96 (2026-04-05)
- Fixed Bedrock 403 when using AWS_BEARER_TOKEN_BEDROCK

### v2.1.94 (2026-04-04)
- Amazon Bedrock powered by Mantle support
- **Default effort changed from medium to high**
- `hookSpecificOutput.sessionTitle` for UserPromptSubmit hooks
- 🔴 **FIX:** Subagent spawning permanently failing after tmux windows killed/renumbered. **CRITICAL for Aegis tmux management.**
- Fixed prompt-type Stop hooks failing when small model returns ok:false
- Fixed CJK/multibyte text corrupted in stream-json when chunk boundaries split UTF-8

## Known CC Behaviors

### Session resumption (CRITICAL)
CC always auto-resumes latest session in project dir. No way to disable.
- Mitigation: archive .jsonl files (Aegis v1.2.0)
- Risk: `sessions-index.json` may still point to old sessions
- v2.1.116: `/resume` 67% faster on large sessions
- v2.1.119: `/resume` offers to summarize stale sessions
- v2.1.121: corrupt transcript lines are skipped instead of failing

### Permission mode
`bypassPermissions` skips all prompts — good for automated workflows.
- Auto mode now available by default (v2.1.111) — no `--enable-auto-mode` needed
- `disableBypassPermissionsMode` is now respected (v2.1.116)

### Rate limits
Depends on plan (Pro, Team, Enterprise).
- v2.1.81: `rate_limits` field in statusline scripts
- v2.1.98: Fixed 429 retries burning all attempts in ~13s
- v2.1.111: Fixed 429 errors referencing status.claude.com for Bedrock/Vertex

### Context window
Long conversations fill up. `/compact` summarizes and resets.
- v2.1.108: Recap feature for returning to sessions
- v2.1.105: PreCompact hooks can block compaction
- Opus 4.7 context: 1M tokens (v2.1.117/119: fixed inflated 200K display)

### Agent/subagent model
- Subagents stall mid-stream → fail after 10 minutes (v2.1.113, was hanging forever)
- `CLAUDE_CODE_FORK_SUBAGENT=1` enables forked subagents (v2.1.117+)
- `CLAUDE_CODE_EXTRA_BODY output_config.effort` was causing 400 on subagent calls (fixed v2.1.113)
- v2.1.101: Subagents now inherit MCP tools from dynamically-injected servers
- v2.1.110: Subagent transcript cleanup on session exit

### MCP reliability (CRITICAL for Aegis)
- v2.1.97: HTTP/SSE connections leaked ~50MB/hr — fixed
- v2.1.105: stdio MCP malformed output hung session — now fails fast
- v2.1.110: MCP tool calls hung indefinitely when server drops mid-response — fixed
- v2.1.113: MCP concurrent-call timeout — one tool's watchdog could disarm another's — fixed
- v2.1.116: Faster MCP startup (resources/templates deferred)
- v2.1.119: Concurrent MCP server connect now default
- v2.1.121: MCP servers auto-retry 3x on transient startup errors
- v2.1.121: `alwaysLoad` option skips deferred tool-search for instant tool availability

### tmux management (CRITICAL for Aegis)
- v2.1.94: Subagent spawning permanently failing after tmux windows killed/renumbered — fixed
- v2.1.111: Terminal display tearing in iTerm2 + tmux when notifications sent — fixed
- v2.1.121: Scrollback duplication on Ctrl+L/resize in tmux — fixed
- v2.1.122: Remote control idle status redrawing 2x/sec flooding tmux pipes — fixed

### Streaming & API
- v2.1.105: Stalled API stream aborts after 5 min no data, retries non-streaming
- v2.1.108: `ENABLE_PROMPT_CACHING_1H` for 1-hour cache TTL
- v2.1.109: Extended-thinking indicator with rotating progress hint
- v2.1.117: Fixed crash when proxy returns HTTP 204 No Content

### Bash tool security
- v2.1.98: Permission bypass via backslash-escaped flag — fixed
- v2.1.98: Compound commands bypassing forced permission prompts — fixed
- v2.1.113: Bash deny rules now match commands wrapped in env/sudo/watch/ionice/setsid
- v2.1.113: `Bash(find:*)` no longer auto-approves `find -exec`/`-delete`
- v2.1.116: Sandbox auto-allow no longer bypasses dangerous-path check for rm/rmdir
- v2.1.120: `find` exhausting file descriptors on large directory trees — fixed

### OAuth & Auth
- v2.1.96: Fixed Bedrock 403 with AWS_BEARER_TOKEN_BEDROCK
- v2.1.117/119: Plain-CLI OAuth reactive 401 refresh (was dying mid-session)
- v2.1.118: Fixed MCP OAuth token refresh lock contention
- v2.1.118: Fixed macOS keychain race + Linux/Windows credential save crash
- v2.1.123: Fixed OAuth 401 retry loop with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`

### OpenTelemetry
- v2.1.97: Bash tool subprocesses inherit TRACEPARENT
- v2.1.122: Numeric attrs on api_request/api_error now numbers not strings
- v2.1.122: `claude_code.at_mention` event

## Aegis-specific Action Items

### 🔴 HIGH PRIORITY
1. **Migrate Aegis hooks from `command` → `http` type** — eliminates polling, zero-latency
2. **Create POST /hooks/{event} endpoints** in Aegis server
3. **Add `alwaysLoad: true`** to Aegis MCP server config for instant tool discovery (v2.1.121)
4. **Implement PreCompact hook** to preserve Aegis state before compaction (v2.1.105)
5. **Explore `mcp_tool` hook type** — hooks calling Aegis MCP tools directly (v2.1.118)
6. **Implement PostToolUse output replacement** via `hookSpecificOutput.updatedToolOutput` (v2.1.121)

### 🟡 MEDIUM PRIORITY
7. Implement StopFailure hook for error detection
8. Test `CLAUDE_CODE_FORK_SUBAGENT=1` for Aegis subagent workflow
9. Use `ENABLE_PROMPT_CACHING_1H=1` for reduced API costs in long sessions
10. Use `AI_AGENT=aegis` env var for subprocess attribution
11. Monitor MCP buffer leaks — confirm v2.1.97 fix in production
12. Test `/resume` performance improvement with large Aegis sessions

### 🟢 LOW PRIORITY / MONITORING
13. Read CC source systematically (repo may still be private — compiled Bun binary)
14. Test `--bare` flag behavior with Aegis hooks
15. Test `--from-pr` for PR-driven session creation
16. Monitor tmux pipe flooding — confirm v2.1.122 fix in production
17. Monitor subagent 10-minute stall timeout (v2.1.113) vs Aegis own stall detection
18. Evaluate `sandbox.network.deniedDomains` for Aegis security
19. Document `rate_limits` statusline for monitoring dashboard
20. Track native binary migration (v2.1.113) impact on Aegis session management

### ✅ COMPLETED (from previous tracking)
- ~~Update CC CLI to v2.1.92~~ → now at v2.1.123
- ~~Update knowledge base regularly~~ → current through v2.1.123
- ~~Verify `forceRemoteSettingsRefresh` impact~~ → stable since v2.1.92

---
_Last updated: 30 Aprile 2026_
_Source: https://docs.anthropic.com/en/docs/claude-code/changelog_

---

## v2.1.126 Updates (2026-05-01)

**New features relevant to Aegis:**
1. **`/model` picker uses gateway `/v1/models`** — When `ANTHROPIC_BASE_URL` points at a compatible gateway, the model picker lists available models. Important for Aegis users routing through custom gateways.
2. **`claude project purge [path]`** — Deletes all Claude Code state for a project (transcripts, tasks, file history, config). Supports `--dry-run`, `-y/--yes`, `-i/--interactive`, `--all`. Aegis could expose this as a session cleanup utility.
3. **`--dangerously-skip-permissions` now bypasses more paths** — `.claude/`, `.git/`, `.vscode/`, shell config files. Catastrophic removal commands still prompt. Aegis should NOT rely on bypass mode for safety — use permissionMode: "default".
4. **OAuth login accepts pasted code** — When browser callback can't reach localhost (WSL2, SSH, containers). Relevant for Aegis headless/container deployments.
5. **`skill_activated` OTel event** — Fires for user-typed slash commands with `invocation_trigger` attribute. Aegis could track skill usage.
6. **Auto mode spinner turns red on permission stall** — Visual indicator when permission check is blocking. Useful for Aegis session monitoring.
7. **`alwaysLoad` MCP option (v2.1.121)** — Tools from that server skip deferred tool-search. **CRITICAL for Aegis MCP**: Aegis tools should use `alwaysLoad: true` to be immediately available.
8. **PostToolUse hooks replace ALL tool output (v2.1.121)** — Not just MCP tools. Aegis hooks can modify any tool's output.
9. **`mcp_tool` hook type (v2.1.118)** — Hooks can invoke MCP tools directly. Aegis can use this for hook-driven tool calls.
10. **Stream idle timeout fixes (v2.1.122/126)** — Fixed false aborts during long model thinking pauses and Mac sleep wake. Reduces Aegis session drops.
11. **Image paste downsizing (v2.1.126)** — Images >2000px are downscaled on paste. Prevents session breakage from oversized images.
12. **Security fix: `allowManagedDomainsOnly`** — Was ignored when higher-priority managed-settings source lacked sandbox block. Aegis should ensure managed settings are correctly layered.
13. **OAuth fixes** — Timeout on slow/proxied connections, IPv6-only devcontainers, browser callback failures, concurrent credential writes. All improve Aegis reliability in varied environments.
14. **Agent SDK hang fix** — Model emitting malformed tool name in parallel tool call batch no longer hangs. Critical for Aegis reliability.
15. **`--print` honors `tools:` and `disallowedTools:` (v2.1.119)** — Aegis headless sessions now respect agent tool restrictions.
16. **Subagent parallel MCP reconnection (v2.1.119)** — MCP servers connect in parallel instead of serial. Faster session startup in Aegis.
17. **Bash tool `API_TIMEOUT_MS` respected (v2.1.101)** — Previously hardcoded 5-min timeout. Slow backends (local LLMs) now work.
18. **`permissions.deny` overrides PreToolUse hook `ask` (v2.1.101)** — Deny rules take precedence over hooks. Aegis can't downgrade a deny via hook.
19. **Worktree reuse fix (v2.1.119)** — Agent tool with `isolation: "worktree"` no longer reuses stale worktrees. Important for Aegis worktree management.
20. **PR linking in worktrees (v2.1.119)** — PR now correctly linked to session when working in a git worktree.

**npm version:** v2.1.126
