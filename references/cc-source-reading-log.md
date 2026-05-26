# Claude Code Source Reading Log

_Tracking systematic reading of anthropics/claude-code repo._

## Status
- Started: 2026-03-22
- Goal: full understanding of CC internals within 1 week

## Reading Queue
- [ ] Repository structure overview
- [ ] CLI entry point and argument parsing
- [ ] Session management (create, resume, save)
- [ ] JSONL transcript format (write side)
- [ ] Terminal UI / TUI rendering
- [ ] Tool execution pipeline
- [ ] Permission system
- [ ] Hook system (SessionStart, PreToolUse, Stop)
- [ ] Settings/config management
- [ ] MCP integration
- [ ] Context window management (/compact)
- [ ] Rate limit handling

## Sessions

### Session 1 — 2026-03-22 04:32
- Target: repo structure overview + changelog analysis
- Read: CHANGELOG.md (v2.1.78-81, ~4 versions)
- Read: README.md (repo overview)
- Key findings:
  - `--bare` flag skips hooks → would break our session_map discovery
  - `--no-resume` confirmed non-existent — our archive approach is correct
  - `StopFailure` hook event added in v2.1.78 — we should listen to this
  - tmux race conditions acknowledged by CC team (v2.1.81 fix)
  - `--channels` in v2.1.80 is future integration path for Aegis v2.0
  - CC install now via curl, not npm (npm deprecated)
- Updated: references/claude-code-knowledge.md

## Session 2 — 2026-03-28 05:50
- Target: CC changelog v2.1.84-86 analysis
- Read: CHANGELOG.md (v2.1.84, v2.1.85, v2.1.86)
- Key findings:
  - **CLAUDE_STREAM_IDLE_TIMEOUT_MS** (v2.1.84): CC default 90s for streaming idle watchdog. Aegis has 300s → Issue #392 already open to align
  - **X-Claude-Code-Session-Id header** (v2.1.86): CC sends session ID in API requests. Aegis can use for request tracking/proxying
  - **PreToolUse hooks with updatedInput** (v2.1.85): Can satisfy AskUserQuestion via hooks. Potential Aegis feature for headless question handling
  - **WorktreeCreate hook HTTP** (v2.1.84): Return worktree path via hook response JSON
  - **conditional `if` field for hooks** (v2.1.85): Filter when hooks run using permission rule syntax (e.g., `Bash(git *)`)
  - **Memory leak fix** (v2.1.86): markdown/highlight render caches retaining full content strings in long sessions
  - **Read tool compact line-number format** (v2.1.86): Deduplicates unchanged re-reads, reduces token usage
  - **Startup event-loop stalls** (v2.1.86): Reduced when many claude.ai MCP connectors configured (keychain cache 5s→30s)
  - **Skill descriptions capped at 250 chars** (v2.1.86): Reduces context usage in /skills listing
  - **Auto mode shows "unavailable for your plan"** (v2.1.86): Better UX for plan-restricted users

### Session 7 — 2026-03-28 22:52
- Target: version check + source availability
- CC version: 2.1.86 (latest)
- Finding: anthropics/claude-code repo is NOT publicly accessible (404 on GitHub API)
- Conclusion: Cannot do direct source reading. Must rely on:
  - CHANGELOG.md (if we can get it from npm or docs)
  - Docs at https://docs.anthropic.com/en/docs/claude-code
  - Behavior observation via Aegis sessions
  - npm package analysis
- Aegis impact: no new source-level insights. Continue monitoring docs/changelog.

## 2026-03-29 03:15 — CC Hooks Example

### File: examples/hooks/bash_command_validator_example.py
- PreToolUse hook pattern for Bash tool validation
- Input: JSON via stdin with tool_name, tool_input
- Exit codes: 0=allow, 1=show warning, 2=block
- Pattern: regex-based command validation
- Relevance: Aegis could implement similar hooks for CC sessions it manages

### File: .claude/ directory structure
- commands/ — custom slash commands
- hooks/ — hook scripts
- settings — settings.json
- Note: src/ directory is NOT in public repo — CC is compiled/packaged

### Key insight
- CC source code is not publicly available (only compiled package)
- Can learn from: CHANGELOG.md, examples/, .claude/ directory, hooks documentation
- v2.1.86 is current — X-Claude-Code-Session-Id header is new and useful for Aegis proxy

## 2026-03-31 — CC Leaked Source Analysis

### Files Read
- `src/types/permissions.ts` — Complete permission type system (250+ lines)
- `src/tools/BashTool/bashPermissions.ts` — Bash permission logic (2622 lines)
- `src/tools/BashTool/bashSecurity.ts` — Bash security parsing (2593 lines)
- `src/utils/permissions/PermissionResult.ts` — Permission result types
- `src/tools/` directory listing (149 .ts files)

### Key Architecture Findings

#### Permission System (HIGH relevance for Aegis)
- **5 external modes**: `default`, `plan`, `bypassPermissions`, `acceptEdits`, `dontAsk`
- **2 internal modes**: `auto` (classifier-based), `bubble` (delegation)
- **PermissionRule**: `{source, ruleBehavior: allow|deny|ask, ruleValue: {toolName, ruleContent?}}`
- **6 sources**: userSettings, projectSettings, localSettings, flagSettings, policySettings, cliArg, command, session
- **PermissionDecisionReason**: rule, mode, subcommandResults, permissionPromptTool, hook, asyncAgent, sandboxOverride, classifier, workingDir, safetyCheck, other
- **Classifier**: 2-stage (fast + thinking), can auto-approve/deny in auto mode
- **Safety checks**: some are `classifierApprovable` (sensitive paths), some block immediately

#### Tool System
- Each tool is a directory with: Tool.tsx, prompt.ts, constants.ts
- 30+ tool directories including AgentTool, BashTool, FileEditTool, MCPTool, etc.
- BashTool alone: 6359 lines (security + permissions + helpers)

#### Relevance for Aegis
1. Aegis should support all permission modes, not just `bypassPermissions` and `default`
2. The classifier system could be replicated for auto-approval of safe commands
3. Permission hooks (PreToolUse) are more powerful than simple allow/deny
4. The `auto` mode with 2-stage classifier is the future of CC permission handling

### Hook System (HIGH relevance for Aegis)
- **14+ hook events**: PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, Setup, SubagentStart, UserPromptSubmit, PermissionDenied, PermissionRequest, Notification, Elicitation, ElicitationResult, CwdChanged, FileChanged, WorktreeCreate
- **Sync + Async hooks**: async hooks return `{async: true, asyncTimeout?: number}`
- **Hook outputs**: can modify tool input, update permissions, block execution, inject system messages, retry on denial
- **PreToolUse hookSpecificOutput**: `{permissionDecision, permissionDecisionReason, updatedInput, additionalContext}`
- **PostToolUse hookSpecificOutput**: `{additionalContext, updatedMCPToolOutput}`
- **PermissionDenied hook**: `{retry: boolean}` — can auto-retry denied commands
- **PermissionRequest hook**: full allow/deny with permission updates
- **WorktreeCreate hook**: returns `{worktreePath: string}` for HTTP-based worktree creation
- **HookResult**: `{outcome: success|blocking|non_blocking_error|cancelled, preventContinuation, stopReason, permissionBehavior, additionalContext}`

### Complete Hook Event List (from coreTypes.ts)
22+ events: PreToolUse, PostToolUse, PostToolUseFailure, Notification, UserPromptSubmit, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, PreCompact, PostCompact, PermissionRequest, PermissionDenied, Setup, TeammateIdle, TaskCreated, TaskCompleted, Elicitation, ElicitationResult, ConfigChange, WorktreeCreate, WorktreeRemove, InstructionsLoaded

### Tool Execution Flow (toolHooks.ts)
- Pre-tool: permission check → rule-based → classifier → hook execution → permission decision
- Post-tool: hook execution → can modify MCP tool output → attachment messages
- Post-tool-failure: separate failure hook chain
- Hooks are async generators — can yield multiple messages

### 2026-04-30 — Changelog deep read (v2.1.85 → v2.1.123)

**Note:** The CC repo (`anthropics/claude-code`) no longer contains TypeScript source — it's now a compiled Bun binary. Only CHANGELOG.md, plugins, examples, and scripts remain. Source reading via GitHub is no longer possible. Knowledge must come from CHANGELOG analysis and official docs.

**Key findings for Aegis from 37 versions:**

1. **PostToolUse hook output replacement for ALL tools** (v2.1.121) — Previously MCP-only. Aegis can now modify tool output for any tool via `hookSpecificOutput.updatedToolOutput`.

2. **New hook type: `mcp_tool`** (v2.1.118) — Hooks can directly invoke MCP tools. New pattern for Aegis: HTTP hooks that call Aegis MCP tools.

3. **PreCompact hook blocking** (v2.1.105) — Hooks can block compaction with exit code 2 or `{"decision":"block"}`. Aegis could prevent context loss during long sessions.

4. **Subagent stall detection** (v2.1.113) — 10-minute timeout instead of infinite hang. Aligns with Aegis stall detection but CC now handles it natively.

5. **Remote control idle redraw flood** (v2.1.122) — Fixed tmux pipe flooding from 2 redraws/sec. Previously could cause Aegis tmux parsing issues.

6. **Subagent spawning fails after tmux window renumber** (v2.1.94) — CRITICAL for Aegis: if tmux windows are killed/renumbered during long sessions, Claude Code can't spawn new subagents. Aegis should avoid renumbering tmux windows during active sessions.

7. **PermissionRequest hooks `updatedInput` now re-checked against deny rules** (v2.1.110) — Security improvement. Aegis HTTP hooks returning `updatedInput` will have it validated against CC's deny rules.

8. **`setMode:'bypassPermissions'` respects `disableBypassPermissionsMode`** (v2.1.116) — Aegis can't force bypass mode if the user has disabled it.

9. **`alwaysLoad` MCP server option** (v2.1.121) — Tools from that server skip deferred tool-search. Important for Aegis MCP tools that need to be immediately available.

10. **`CLAUDE_CODE_FORK_SUBAGENT=1`** works in non-interactive sessions (v2.1.117) — Enables subagent use in headless/SDK mode.

11. **Memory leak fixes** — Multiple fixes for long-session memory growth (image handling, /usage, render caches, virtual scroller, MCP HTTP buffers ~50MB/hr). Improves CC stability for Aegis long-running sessions.

12. **MCP startup auto-retry** (v2.1.121) — 3 retries on transient errors. Reduces Aegis MCP connection failures.

13. **Stalled stream handling** (v2.1.105) — 5-minute idle timeout, falls back to non-streaming. Aegis should be aware of this timeout.

14. **`ENABLE_PROMPT_CACHING_1H`** (v2.1.108) — 1-hour prompt cache TTL. Reduces costs for resumed sessions.

15. **`--from-pr` accepts GitLab MR, Bitbucket PR, GitHub Enterprise** (v2.1.119) — Useful for Aegis PR review workflow.

16. **`--print` mode honors agent's `tools:` and `disallowedTools:`** (v2.1.119) — Important for Aegis headless session management.

17. **`/branch` now handles rewound timelines** (v2.1.122) — Fixed forks from sessions with rewound history.

18. **`/resume` faster** (v2.1.116) — Up to 67% on 40MB+ sessions. Better for Aegis session management.

19. **Bash tool `API_TIMEOUT_MS` respected** (v2.1.101) — Previously hardcoded 5-min timeout. Slow backends (local LLMs) now work correctly.

20. **`permissions.deny` overrides PreToolUse hook `ask`** (v2.1.101) — Deny rules take precedence over hooks. Aegis can't downgrade a deny via hook.

## Session 8 — 2026-05-01 06:30
- Target: Agent SDK documentation (code.claude.com/docs)
- Read: agent-sdk/agent-loop.md, agent-sdk/hooks.md
- Key findings:
  - **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) is now the official SDK name
  - **New hook: `PostToolBatch`** (TS-only) — batch-level tool interception
  - **New hooks: `SessionStart`, `SessionEnd`, `TeammateIdle`, `TaskCompleted`, `ConfigChange`**
  - **`WorktreeCreate`/`WorktreeRemove`** hooks now documented
  - **`PreCompact` hook** can block compaction
  - **Built-in `ToolSearch`** tool for dynamic tool discovery
  - **Built-in `Agent` tool** for subagent spawning
  - **5 core message types**: SystemMessage, AssistantMessage, UserMessage, StreamEvent, ResultMessage
  - **`max_budget_usd`** and **`max_turns`** for session cost/turn limits
- Relevance: Agent SDK is the future API for Aegis integration; hook system expansion provides new control surfaces
- Updated: references/claude-code-knowledge.md (pending — knowledge base needs Agent SDK section)
