# CC Research Log

## 2026-03-27 04:38 UTC — CC v2.1.85 Changelog Analysis

### Key changes for Aegis:
1. **PreToolUse hooks return `updatedInput`** — allows headless integrations to collect answers via their own UI. Aegis could use this to auto-answer AskUserQuestion prompts.
2. **TaskCreated hook** — fires when a task is created via TaskCreate. Aegis could track CC tasks.
3. **WorktreeCreate hook (HTTP)** — return worktree path via hookSpecificOutput. Aegis could manage worktrees via hooks instead of CLI.
4. **Conditional `if` field for hooks** — filter when hooks run using permission rule syntax (e.g., `Bash(git *)`). Reduces process spawning.
5. **Memory leak fix in remote sessions** — streaming response interrupted no longer leaks.
6. **`CLAUDE_STREAM_IDLE_TIMEOUT_MS`** — configurable streaming idle watchdog (default 90s). Aegis should respect this.
7. **Background bash stuck detection** — surfaces notification after ~45s. Aegis could hook into this.
8. **Idle-return prompt** — nudges users after 75+ min to /clear. Reduces token re-caching.

### No action needed:
- Most fixes are client-side (terminal rendering, key bindings, etc.)
- Aegis doesn't use OTEL, MCP OAuth, or managed settings
## 2026-03-27 — CC v2.1.85 Analysis

### Impact on Aegis
1. **PreToolUse hooks satisfy AskUserQuestion via updatedInput** — Aegis could intercept AskUserQuestion and provide answers programmatically via hook response. Opens possibility of fully automated CC sessions even for non-bypass modes.
2. **Memory leak fix in remote sessions (streaming interrupted)** — Confirms our observation of memory growth in long Aegis sessions. Upgrade to 2.1.85 should help.
3. **Persistent ECONNRESET fix** — Aegis sessions run for hours. This fix reduces connection churn.
4. **CLAUDE_STREAM_IDLE_TIMEOUT_MS (from 2.1.84)** — Could replace Aegis' own stall detection for "CC is streaming but stuck" scenarios.

### New Hook Types to Track
- `TaskCreated` — fires when CC creates a task via TaskCreate. Aegis could surface task lifecycle in dashboard.

### Non-blocking
- Conditional `if` field for hooks — reduces process spawning overhead when hooks don't match

## 2026-03-27 10:20 — CC Plugins Ecosystem Analysis

### Official Plugins (anthropics/claude-code/plugins/)

| Plugin | Purpose | Relevance to Aegis |
|--------|---------|-------------------|
| **feature-dev** | 7-phase structured workflow (discovery → exploration → clarifying → architecture → implementation → review → summary) | Aegis workflow skill should match this depth |
| **code-review** | Code review patterns | Review capabilities |
| **pr-review-toolkit** | PR review workflow | PR management |
| **commit-commands** | Git commit workflow | Session management |
| **security-guidance** | Security best practices | Permission handling |
| **hookify** | Hooks management | Hook management |
| **agent-sdk-dev** | Agent SDK development | Agent SDK integration |
| **frontend-design** | Frontend design | Dashboard |
| **plugin-dev** | Plugin development | Plugin system |

### Key Insight: feature-dev plugin

The `feature-dev` plugin implements a 7-phase workflow that is VERY similar to what Aegis's `workflow` skill does. Key differences:

1. **Multi-agent architecture** — launches parallel sub-agents (code-explorer, code-architect, code-reviewer) for deep analysis
2. **User checkpoints at every phase** — waits for user confirmation before proceeding
3. **Architecture design phase** — proposes 3 approaches (minimal, clean, pragmatic) with trade-offs
4. **Quality review phase** — 3 parallel review agents (simplicity, correctness, conventions)

### Action Items for Aegis

1. Consider supporting CC plugins in Aegis sessions (install/enable plugins per session)
2. Aegis's workflow skill should match the feature-dev depth (especially architecture + review phases)
3. Multi-agent orchestration within a single CC session is now a first-class CC pattern

## 2026-03-27 21:49 — CC v2.1.86 released

### Key changes for Aegis:
- **X-Claude-Code-Session-Id header** on API requests — proxies can aggregate by session without parsing body. Useful for Aegis logging/metrics.
- **--resume fix** for sessions created before v2.1.85 with orphaned tool_use ids
- **--bare mode fix** — was dropping MCP tools in interactive sessions. Critical if Aegis uses bare mode.
- **Write/Edit/Read outside project root** — skill files in ~/.claude/ now work correctly
- **Config disk writes perf** — no unnecessary writes on every skill invocation
- **OOM crash on /feedback** — stability fix for long sessions
- **.jj and .sl VCS exclusion** — Jujutsu/Sapling metadata excluded from Grep

### Impact: Low — no breaking changes. Safe to update.
### Action: Update CC to 2.1.86 when convenient.
test

## 2026-03-28 05:55 — CC v2.1.86 Research

### Issues scan (anthropics/claude-code)
- #40065 — Rate limit reached (API) — not Aegis-related
- #40126 — Bash sandbox hardcodes /tmp on Android — Aegis runs on Linux, not relevant
- #32659 — Context amnesia in long sessions — could impact Aegis sessions that run for hours. Monitor.
- #40125 — ClaudeClaw cron job spawning — not relevant (OpenClaw competitor, not CC)

### Key CC features from 2.1.84-2.1.86 for Aegis
- `CLAUDE_STREAM_IDLE_TIMEOUT_MS` (default 90s) — Aegis stall threshold is 300s. Issue #392 tracks alignment.
- `X-Claude-Code-Session-Id` header — Aegis can use for session tracking without parsing body.
- PreToolUse hooks with `updatedInput` — can satisfy AskUserQuestion via hooks. Potential Aegis feature.
- `WorktreeCreate` hook HTTP — return worktree path via hook response.
- PowerShell tool (2.1.84) — Windows only, not relevant for Aegis.

### Aegis action items from CC changes
1. Consider using `X-Claude-Code-Session-Id` header for session tracking (optimization, not critical)
2. Issue #392: align stall threshold with CC's 90s default
3. Consider supporting PreToolUse `updatedInput` for AskUserQuestion (future feature)

## 2026-03-28 — CC v2.1.84-2.1.86 Analysis

### Key findings for Aegis

1. **CLAUDE_STREAM_IDLE_TIMEOUT_MS (v2.1.84)**
   - CC default: 90s streaming idle watchdog
   - Aegis stall threshold: 300s — MISALIGNED
   - Issue #392 already tracks this
   - Impact: Aegis detects stalls 3.3x later than CC does

2. **X-Claude-Code-Session-Id header (v2.1.86)**
   - CC now sends session ID in API requests
   - Aegis can use this for request correlation without parsing body
   - Useful for logging and debugging

3. **PreToolUse hooks with updatedInput (v2.1.85)**
   - Can satisfy AskUserQuestion via hooks
   - Aegis could implement headless Q&A via hooks
   - Feature opportunity for Issue #394-type scenarios

4. **WorktreeCreate hook HTTP (v2.1.84)**
   - Return worktree path via hook response
   - Aegis could manage worktrees via CC hooks instead of direct git commands

5. **Memory growth fix (v2.1.86)**
   - Fixed memory leak from markdown/highlight render caches
   - Confirms long sessions had memory issues in CC itself

## 2026-03-28 21:52 — Competitor Analysis

### ccmanager (kbwo/ccmanager) — ⭐969, TypeScript, MIT
**Most similar to Aegis.** CLI for managing multiple AI coding assistant sessions across Git worktrees.
- Multi-agent support: Claude Code, Gemini CLI, Codex CLI, Cursor Agent, Copilot CLI, Cline CLI, OpenCode, Kimi CLI
- No tmux dependency — self-contained (Aegis uses tmux)
- Visual status indicators (busy/waiting/idle)
- Worktree management built-in
- Auto Approval (experimental) — AI verification for safe prompts
- **Key difference from Aegis:** ccmanager is a TUI/desktop tool. Aegis is an HTTP API + MCP server + dashboard.
- **Aegis advantage:** REST API for programmatic access, MCP protocol, web dashboard, session orchestration at scale
- **ccmanager advantage:** No tmux dependency, simpler setup, broader agent support

### agent-deck (asheshgoplani/agent-deck) — ⭐1778, Go, MIT
Terminal session manager for AI coding agents. One TUI for Claude Code, Aider, Cursor.
- Go-based, fast binary
- TUI interface (Aegis has web dashboard)
- **Key difference:** Desktop TUI vs Aegis's HTTP API approach

### agent-of-empires (njbrake/agent-of-empires) — ⭐1359, Rust, MIT
Multi-agent orchestration: Claude Code, OpenCode, Mistral Vibe, Codex CLI, Gemini CLI.
- Rust-based, likely a TUI
- **Less info available** — need to investigate further

### Aegis Differentiators
1. **HTTP API first** — programmatic access, not just TUI
2. **MCP Server** — 21 tools, 4 resources, 3 prompts for Claude Code integration
3. **Web Dashboard** — real-time session monitoring
4. **tmux-based** — lower overhead than running separate processes
5. **Security** — timingSafeEqual, path traversal prevention, no bearer token in URLs

### Opportunities
- ccmanager supports 8 agents vs Aegis's Claude Code only → multi-agent support could be a feature
- Auto Approval in ccmanager → Aegis could add permission management API
- Worktree copy in ccmanager → Aegis could add session context transfer between worktrees

## 2026-03-29 01:29 — CC v2.1.86 CHANGELOG deep read

### Impact su Aegis

1. **X-Claude-Code-Session-Id header (v2.1.86)** — CC ora invia session ID in header. Aegis può usare questo per aggregare request per sessione senza parsare il body. Utile per logging e monitoring.

2. **Conditional hooks (v2.1.85)** — I hooks ora supportano campo `if` con syntax tipo `Bash(git *)`. Aegis potrebbe configurare hooks che girano solo per certi tool calls, riducendo overhead.

3. **WorktreeCreate hook HTTP (v2.1.84)** — CC può chiamare un HTTP endpoint per creare worktree, ricevendo il path via `hookSpecificOutput.worktreePath`. Aegis potrebbe implementare questo endpoint per gestire worktree creation centralmente.

4. **MCP OAuth RFC 9728 (v2.1.85)** — MCP servers possono usare OAuth standard. Aegis MCP server potrebbe implementare questo per autenticazione enterprise.

5. **CLAUDE_STREAM_IDLE_TIMEOUT_MS (v2.1.84)** — Configurabile timeout per stream idle. Aegis dovrebbe rispettare questo e gestire timeout gracefulmente.

6. **Read tool compact line-number format (v2.1.86)** — Riduce token usage per file reads. Aegis trascrive output di CC — questo riduce i costi.

7. **Background bash notification (v2.1.84)** — CC mostra notifica dopo ~45s se un bash task è stuck su prompt interattivo. Rilevante per il tmux management di Aegis.

## 2026-03-29 03:00 — CC v2.1.86 CHANGELOG Analysis

### Relevant for Aegis
1. **X-Claude-Code-Session-Id header** (2.1.86) — API requests now include session ID header. Aegis proxy can use this for session aggregation without parsing body. IMPACT: Medium — improves monitoring/debugging.

2. **WorktreeCreate hook type:"http"** (2.1.84) — WorktreeCreate hook now supports HTTP type. Aegis could intercept worktree creation. IMPACT: Low — Aegis already creates worktrees via CLI.

3. **CLAUDE_STREAM_IDLE_TIMEOUT_MS** (2.1.84) — Configurable streaming idle timeout (default 90s). IMPACT: High — Aegis stall detection should respect this. Could use as stall threshold.

4. **--bare mode fix** (2.1.86) — No longer drops MCP tools in interactive sessions. IMPACT: Low — Aegis uses teammate mode, not bare.

5. **Conditional hooks with if field** (2.1.85) — Hooks can use permission rule syntax (e.g., Bash(git *)) to filter. IMPACT: Medium — reduces unnecessary hook invocations.

6. **PreToolUse hooks updatedInput** (2.1.85) — Can satisfy AskUserQuestion by returning updatedInput. IMPACT: Medium — Aegis permission handling could use this for headless approvals.

7. **TaskCreated hook** (2.1.84) — New hook type fires when task created. IMPACT: Low — Aegis doesn't use CC tasks.

8. **MCP OAuth RFC 9728** (2.1.85) — Follows Protected Resource Metadata discovery. IMPACT: Low — Aegis MCP server doesn't use OAuth yet.

### Non-relevant
- PowerShell tool (Windows)
- VSCode extension fixes
- Terminal keyboard protocol fixes
- Deep link improvements
- Plugin marketplace changes

## 2026-03-29 — CC 2.1.86 Changelog Analysis

### New features relevant to Aegis
1. **X-Claude-Code-Session-Id header** — proxy session aggregation without body parsing
2. **WorktreeCreate HTTP hook** — return worktree path via hookSpecificOutput.worktreePath
3. **Conditional hooks (if field)** — permission rule syntax, reduces process spawning
4. **CLAUDE_STREAM_IDLE_TIMEOUT_MS** — configurable idle watchdog (default 90s)
5. **Background bash stuck notification** — after ~45s on interactive prompt
6. **MCP tool description cap** — 2KB max, prevents context bloat
7. **Read tool compact format** — line-number changes may affect transcript parsing

### Potential Aegis improvements
- Use X-Claude-Code-Session-Id for session correlation
- Expose CLAUDE_STREAM_IDLE_TIMEOUT_MS in Aegis config
- Add stuck detection based on background bash notification
- Ensure MCP tool descriptions stay under 2KB

## 2026-03-29 03:46 CET — CC v2.1.86 changelog analysis

### Impatto su Aegis
1. **X-Claude-Code-Session-Id header** — CC ora invia header con session ID in ogni API request. Aegis può usare questo per tracciare richieste per session senza parsing del body.
2. **WorktreeCreate HTTP hook** (2.1.84) — CC supporta `type: "http"` per WorktreeCreate hooks, ritorna path via `hookSpecificOutput.worktreePath`. Aegis potrebbe implementare un worktree server.
3. **Conditional hooks `if` field** (2.1.85) — hooks possono usare permission rule syntax per filtrare quando girano. Riduce process spawning. Aegis hooks dovrebbero usare questo.
4. **CLAUDE_STREAM_IDLE_TIMEOUT_MS** (2.1.84) — env var per configurare streaming idle watchdog (default 90s). Aegis dovrebbe rispettare/sovrascrivere questo.
5. **TaskCreated hook** (2.1.84) — nuovo hook type quando un task viene creato. Aegis potrebbe tracciare task lifecycle.

### Non impattano Aegis direttamente
- MCP OAuth RFC 9728
- PowerShell tool
- Plugins marketplace
- VSCode extension fixes

## 2026-03-29 19:30 — CC v2.1.87 Changelog Analysis

### Impact on Aegis

**HIGH:**
- `X-Claude-Code-Session-Id` header (2.1.86): Aegis can now correlate API requests with sessions without parsing body. Add to session tracking.
- PreToolUse hooks satisfy AskUserQuestion (2.1.85): Aegis can implement headless approval flow — hook returns `updatedInput` + `permissionDecision: "allow"`. This could replace the current approve API.

**MEDIUM:**
- Conditional hooks `if` field (2.1.85): Aegis can use permission rule syntax to filter hook execution, reducing overhead.
- `CLAUDE_CODE_MCP_SERVER_NAME/URL` env vars (2.1.85): Useful for multi-MCP server configurations.
- `--bare` mode MCP tools fix (2.1.86): If Aegis ever uses bare mode, MCP tools now work correctly.

**LOW:**
- `--resume` fix for old sessions: Improves session recovery.
- Memory growth fix for markdown/highlight caches: Improves long-session stability.
- Startup event-loop stalls reduction: Better MCP connector performance.

### Action Items
1. Add `X-Claude-Code-Session-Id` to Aegis session tracking headers
2. Investigate PreToolUse AskUserQuestion satisfaction for headless approval flow
3. Consider conditional hooks for Aegis hook settings

## 2026-03-29 — CC 2.1.86-2.1.87 Analysis

### Changes relevant to Aegis

1. **X-Claude-Code-Session-Id header** (2.1.86) — CC now sends session ID in HTTP headers. Aegis can use this for request correlation without parsing JSONL body. LOW priority — nice to have.

2. **PreToolUse hooks can satisfy AskUserQuestion** (2.1.85) — `updatedInput` alongside `permissionDecision: "allow"`. This means Aegis hooks can programmatically answer CC permission prompts. MEDIUM priority — improves headless automation.

3. **--bare mode MCP fix** (2.1.86) — Fixed dropping MCP tools in interactive sessions. If Aegis uses --bare, this was a bug.

4. **Memory growth fix** (2.1.86) — Markdown/highlight render caches retaining full content. Good for long-running Aegis sessions.

5. **Read tool dedup** (2.1.86) — Deduplicates unchanged re-reads, reducing token usage. Good for CC cost management.

### Non-relevant changes
- VCS exclusion lists (.jj, .sl)
- macOS/Windows specific fixes
- VSCode extension fixes
- OAuth/feedback fixes

## 2026-03-29 — CC Source Access

### IMPORTANT: Claude Code source is NOT public

The repo `anthropics/claude-code` contains only:
- Documentation (README, CHANGELOG, SECURITY)
- Examples (hooks, settings)
- GitHub Actions workflows
- VSCode extension config
- Plugin marketplace manifest

No `src/` directory. The actual code is distributed as a compiled npm package `@anthropic-ai/claude-code`.

### Impact on Aegis development
- Cannot read CC source for architectural insights
- Must rely on: CHANGELOG, docs, issues, npm package analysis, runtime behavior
- Reverse-engineering via `npm pack` + examining compiled output is possible but limited
- Focus shifts to: API behavior observation, JSONL transcript analysis, edge case testing

## 2026-03-29 — CC Docs Index Mapping

### Pages relevant to Aegis (from https://code.claude.com/docs/llms.txt)

1. **Agent Teams** (en/agent-teams.md) — Coordinate multiple CC instances with shared tasks, inter-agent messaging, centralized management. HIGHEST PRIORITY — Aegis does this but CC now has built-in support. Must understand the API.
2. **Channels** (en/channels.md + channels-reference.md) — Push messages/alerts/webhooks into running CC sessions via MCP. Aegis could implement channels for external event integration.
3. **Remote Control** (en/remote-control.md) — Server mode for controlling CC from claude.ai/app. Potential competitor.
4. **Checkpointing** (en/checkpointing.md) — Track/rewind/summarize edits. Feature for Aegis session management.
5. **Code Review** (en/code-review.md) — Automated multi-agent PR review. Aegis could expose via API.
6. **Analytics** (en/analytics.md) — Usage tracking dashboard. Feature for Aegis dashboard.
7. **Desktop** (en/desktop.md) — Dispatch sessions from phone, parallel sessions with git isolation. Overlaps with Aegis.
8. **Sub-agents** — `claude agents` command lists configured subagents.
9. **Context Window** (en/context-window.md) — Interactive simulation. Useful for understanding CC limits.
10. **Costs** (en/costs.md) — Token tracking, spend limits. Feature for Aegis cost dashboard.

### New CLI commands discovered
- `claude remote-control` — server mode
- `claude agents` — list subagents
- `claude auto-mode defaults` — print auto-mode classifier rules
- `claude plugin` — manage plugins (alias: claude plugins)

### TODO: Read in depth
- Agent Teams doc (understand CC's built-in multi-session support)
- Channels reference (understand the MCP channel contract)
- Checkpointing (understand how to expose in Aegis API)

## 2026-03-29 — CC Agent Teams Deep Dive

### Key findings

**CC now has built-in agent teams** (experimental, v2.1.32+):
- Enable: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json env
- Team lead coordinates work, assigns tasks, synthesizes results
- Teammates work independently, message each other directly
- Shared task list with self-coordination
- Two display modes: in-process (Shift+Down to cycle) or split panes (tmux)

### Comparison with Aegis

| Feature | CC Agent Teams | Aegis |
|---------|---------------|-------|
| Orchestration | tmux split panes | HTTP API + tmux |
| Auth | None | Bearer + WS handshake |
| Dashboard | None | React SPA |
| MCP | Consumer | Server (exposes tools) |
| Multi-CLI | Claude only | Claude only (for now) |
| Inter-agent messaging | Built-in (JSON mailbox) | Via API send/read |
| External integration | None | SSE, Webhooks, Telegram |
| Session management | Basic | Full CRUD + health |

### Strategic implications

1. **Aegis wraps CC Agent Teams** — Aegis can orchestrate CC sessions that use Agent Teams internally. This is meta-orchestration: Aegis manages teams of CC teams.
2. **Aegis complements, not competes** — CC Agent Teams is for interactive use. Aegis is for API/automated/production use.
3. **Feature opportunity** — Aegis could set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in CC session env to enable team mode via API.
4. **Documentation opportunity** — Aegis docs should mention Agent Teams integration.

### Action items
- [ ] Test CC Agent Teams mode via Aegis (set env var in session creation)
- [ ] Update Aegis API to accept optional env vars per session
- [ ] Document Agent Teams integration in Aegis README

## 2026-03-29 — CC Channels Deep Dive

### Key findings

**CC Channels** (research preview, v2.1.80+):
- MCP server that pushes events into CC sessions via stdio
- Capability: `experimental: { 'claude/channel': {} }`
- Notification method: `notifications/claude/channel` with `{content, meta}`
- Two modes: one-way (alerts) and two-way (reply tool)
- Permission relay: forward tool approval prompts to remote channels
- Pre-built channels: Telegram, Discord, iMessage, fakechat

### Channel architecture
```
External System → Channel Server (MCP, stdio) → Claude Code Session
                 ↕ reply tool (two-way)
                 ↕ permission relay (approval/deny)
```

### Aegis integration opportunities

1. **Aegis as CC Channel** — Aegis could register as a channel for each CC session it manages, pushing:
   - CI results
   - Telegram/Discord messages from users
   - PR review comments
   - Monitoring alerts
   - Task assignments from orchestrator

2. **Permission relay via Aegis** — Aegis already manages permissions via `POST /v1/sessions/:id/approve`. Channels could relay permission prompts through Aegis API.

3. **Channel-aware session creation** — When creating a CC session via Aegis API, could optionally specify channels to attach.

### Requirements
- claude.ai login (console/API key NOT supported)
- Team/Enterprise must explicitly enable
- Custom channels need `--dangerously-load-development-channels` flag

### Limitation
- Requires claude.ai login, NOT console/API key auth
- This means Aegis sessions using API key auth CANNOT use channels
- Only affects claude.ai subscription users

## 2026-03-29 — CC Checkpointing

### Key findings

**CC Checkpointing** (built-in):
- Auto-tracks file edits before each prompt
- Checkpoints persist across sessions (30 days, configurable)
- Rewind options: restore code+conversation, conversation only, code only, summarize from here
- `/rewind` command or `Esc Esc` to access
- Summarize = targeted /compact (compresses from a point forward, keeps early context)

### Limitations
- Bash command changes NOT tracked (only file edit tools)
- External changes NOT tracked
- Not a replacement for git

### Aegis integration opportunities

1. **Checkpoint API endpoint** — `GET /v1/sessions/:id/checkpoints` to list checkpoints for a session
2. **Rewind API** — `POST /v1/sessions/:id/rewind` to rewind to a checkpoint
3. **Summarize API** — `POST /v1/sessions/:id/summarize` to compress from a point
4. **Checkpoint-aware session kill** — before killing a session, save current state as checkpoint

### Priority: LOW
- Checkpointing is a CC internal feature, not exposed via API
- Would require CC to expose checkpoint data in JSONL transcript or via MCP
- Nice-to-have but not critical for Aegis MVP

## 2026-03-29 — CC Context Window Analysis

### Context budget breakdown (200K max)

| Component | Tokens | When loaded | Survives compact |
|-----------|--------|-------------|------------------|
| System prompt | 4,200 | Always | Yes |
| Auto memory (MEMORY.md) | 680 | Always (first 200 lines / 25KB) | Yes |
| Environment info | 280 | Always | Yes |
| MCP tool names | 120 | Always (schemas deferred) | Yes |
| Skill descriptions | 450 | Always (full content on invoke) | No (only invoked skills) |
| Global CLAUDE.md | 320 | Always | Yes |
| Project CLAUDE.md | 1,800 | Always | Yes |
| **Startup total** | **~7,850** | | |
| Rules (per path) | 290-380 | When file in matching path read | Yes |
| File reads | 1,100-2,400 | Per Read tool call | Yes |

### Key insights for Aegis

1. **CLAUDE.md < 200 lines** — keep project instructions concise. Move reference content to skills/rules.
2. **MCP tool schemas are deferred** — listing tool names costs only 120 tokens. Aegis MCP server benefits from this.
3. **Skill descriptions don't survive compact** — only skills actually invoked are preserved. Aegis superpowers skills must be invoked explicitly.
4. **Rules are path-scoped** — `.claude/rules/api-conventions.md` with `paths: src/api/**` loads only when needed. Aegis should use path-scoped rules for specific modules.
5. **File reads dominate context** — each Read = 1-2.4K tokens. Aegis should minimize file reads in prompts (be specific about which files to look at).
6. **200K context window** — for complex tasks, CC will hit context limits. Aegis should monitor context usage and suggest /compact or session fork.

## 2026-03-31 — CC 2.1.88 Changelog Analysis (while blocked on OAuth)

### New features relevant to Aegis:
1. **`PermissionDenied` hook** — fires after auto mode classifier denials, can return `{retry: true}`. Aegis should surface this in the API/status.
2. **`WorktreeCreate` hook with `type: "http"`** — allows HTTP-based worktree creation. Could integrate with Aegis worktree management.
3. **Named subagents in `@` mention** — CC now suggests named subagents. Aegis session tracking should handle subagent references.

### Fixes relevant to Aegis:
- **Background subagents invisible after compaction** — could cause session tracking issues
- **`--worktree` fix** for non-git repos before WorktreeCreate hook
- **SDK session history loss on resume** — progress messages forking parentUuid chain

## 2026-04-01 — CC v2.1.89 Changelog Analysis

### Impact on Aegis — HIGH

1. **`"defer"` permission decision for PreToolUse hooks** — Headless sessions can pause at tool calls and resume with `-p --resume`. Aegis needs to support this: when CC returns `defer`, Aegis should save state and allow resuming via API.

2. **`PermissionDenied` hook** — Fires after auto-mode classifier denials. Return `{retry: true}` to retry. Aegis hook system needs to handle this new hook type.

3. **`MCP_CONNECTION_NONBLOCKING=true`** — For `-p` mode, skip MCP connection wait. Bounded `--mcp-config` connections at 5s. Aegis should set this env var for headless sessions to avoid startup delays.

4. **Named subagents in `@` mention** — Typeahead for subagents. Low impact on Aegis API but relevant for UX.

5. **`CLAUDE_CODE_NO_FLICKER=1`** — Flicker-free rendering. Aegis should set this for tmux sessions.

6. **Fixed: StructuredOutput schema cache bug** — 50% failure rate with multiple schemas. If Aegis uses structured output, this fix matters.

7. **Fixed: memory leak in LRU cache** — Large JSON inputs retained. Relevant for long-running sessions.

8. **Fixed: LSP server zombie state** — Auto-restart on next request. Good for stability.

### Action Items for Aegis
- [ ] Support `defer` permission in PreToolUse hook handling
- [ ] Support `PermissionDenied` hook type
- [ ] Set `MCP_CONNECTION_NONBLOCKING=true` for headless sessions
- [ ] Set `CLAUDE_CODE_NO_FLICKER=1` for tmux sessions
- [ ] Update hook event types in src/hooks.ts

## 2026-04-02 18:08 UTC — CC 2.1.89-2.1.90 Analysis

### Relevant to Aegis:
1. **defer permission decision (2.1.89)**: PreToolUse hooks can return "defer" to pause headless sessions. Aegis could use this for async permission workflows.
2. **PermissionDenied hook (2.1.89)**: Fires after auto-mode denials. Aegis can track denied tools for analytics.
3. **MCP_CONNECTION_NONBLOCKING=true (2.1.89)**: Skip MCP connection wait in -p mode. Useful for faster session creation.
4. **SSE large frame fix (2.1.90)**: Quadratic → linear for large streamed frames. Aegis uses SSE transport.
5. **Per-turn MCP schema JSON.stringify eliminated (2.1.90)**: Performance win for Aegis MCP server usage.
6. **--resume improvements (2.1.90)**: Better cache handling, no longer shows -p sessions. Affects Aegis session listing.
7. **CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE (2.1.90)**: Offline plugin resilience.
8. **Edit after Bash (2.1.89)**: Edit works on files viewed via cat/sed without prior Read. Changes CC interaction patterns.

### 2026-04-02 20:40 UTC — CC Changelog Scan (2.1.87 → 2.1.90)

**Key findings for Aegis:**

1. **`defer` permission (2.1.89):** PreToolUse hooks can now return `defer`, pausing headless sessions. Resumable via `-p --resume`. Aegis should support this flow — when CC defers, expose a "resume" action in the API.

2. **`PermissionDenied` hook (2.1.89):** Fires after auto-mode classifier denial. Return `{retry: true}` to let model retry. Aegis could use this for smarter permission handling.

3. **`MCP_CONNECTION_NONBLOCKING=true` (2.1.89):** Skips MCP connection wait in `-p` mode. Could speed up Aegis session creation if we pass this env var.

4. **`/powerup` (2.1.90):** Interactive lessons for CC features. Interesting DX pattern — Aegis could offer similar onboarding.

5. **PowerShell hardening (2.1.89, 2.1.90):** Multiple security fixes for PS tool. Relevant for Windows support sprint (#907-#912).

6. **Auto mode boundary respect (2.1.90):** CC now respects user-set boundaries in auto mode. Good for Aegis — our workflow skills set boundaries.

7. **LSP zombie recovery (2.1.89):** Auto-restart on crash. Reduces our need to handle LSP failures.

8. **Autocompact thrash loop fix (2.1.89):** Detects when context refills after compacting 3x and stops. Important for long Aegis sessions.

**Action items:**
- Consider `defer` permission support in Aegis API (enhancement issue)
- Pass `MCP_CONNECTION_NONBLOCKING=true` for faster session creation
- Monitor Windows hardening for psmux integration

## 2026-04-03 — CC v2.1.91 Research

### Version Check
- Local CC: 2.1.91
- npm latest: 2.1.91
- Changelog: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md

### Features Relevant to Aegis

#### 1. `_meta["anthropic/maxResultSizeChars"]` (up to 500K)
MCP tool result persistence override. Large results like DB schemas won't be truncated.
**Aegis use case:** Could be useful for `get_transcript` and `read` operations where large output might be truncated. Investigate if Aegis currently hits truncation limits.

#### 2. `disableSkillShellExecution` setting
Disables inline shell execution in skills, custom slash commands, and plugin commands.
**Aegis use case:** If Aegis exposes MCP tools as a skill, this could be relevant for security.

#### 3. `PermissionDenied` hook
Fires after auto mode classifier denials. Return `{retry: true}` to retry.
**Aegis use case:** Relevant to permission system work in #742. Could improve the dynamic permission policy API.

#### 4. Named subagents (`@` mention typeahead)
CC now supports named subagents with @ mention.
**Aegis use case:** Might be relevant to sub-agent spawning API (#700). CC now has native subagent concept - Aegis's wrapper should be compatible.

#### 5. `MCP_CONNECTION_NONBLOCKING=true`
Already implemented in Aegis (#931).

### No Competitor Research Done
Perplexity API rate limited (401). Will retry next heartbeat.


## 2026-04-10 CC Research

### Version Analysis
- Local CC: 2.1.92
- npm latest: 2.1.100
- changelog covers: 2.1.97, 2.1.98 (2.1.99/100 not yet documented)
- stable tag: 2.1.89

### Key Findings from 2.1.98
1. **`workspace.git_worktree` in status line** - CC now detects when running inside a git worktree. Relevant for Aegis worktree naming.
2. **Monitor tool** - streams events from background scripts. Potential for Aegis to use for tracking CC progress.
3. **Subprocess sandboxing** - PID namespace isolation on Linux, `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`, `CLAUDE_CODE_SCRIPT_CAPS` env vars. Security-relevant for Aegis multi-agent.
4. **`CLAUDE_CODE_PERFORCE_MODE`** - Edit/Write/NotebookEdit fail on read-only files with `p4 edit` hint instead of overwriting.
5. **W3C TRACEPARENT env var** - OTEL tracing now propagates to child processes.

### Findings from 2.1.97
1. **`workspace.git_worktree` in status line** - same as 2.1.98, duplicated.
2. **Focus view toggle (Ctrl+O)** in NO_FLICKER mode.
3. **`refreshInterval` status line setting** - re-runs status line command every N seconds.
4. **`● N running` indicator** in `/agents` for live subagents.
5. **Subagents with worktree isolation** - fixed leak of working directory back to parent session's Bash tool.

### Action Items for Aegis
- Consider using `workspace.git_worktree` in status line detection instead of manual path parsing
- Monitor tool could be used for better CC session state tracking in Aegis
- Subprocess sandboxing is relevant for security-hardened deployments

## CC Research Update - 2026-04-11 07:26 UTC

### Version Gap
- Local: 2.1.92
- npm latest: 2.1.101
- Versions not installed: 2.1.94, 2.1.96, 2.1.97, 2.1.98, 2.1.100, 2.1.101

### CC 2.1.101 Features (released 2026-04-10)
1. `/team-onboarding` command - generates teammate ramp-up guide from local usage
2. OS CA certificate store trust by default (CLAUDE_CODE_CERT_STORE=bundled flag)
3. `/ultraplan` and remote-session auto-create default cloud environment
4. Improved brief mode with retry on plain text fallback

### Relevance to Aegis
- Team onboarding: Could integrate with Aegis onboarding workflow
- OS CA trust: Enterprise TLS - Aegis should support custom CA config
- Remote session auto-provisioning: Related to multi-session management

### No changelog entries yet
- 2.1.99 and 2.1.100 have no CHANGELOG.md entries (versions skipped in changelog)

## CC 2.1.98 Features (relevant to Aegis)

### Security Fixes (critical for Aegis)
1. **Bash tool permission bypass fixes** - backslash-escaped flags, compound commands, forced permission prompts
2. **Read-only commands with env-var prefixes** - now properly prompting
3. **Redirects to /dev/tcp/...** - now prompting instead of auto-allowing
4. **Bash deny rules with piped commands** - fixed matching

### New Features
1. **Monitor tool** - streaming events from background scripts
2. **workspace.git_worktree** in status line - set when in linked worktree
3. **Subprocess sandboxing** - PID namespace isolation on Linux
4. **CLAUDE_CODE_PERFORCE_MODE** - env var for edit/write failures on read-only files

### Relevance to Aegis
- Monitor tool: Could enhance Aegis session monitoring
- workspace.git_worktree: Already using worktrees - could expose in Aegis API
- Subprocess sandboxing: Related to CC subprocess management
- All security fixes: Aegis should ensure it handles these edge cases

### Local version 2.1.92 is 6 versions behind

## CC 2.1.97 Features
- `workspace.git_worktree` in status line (already noted in 2.1.98)
- MCP HTTP/SSE buffer leak fixed (~50 MB/hr)
- MCP OAuth refresh fix for ADFS/IdPs
- Permission rules fix for prototype properties (e.g., toString)
- Focus view toggle (Ctrl+O) in NO_FLICKER mode

## CC 2.1.94/2.1.96 Features
- Amazon Bedrock with Mantle support (CLAUDE_CODE_USE_MANTLE=1)
- Default effort level changed from medium to high for API-key/Bedrock/Vertex/Team/Enterprise
- hookSpecificOutput.sessionTitle in UserPromptSubmit hooks - for setting session title
- Plugin skills via "skills": ["./"] now use frontmatter name for invocation
- 429 with long Retry-After now surfaces immediately
- Plugin hooks YAML frontmatter fixes

## Relevance to Aegis
- Session title hooks: Could enhance Aegis session naming
- Mantle support: May be relevant for enterprise deployments
- Effort level defaults: Affects CC behavior for users

## CC 2.1.101 Critical Security & Feature Fixes

### Security (CRITICAL for Aegis)
1. **Command injection in POSIX `which` fallback** - LSP binary detection vulnerability
2. **permissions.deny override hook's ask** - PreToolUse hook can't downgrade deny to ask
3. **Bedrock SigV4 auth failing with custom Authorization headers** - Fixed

### Subagent Improvements
1. **MCP tools from dynamic servers** now inherit to subagents
2. **Sub-agents in isolated worktrees** can now Read/Edit files in their own worktree
3. **`--resume` chain recovery** no longer bridges into unrelated subagent conversations

### Performance/Memory
1. **Memory leak fixed**: Long sessions no longer retain dozens of historical message copies
2. **Hardcoded 5-min timeout** - now honors API_TIMEOUT_MS

### Other Notable
1. **OS CA certificate store trust by default** - enterprise TLS without extra setup
2. **`claude -w <name>` now handles stale worktree directories** from previous sessions
3. **`/team-onboarding` command** - generates teammate ramp-up guide

### Relevance to Aegis
- LSP command injection: Check if Aegis LSP integration is affected
- Subagent worktree fixes: Better isolation for Aegis session management
- Hardcoded timeout: Now configurable for slow backends
