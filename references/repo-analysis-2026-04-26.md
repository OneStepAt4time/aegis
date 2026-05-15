# Competitive Repo Analysis for Aegis — 2026-04-26

> Analysis of 12 accessible repos + 3 resources for actionable ideas to incorporate into Aegis (Claude Code session orchestrator, TypeScript + Fastify + tmux + MCP SDK).

---

## 1. parkerhancock/dev-terminal

**URL:** https://github.com/parkerhancock/dev-terminal

**What it does:** Persistent terminal (PTY) session management via HTTP API. Inspired by dev-browser. Provides named terminal sessions that survive script restarts, with SSH support, a headed browser UI for live monitoring, and LLM-friendly snapshots (text, ANSI, SVG).

**Tech stack:** Node.js, node-pty (implicit), HTTP + WebSocket, optional browser UI.

**Key patterns:**
- Named terminal registry — create once, reconnect across scripts
- `waitForText("pattern")` — blocks until text appears in output
- `waitForExit()` — blocks until process terminates
- SVG snapshot rendering for AI visual analysis
- SSH as first-class citizen (same API as local)
- Clean REST API: `/terminals/:name/write`, `/terminals/:name/snapshot`

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| `waitForText` pattern | Add await-style "wait for output pattern" to session interaction API. Currently Aegis sessions rely on polling or timeout-based output capture. A regex/glob matcher that resolves when output matches would be far more reliable for detecting "build complete", "server ready", etc. | M | P1 |
| SVG snapshot endpoint | Add `/v1/sessions/:id/snapshot?format=svg` for visual debugging of session output. Useful for dashboard embedding and LLM-friendly visual analysis. | S | P2 |
| Named session reconnection | Allow reattaching to a named session by name rather than UUID. Useful for long-running dev servers. | S | P2 |

---

## 2. AuraFriday/terminal_mcp

**URL:** https://github.com/AuraFriday/terminal_mcp

**What it does:** Universal terminal MCP server supporting 20+ connection types (SSH, serial, TCP, Telnet, WebSocket, Bluetooth Classic/BLE, RFC2217, Unix sockets, named pipes, STDIO). Built for AI agents to control any device. Features pattern matching, atomic execution, SFTP, auto-reconnect, and audit logging.

**Tech stack:** Python, MCP SDK, 9000+ lines, thread-safe, cross-platform.

**Key patterns:**
- Pattern matching — AI waits for specific responses before proceeding
- Atomic execution — multi-step operations execute as a unit
- Auto-reconnect — sessions survive device resets/unplugs
- SFTP over existing SSH connection
- Passwords never logged to disk
- Audit trails for every session

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Atomic command execution | Wrap multi-step operations (e.g., "cd, run, verify") in atomic transactions with rollback on failure. Prevents partial-state sessions. | M | P2 |
| Auto-reconnect for sessions | Detect when a Claude Code session's tmux pane dies unexpectedly and auto-restart it, preserving the brief. | M | P1 |
| Audit trail for all session operations | Log every API call (create, write, read, terminate) with timestamps, user, and outcome. Useful for debugging and compliance. | S | P3 |

---

## 3. DaniAkash/agent-terminal

**URL:** https://github.com/DaniAkash/agent-terminal

**What it does:** Native macOS terminal app built for AI coding agents. Project-scoped workspaces, agent-aware tabs (detects Claude Code, Codex), live status bar with process metrics, memory, git state, listening ports, and model flags. MOD system in Rust for subscribing to PTY output and shell hook events.

**Tech stack:** Tauri v2 (Rust backend + WebView), xterm.js (WebGL renderer), portable-pty (Rust), React + TypeScript + Vite, nanostores, shadcn/ui.

**Key patterns:**
- **MOD system** — Rust-native plugin architecture where each MOD subscribes to PTY output and shell hooks, extracts structured data, emits to frontend
- OSC 7 shell hooks for CWD tracking
- OSC 133 shell integration for process state tracking
- Agent detection (Claude Code sunburst, Codex hex, danger badges for --dangerously-skip-permissions)
- Status bar: PID, RSS memory, elapsed time, TCP ports, git branch, CWD
- Agent turn detection (active vs idle)

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Live process metrics per session | Expose PID, RSS memory, elapsed time, CPU % via session API. Dashboard can poll this for real-time monitoring. | M | P1 |
| Agent detection from PTY output | Parse Claude Code output to detect: model in use, permission mode, current task, turn start/end. Store as session metadata. | M | P1 |
| Listening port detection | Scan for TCP ports opened by the session's subprocess. Surface "dev server ready at :3000" automatically. | S | P2 |

---

## 4. MadAppGang/tmux-mcp

**URL:** https://github.com/MadAppGang/tmux-mcp

**What it does:** Go-based MCP server for tmux with 20 tools organized in two layers: Layer 1 (tmux primitives) and Layer 2 (agent workflows). Key innovation: treats tmux as a smart pipe with native OS process detection, synchronous command execution via `tmux wait-for`, and zero-lookup chaining (IDs returned in every response).

**Tech stack:** Go 1.21+, single binary (~7MB), zero external dependencies.

**Key patterns:**
- **Synchronous execute-command** — wraps commands with `tee` and `tmux wait-for` so it blocks until done, returns output + exit code in one response
- **start-and-watch** — starts a command, monitors until a readiness pattern matches (e.g., "Serving HTTP on port 8765")
- **pane-state** — OS-level process state detection (foregroundPid, foregroundCmd, isAlive, waitingForInput)
- **run-in-repl** — send input to running REPL, wait for prompt pattern
- **watch-pane** — monitor existing pane until trigger fires (exit, shell, pattern, timeout)
- Zero-lookup chaining — every response includes all IDs needed for the next call
- Progress notifications during monitoring

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Synchronous command execution | Implement `tmux wait-for` pattern for blocking command execution. Returns output + exit code atomically. Eliminates polling loops. | M | P1 |
| Process state detection | Use `/proc` or equivalent to get foreground PID, command, waiting-for-input state per pane. Critical for knowing when Claude Code is idle vs processing. | M | P1 |
| start-and-watch with readiness patterns | Allow Aegis to start a command and wait for a specific output pattern (regex). Perfect for "npm run dev" → wait for "ready on :3000". | M | P1 |

---

## 5. michael-abdo/tmux-claude-mcp-server

**URL:** https://github.com/michael-abdo/tmux-claude-mcp-server

**What it does:** MCP server for hierarchical orchestration of Claude Code instances via tmux. Bridge pattern architecture: single MCP server process (50-70MB) shared across multiple Claude instances, reducing memory by 85% vs separate servers. Features role-based access (Executive/Manager/Specialist), scheduled "continue" messages, workspace modes, git integration, conflict detection, and a monitoring dashboard.

**Tech stack:** Node.js, tmux, JSON file-based state store, Express for dashboard, npm package.

**Key patterns:**
- **Bridge pattern** — single MCP server, lightweight Bash bridge for multi-instance access
- Hierarchical naming: `exec_1`, `mgr_1_1`, `spec_1_1_1`
- Role-based access: Specialists have NO MCP tools, only Executive/Manager orchestrate
- Scheduled "Plz continue" messages to idle sessions
- Shared vs isolated workspace modes
- Auto branch management for shared workspaces
- AI-powered merge conflict resolution

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Hierarchical session orchestration | Support parent-child session relationships with role-based permissions. A parent session can spawn, send to, read from, and terminate child sessions. | L | P2 |
| Scheduled continue messages | Auto-send "continue" prompts to sessions that have been idle for N minutes. Prevents Claude Code sessions from timing out during long tasks. | S | P1 |
| Monitoring dashboard | Web-based dashboard showing all active sessions, their status, resource usage, and output. Real-time via WebSocket. | L | P2 |

---

## 6. wehnsdaefflae/terminal-control-mcp

**URL:** https://github.com/wehnsdaefflae/terminal-control-mcp

**What it does:** Python MCP server for controlling terminal sessions through persistent tmux-based sessions. Features a real-time web interface (xterm.js), dual access (agent + user simultaneously), comprehensive security controls (command filtering, path protection, rate limiting, history isolation), and flexible content modes (screen, history, since-input, tail).

**Tech stack:** Python 3.9+, tmux + libtmux, TOML configuration, xterm.js web interface, WebSocket.

**Key patterns:**
- **Dual access** — agent (MCP) and user (browser) interact simultaneously
- **History isolation** — each session gets isolated history files, auto-cleaned on terminate
- **Command filtering** — blocks dangerous operations (rm -rf /, sudo, disk formatting)
- **Flexible content modes** — screen (current buffer), history (scrollback), since-input (output since last input), tail (last N lines)
- **Security levels** — off/low/medium/high with configurable rules
- Rate limiting (60 calls/min) and session limits (max 50)

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Dual access (API + browser) | Allow both the Aegis API and a web terminal to interact with the same tmux session simultaneously. Users can watch Claude Code work in real-time. | M | P1 |
| History isolation per session | Each Aegis session gets its own shell history file, auto-deleted on session end. Prevents cross-session pollution. | S | P2 |
| Content modes for output capture | Support different output capture modes: current screen, full history, since-last-input, tail. Different modes for different use cases. | S | P1 |

---

## 7. Infraware-dev/terminal

**Status:** ⚠️ **Repo not found** (404). Likely deleted, renamed, or made private. Was described as a Rust terminal with portable-pty backend. No data available.

**Actionable for Aegis:** None (cannot analyze).

---

## 8. WangYihang/interactive-terminal-mcp

**URL:** https://github.com/WangYihang/interactive-terminal-mcp

**What it does:** Stateful, interactive terminal MCP server. Unlike stateless command execution, it allows LLMs to spawn persistent processes (ssh, ipython, gdb), maintain session context, and interact via standard I/O. Supports waiting for specific output patterns (regex) and exposes full session history as MCP resources.

**Tech stack:** Python, uvx/pip, MCP SDK.

**Key patterns:**
- **Stateful sessions** — environment variables, CWD, process state persist between commands
- **Interactive support** — designed for REPLs and interactive CLIs
- **Output control** — wait for regex patterns to ensure commands complete
- **Session history as MCP resources** — `cli://{session_id}/history`
- Session recording (asciinema format)

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Session history as API resource | Expose full session I/O history via `/v1/sessions/:id/history`. Useful for debugging, audit, and context reconstruction. | S | P1 |
| Regex-based output wait | Already partially planned (from tmux-mcp analysis). This confirms the pattern is widely adopted across the ecosystem. | M | P1 |
| Session recording (asciinema) | Record session terminal output in asciinema format for replay and audit. | M | P3 |

---

## 9. nexon33/console-terminal-mcp-server

**URL:** https://github.com/nexon33/console-terminal-mcp-server

**What it does:** MCP server using node-pty inside hidden Electron BrowserWindow instances. Provides terminal session management (start, execute, get output, stop, list sessions) with the MCP server communicating with an Electron backend via HTTP.

**Tech stack:** Node.js, Electron, node-pty, Express HTTP server, MCP SDK.

**Key patterns:**
- **Hidden BrowserWindow for PTY** — terminal runs inside invisible Electron windows
- **MCP → HTTP → Electron bridge** — MCP server (stdio) talks to Electron backend (HTTP) which manages actual terminals
- Auto-restart of Electron process when needed
- Session lifecycle: start → execute → get output → stop

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Hidden headless terminal for testing | Consider a headless mode where Aegis runs Claude Code in a virtual terminal without tmux dependency. Useful for CI/testing environments. | L | P3 |
| MCP-to-HTTP bridge pattern | If Aegis ever needs to expose MCP tools over HTTP (for non-stdio clients), the MCP→HTTP bridge pattern is proven. | M | P3 |

---

## 10. banteg/takopi

**URL:** https://github.com/banteg/takopi

**What it does:** Telegram bridge for coding agents (Codex, Claude Code, OpenCode, Pi). Manages multiple projects and git worktrees, streams progress (commands, tools, file changes, elapsed time), supports stateless resume, parallel runs, file transfer, and group chat topic-to-repo mapping.

**Tech stack:** Python 3.14+, uv, Telegram Bot API, plugin architecture.

**Key patterns:**
- **Stateless resume** — continue in chat or copy resume line to pick up in terminal
- **Progress streaming** — real-time updates on commands, tools, file changes, elapsed time
- **Git worktree management** — automatic worktree creation per branch
- **Parallel runs** — per-agent-session queue with parallel execution
- **Plugin system** — entrypoint-based plugins for engines, transports, commands
- **Topic-to-repo mapping** — Telegram group topics map to specific repo/branch contexts

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Real-time progress streaming | Stream Claude Code session events (tool calls, file changes, token usage, elapsed time) to connected clients via WebSocket/SSE. Similar to takopi's progress model. | M | P1 |
| Stateless session resume | Generate a resume token for each session that allows resuming from any context (API, CLI, dashboard). | M | P2 |
| Git worktree-aware sessions | Automatically create git worktrees for new Aegis sessions working on different branches. Clean up on session end. | M | P2 |

---

## 11. aybelatchane/mcp-server-terminal (originally "MCPAutomationServer")

**URL:** https://github.com/aybelatchane/mcp-server-terminal

**What it does:** MCP server enabling AI agents to interact with terminal applications through a structured "Terminal State Tree" (TST) representation. Supports session management, snapshots, key presses, typing, clicking on detected UI elements, and waiting for text/idle states. Headless and visual modes.

**Tech stack:** Rust (binary: `terminal-mcp`), npm package (`mcp-server-terminal`), xterm/tmux on Linux/macOS. Works with Claude Code, Codex, Gemini CLI, VS Code, Cursor, Windsurf, Zed, Bedrock — any MCP client.

**Key patterns:**
- **Terminal State Tree (TST):** Abstracts terminal content into structured UI elements, not just raw text — enables AI to "click on buttons" in terminal apps
- **Session lifecycle:** `session_create` → `snapshot` → `type/press_key/click` → `wait_for` → `session_close`
- **Headless mode:** `--headless` flag for CI/server environments without display
- **Cross-platform:** Linux (full), macOS (full), Windows WSL (full), Windows native (headless only)

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Adopt TST pattern for pane inspection | Instead of scraping raw tmux output, parse into a structured state tree. More reliable for detecting permission prompts, error states, and interactive elements. | M | P2 |
| Headless session mode | Run Claude Code sessions without visible tmux panes. Useful for CI, background batch processing, and resource-constrained environments. | M | P2 |
| Terminal element interaction | Send specific key combinations and detect UI elements in Claude Code output (e.g., detect permission prompts, auto-respond). | S | P3 |

---

## 12. tsunamayo7/claude-code-codex-agents (originally "helix-codex")

**URL:** https://github.com/tsunamayo7/claude-code-codex-agents

**What it does:** MCP server that bridges Claude Code to Codex CLI (GPT-5.4) with full JSONL trace parsing. Returns structured execution reports — which tools Codex used, which files it touched, timing, and errors. Supports parallel execution (up to 6 simultaneous tasks), session continuity via threadId persistence, adversarial review loop, and agent lifecycle management.

**Tech stack:** Python 3.12, FastMCP, Codex CLI (npm `@openai/codex`). Single file (~820 lines). 59 tests. Zero external dependencies beyond Codex CLI.

**Key patterns:**
- **Structured JSONL trace parsing:** Parses every Codex event into a `CodexTrace` object with tools used, files touched, timing, errors — not just raw text dump
- **3-tier sandbox:** read-only (no write/exec) → workspace-write (CWD only) → danger-full-access
- **Agent lifecycle pattern:** `spawn_codex_agent` → `send_codex_agent_input` → `wait_codex_agent` → `close_codex_agent` — treats Codex as a persistent sub-agent
- **Adversarial review:** GPT-5.4 reviews Claude's code from a different perspective (cross-model validation)
- **Terminal injection prevention:** ANSI/OSC escape sequence sanitization
- **Session continuity:** threadId persistence across calls via `session_continue`

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Structured session traces | Parse Claude Code JSONL output into structured traces (tools used, files touched, timing, errors) for analytics and cost tracking. This repo proves the pattern for Codex; Aegis should do it for Claude Code. | M | P1 |
| Multi-model orchestration | Add optional secondary model execution (e.g., adversarial code review with GPT-5.4) as a first-class Aegis feature. Proven pattern. | L | P2 |
| Agent lifecycle API | Adopt spawn/send/wait/close as the standard Aegis session API pattern. Matches how agents actually work. | S | P1 |

---

## 13. FlorianBruniaux/claude-code-ultimate-guide/examples/hooks

**URL:** https://github.com/FlorianBruniaux/claude-code-ultimate-guide/tree/main/examples/hooks

**What it does:** Comprehensive collection of 30+ Claude Code hook examples across all hook event types. Covers security (dangerous action blocking, secrets scanning, prompt injection detection, unicode injection, repo integrity, CLAUDE.md injection), automation (auto-format, auto-checkpoint, typecheck-on-save, test-on-change), monitoring (session-logger, output-validator, privacy-warning, session-summary with 15 configurable sections), and productivity (RTK baseline, velocity governor, TTS, notifications).

**Tech stack:** Bash scripts, PowerShell scripts, Claude Code hooks system.

**Key patterns:**
- **PreToolUse security hooks** — block dangerous commands, scan for secrets, detect injection attempts
- **PostToolUse automation hooks** — auto-format, auto-checkpoint, run typecheck/tests on file changes
- **Session lifecycle hooks** — SessionStart (setup, config scan), SessionEnd (summary, analytics), Stop (learning capture)
- **velocity-governor.sh** — rate-limit tool calls to avoid API throttling
- **session-summary.sh** — 15-section configurable session analytics
- **auto-rename-session.sh** — AI-powered session title via Haiku

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Auto-format on edit | Hook into Claude Code PostToolUse for Write/Edit to auto-format (prettier, eslint --fix). Aegis can install/manage these hooks per project. | S | P2 |
| Session summary generation | After session end, auto-generate a structured summary: what was done, files changed, tests run, time spent. Store in session metadata. | M | P1 |
| Security gate hook | Install PreToolUse hooks that scan for secrets, dangerous commands, and prompt injection. Configurable per project security level. | M | P2 |

---

## 14. luongnv89/claude-howto/06-hooks

**URL:** https://github.com/luongnv89/claude-howto/tree/main/06-hooks

**What it does:** Exhaustive documentation of Claude Code's hook system. Covers all 28+ hook events, 5 hook types (command, http, prompt, mcp_tool, agent), matcher patterns, JSON I/O format, and configuration locations. This is the most comprehensive reference for Claude Code hooks available.

**Tech stack:** Documentation (markdown).

**Key patterns:**
- **28 hook events** documented: SessionStart, InstructionsLoaded, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, SubagentStart, SubagentStop, Stop, StopFailure, TeammateIdle, TaskCompleted, ConfigChange, CwdChanged, FileChanged, PreCompact, PostCompact, WorktreeCreate, WorktreeRemove, Elicitation, ElicitationResult, SessionEnd, etc.
- **5 hook types**: command (bash), http (webhook), prompt (LLM eval), mcp_tool (MCP invocation), agent (subagent)
- **Pattern matching**: exact string, regex, wildcard, MCP tool patterns (`mcp__memory__.*`)
- **Hook return codes**: exit 0 = allow, exit 2 = deny, exit 3 = ask user, JSON output for context modification
- **once** flag for one-time hooks per session
- **InstructionsLoaded matcher values**: session_start, nested_traversal, path_glob_match

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Aegis hook management API | CRUD API for managing Claude Code hooks per project. Aegis installs/removes/updates hooks in `.claude/settings.local.json` programmatically. | M | P1 |
| mcp_tool hook type integration | Use `mcp_tool` hook type to invoke Aegis tools from Claude Code hooks (e.g., PostToolUse → call Aegis to log the operation). | S | P1 |
| PreCompact/PostCompact hooks | Install hooks that save critical session state before context compaction and restore relevant context after. Prevents loss of important context. | M | P2 |

---

## 15. anthropics/claude-code issue #6305 — PostToolUse hooks bug

**URL:** https://github.com/anthropics/claude-code/issues/6305

**What it does:** Bug report documenting that PreToolUse and PostToolUse hooks are NOT firing in Claude Code, while other hook types (Stop, SubagentStop, UserPromptSubmit) work correctly. Tested with multiple matchers ("*", "Bash", "Task", "Write", "Edit"), confirmed hooks execute manually, proper JSON handling verified.

**Key findings:**
- PreToolUse/PostToolUse hooks silently fail to execute
- Other hook types work fine with identical configuration
- Affects macOS with claude-sonnet-4-20250514
- This is a known bug in Claude Code — not a user configuration issue

**Actionable for Aegis:**

| Idea | Description | Effort | Priority |
|------|-------------|--------|----------|
| Hook health check | Add a diagnostic tool that tests whether Claude Code hooks are actually firing. Run as part of Aegis session setup. Detect broken hook configurations early. | S | P1 |
| Fallback hook mechanism | If Claude Code hooks are unreliable, Aegis can implement equivalent functionality by parsing Claude Code's JSONL output directly (tool_use/tool_result events). | M | P1 |
| Track Claude Code hook bugs | Monitor this and similar issues. If hooks remain broken, Aegis should not depend on them for critical functionality. | S | P1 |

---

# Consolidated Ideas by Category

## Terminal/PTY Improvements

| # | Idea | Source | Effort | Priority |
|---|------|--------|--------|----------|
| 1 | `waitForText` / regex-based output wait | dev-terminal, interactive-terminal-mcp, tmux-mcp | M | **P1** |
| 2 | Synchronous command execution via `tmux wait-for` | tmux-mcp | M | **P1** |
| 3 | Process state detection (foreground PID, waiting-for-input) | tmux-mcp | M | **P1** |
| 4 | start-and-watch with readiness patterns | tmux-mcp | M | **P1** |
| 5 | Content modes for output capture (screen/history/since-input/tail) | terminal-control-mcp | S | P1 |
| 6 | Live process metrics per session (PID, RSS, elapsed, CPU) | agent-terminal | M | P1 |
| 7 | Listening port detection per session | agent-terminal | S | P2 |
| 8 | SVG snapshot endpoint for visual debugging | dev-terminal | S | P2 |
| 9 | History isolation per session | terminal-control-mcp | S | P2 |
| 10 | Atomic command execution with rollback | terminal_mcp | M | P2 |
| 11 | Auto-reconnect for dead sessions | terminal_mcp | M | P1 |

| 10 | Atomic command execution with rollback | terminal_mcp | M | P2 |
| 11 | Auto-reconnect for dead sessions | terminal_mcp | M | P1 |
| 12 | Headless session mode (no visible tmux panes) | mcp-server-terminal | M | P2 |
| 13 | Terminal State Tree (TST) for structured pane inspection | mcp-server-terminal | M | P2 |

## Session Management

| # | Idea | Source | Effort | Priority |
|---|------|--------|--------|----------|
| 12 | Dual access (API + browser for same tmux session) | terminal-control-mcp | M | **P1** |
| 13 | Session history as API resource | interactive-terminal-mcp | S | P1 |
| 14 | Real-time progress streaming (tool calls, file changes, tokens) | takopi | M | P1 |
| 15 | Scheduled continue messages for idle sessions | tmux-claude-mcp-server | S | P1 |
| 16 | Stateless session resume tokens | takopi | M | P2 |
| 17 | Git worktree-aware session creation/cleanup | takopi | M | P2 |
| 18 | Hierarchical session orchestration (parent-child, roles) | tmux-claude-mcp-server | L | P2 |
| 19 | Named session reconnection | dev-terminal | S | P2 |
| 20 | Audit trail for all session operations | terminal_mcp | S | P3 |
| 21 | Session recording (asciinema format) | interactive-terminal-mcp | M | P3 |

## Claude Code Hooks & JSONL

| # | Idea | Source | Effort | Priority |
|---|------|--------|--------|----------|
| 22 | Hook health check diagnostic tool | issue #6305 | S | **P1** |
| 23 | Fallback: parse JSONL output when hooks fail | issue #6305 | M | **P1** |
| 24 | Aegis hook management API (CRUD for .claude/settings) | claude-howto | M | P1 |
| 25 | `mcp_tool` hook integration (Aegis as hook target) | claude-howto | S | P1 |
| 26 | Track Claude Code hook bugs proactively | issue #6305 | S | P1 |
| 27 | Auto-generate session summaries on SessionEnd | claude-code-ultimate-guide | M | P1 |
| 28 | Install security gate hooks (secrets, injection, dangerous cmds) | claude-code-ultimate-guide | M | P2 |
| 29 | PreCompact/PostCompact hooks for context preservation | claude-howto | M | P2 |
| 30 | Auto-format on edit hooks | claude-code-ultimate-guide | S | P2 |
| 31 | ANSI/OSC escape sequence sanitization in session output | claude-code-codex-agents | S | P2 |
| 32 | 3-tier sandbox (read-only → workspace-write → full-access) | claude-code-codex-agents | M | P2 |

## MCP Protocol Patterns

| # | Idea | Source | Effort | Priority |
|---|------|--------|--------|----------|
| 31 | Zero-lookup chaining (return all IDs in every response) | tmux-mcp | S | P1 |
| 32 | Agent detection from PTY output (model, permissions, turn state) | agent-terminal | M | P1 |
| 33 | Two-layer tool API (primitives + agent workflows) | tmux-mcp | M | P2 |
| 34 | Bridge pattern for multi-instance MCP access | tmux-claude-mcp-server | M | P3 |
| 35 | Agent lifecycle API (spawn/send/wait/close) | claude-code-codex-agents | S | P1 |

## Dashboard/UI Ideas

| # | Idea | Source | Effort | Priority |
|---|------|--------|--------|----------|
| 35 | Real-time web terminal (xterm.js + WebSocket) | terminal-control-mcp, dev-terminal | M | P1 |
| 36 | Session list with live status (running/idle/error) | all repos | S | P1 |
| 37 | Monitoring dashboard (sessions, metrics, output) | tmux-claude-mcp-server, terminal-control-mcp | L | P2 |
| 38 | Session summary analytics (15 configurable sections) | claude-code-ultimate-guide | M | P2 |

---

# Top 10 Priority Ideas (P1, ordered by impact)

1. **Regex-based output wait** — The single most requested pattern across all repos. Critical for reliable session interaction.
2. **Process state detection** — Knowing when Claude Code is idle vs processing vs waiting for input. Foundation for everything else.
3. **Synchronous command execution** — Atomic output + exit code. Eliminates fragile polling.
4. **Dual access (API + browser)** — Users need to see what Claude Code is doing in real-time.
5. **Real-time progress streaming** — WebSocket/SSE for tool calls, file changes, token usage.
6. **Structured session traces (JSONL parsing)** — Parse CC output into structured traces (tools, files, timing, errors) for analytics and cost tracking. Proven by claude-code-codex-agents.
7. **Hook health check + JSONL fallback** — Hooks are broken in CC; Aegis needs a reliable alternative.
8. **Aegis hook management API** — Programmatic hook CRUD per project.
9. **Agent detection from PTY** — Parse CC output for model, permissions, turn state. Metadata goldmine.
10. **Agent lifecycle API (spawn/send/wait/close)** — Standard session API pattern. Adopt from claude-code-codex-agents.

---

# Repos Not Analyzed (404)

| Repo | Reason |
|------|--------|
| Infraware-dev/terminal | 404 — likely deleted/renamed/private |
| MCPAutomationServer | 404 — not found on GitHub |
| helix-codex | 404 — not found on GitHub |

---

*Generated by Hephaestus 🔨 — 2026-04-26*
