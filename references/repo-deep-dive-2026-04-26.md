# Repo Deep-Dive Analysis — 2026-04-26

> Analysis of 9 repos (1 repo not found: Infraware-dev/terminal) across three categories
> relevant to Aegis core development: terminal/PTY patterns, Claude Code integration, and
> alternative terminal approaches.

---

## Group A — Terminal/PTY Patterns (Most Relevant to Aegis Core)

---

### 1. MadAppGang/tmux-mcp — Native Process Detection, 20 Tools

**Repository:** https://github.com/MadAppGang/tmux-mcp
**License:** MIT
**Stack:** Go 1.21+, `mark3labs/mcp-go`, single 7MB binary
**Stars:** Rapidly growing

#### Architecture Overview

Two-layer tool architecture:

- **Layer 1 — Tmux Primitives (15 tools):** `list-sessions`, `list-windows`, `list-panes`, `create-session`, `create-window`, `split-pane`, `send-keys`, `execute-command`, `capture-pane`, `screenshot-pane`, `resize-pane`, `rename-session`, `kill-session`, `kill-window`, `kill-pane`, `create-headless`, `kill-headless-server`
- **Layer 2 — Agent Workflows (6 tools):** `start-and-watch`, `watch-pane`, `pane-state`, `run-in-repl`, `write-to-display`, `display-message`

Scope system via `--scope` flag: `agentic` (default, 6+13 tools), `primitives` (17 tools only), `all` (all 20).

#### Process State Detection (THE key differentiator)

`pane-state` and the `user_input` trigger use **OS-level process inspection** — NOT regex pattern matching on screen output.

**Linux:** Reads `/proc/<pid>/wchan`. When a process blocks in `n_tty_read`, the kernel writes that function name to wchan. Also checks `/proc/<pid>/syscall`: syscall number 0 (read) with file descriptor 0x0 (stdin) confirms the process is waiting for terminal input.

**macOS:** Uses `sysctl kern.proc.pid` to fetch `kinfo_proc`. Two signals combined:
- Kernel wait message field (`Wmesg == "ttyin"`)
- Structural check — when the terminal foreground process group ID equals the shell's own process group and the shell is in interruptible sleep

Both platforms identify the **foreground process** by scanning the **terminal foreground process group (TPGID)**, not just the pane's shell PID.

**Response format:**
```json
{
  "panePid": 8421,
  "foregroundPid": 8456,
  "foregroundCmd": "sudo",
  "isAlive": true,
  "waitingForInput": true,
  "exitCode": null
}
```

#### Synchronous execute-command

Wraps commands with `tee` and `tmux wait-for` so it **blocks synchronously** until the command finishes. No polling loop needed. Exit code accurately reflects the original command even through pipelines.

```bash
# Shell-specific exit code expressions:
bash: ${PIPESTATUS[0]}
zsh:  ${pipestatus[1]}
fish: $status captured before the pipe
```

#### Smart Trigger System (start-and-watch / watch-pane)

Blocking tools that monitor panes until a trigger fires, then return the result directly.

**Modes (poll intervals):**
| Mode | Poll | Notify after |
|------|------|-------------|
| quick | 500ms | 1s elapsed or 10 new lines |
| medium | 1s | 5s elapsed or 40 new lines |
| slow | 2s | 30s elapsed or 100 new lines |
| line | 200ms | every new line |
| bunch | 500ms | every 10 new lines |
| screen | 1s | every 40 new lines |

**Triggers:**
| Trigger | Fires when |
|---------|-----------|
| `exit` | Foreground process exits |
| `shell` | Terminal foreground command returns to interactive shell |
| `user_input` | OS kernel reports foreground process blocked reading from tty |
| `error` | New output matches `error:` |
| `bell` | tmux window bell flag set |
| `idle:N` | No new output for N seconds |
| `pattern:REGEX` | New output line matches regex |

**WatchResult:**
```json
{
  "paneId": "%6",
  "event": "pattern:Serving HTTP",
  "detail": "Ready — matched: Serving HTTP on port 8765",
  "elapsed": 2.14,
  "output": "Serving HTTP on port 8765 ...",
  "paneState": { "panePid": 12345, "foregroundPid": 12347, "foregroundCmd": "python3", "isAlive": true, "waitingForInput": false }
}
```

#### Headless Server

`create-headless` creates an **isolated tmux server** invisible to the user's `tmux ls`. Returns IDs prefixed with `"headless:"` that route all subsequent tool calls to the isolated server. One-shot headless execution: create session → run → destroy.

#### Channel Mode

`--channel` flag enables Claude Code channel mode — pushes tmux events as channel notifications.

#### Code Patterns Worth Copying for Aegis

1. **OS-level process state detection** — `/proc/<pid>/wchan` + `/proc/<pid>/syscall` on Linux. Aegis currently uses tmux; this pattern could supplement with definitive "waiting for input" detection without regex guessing.

2. **Synchronous command execution via `tmux wait-for`** — The `execute-command` tool uses `tee` + unique UUID wait channels. Aegis should consider this instead of polling.

3. **Trigger-based monitoring** — The `start-and-watch` / `watch-pane` pattern (block until trigger fires, return result) is exactly what Aegis needs for "wait until Claude Code outputs X".

4. **Zero-lookup chaining** — Every response includes structured JSON with all IDs. No separate lookup calls needed between operations.

5. **Headless tmux server** — Isolated sessions invisible to user. Perfect for Aegis's background Claude Code sessions.

6. **send-keys literal vs key names** — `literal=true` (text) vs `literal=false` (tmux key names like C-c). Fixes the common bug where C-c is sent as literal text.

7. **Scope system** — Different tool sets for different use cases. Aegis could expose different MCP tool sets based on client permissions.

#### Integration Feasibility: ★★★★★

| Aspect | Assessment |
|--------|-----------|
| Stack match | ⚠️ Go (Aegis is TypeScript) — must port patterns, not import |
| tmux approach | ✅ Same as Aegis — tmux panes |
| Process detection | ✅ `/proc` inspection is directly portable to Node.js via `fs.readFileSync` |
| Synchronous execution | ✅ `tmux wait-for` is shell-level, language-agnostic |
| Tool count | ✅ 20 well-designed tools |
| Claude Code integration | ✅ Channel mode support built-in |

**Verdict:** This is the **most important reference repo** for Aegis's tmux layer. Port the process detection, synchronous execution, and trigger system to TypeScript. The Go source (`main.go`) is clean and well-structured — straightforward to translate.

---

### 2. wehnsdaefflae/terminal-control-mcp — await_output + Regex Pattern Matching

**Repository:** https://github.com/wehnsdaefflae/terminal-control-mcp
**License:** MIT
**Stack:** Python, FastMCP, libtmux, FastAPI (web interface), xterm.js
**Tools:** 6 MCP tools

#### Architecture Overview

```
terminal-control-mcp/
├── src/terminal_control_mcp/
│   ├── main.py              # FastMCP server with 6 tools
│   ├── session_manager.py   # Session lifecycle management
│   ├── interactive_session.py # tmux/libtmux process control
│   ├── terminal_utils.py    # Terminal window management
│   ├── web_server.py        # FastAPI web interface
│   ├── security.py          # Multi-layer security validation
│   ├── config.py            # TOML configuration
│   └── models.py            # Pydantic request/response models
```

#### The 6 MCP Tools

| Tool | Purpose | Key Innovation |
|------|---------|---------------|
| `open_terminal` | Create session with shell, cwd, env | Idempotent creation |
| `get_screen_content` | Read terminal output | 4 content modes |
| `send_input` | Send text + escape sequences | No auto-newline (agent-controlled) |
| `await_output` | Wait for regex in output | The killer feature |
| `list_terminal_sessions` | Show all sessions | Status + timestamps |
| `exit_terminal` | Destroy session | Bidirectional cleanup |

#### await_output — The Key Feature

`await_output(session_id, pattern, timeout)` polls every 100ms for a regex match in terminal output. Returns:

```python
{
    "match_text": "Build successful",    # The matched text (null if timeout)
    "screen_content": "...",             # Screen at match/timeout
    "elapsed_time": 3.14,               # Seconds waited
    "success": True                      # Whether operation completed
}
```

**Use cases from the README:**
- `await_output(session_id, r"Build successful|BUILD SUCCESS", 300.0)` — wait for build
- `await_output(session_id, r"ERROR|FAILED|Exception", 30.0)` — monitor for errors
- `await_output(session_id, r"\$\s*$|>\s*$", 5.0)` — detect prompt return
- `await_output(session_id, r"Server running on|Listening on", 60.0)` — wait for startup

#### Content Modes (get_screen_content)

- `"screen"` — Current visible screen only (default)
- `"since_input"` — Output since last `send_input` call (tracks `last_input_timestamp`)
- `"history"` — Full terminal history
- `"tail"` — Last N lines

The `"since_input"` mode is clever — it tracks when input was last sent and captures everything after that point. This is exactly what Aegis needs to extract Claude Code's response to a specific prompt.

#### Terminal Output Capture

Uses `tmux pipe-pane -o "cat > /tmp/tmux_stream_{session_id}.log"` for raw stream capture. Falls back to `capture-pane` if pipe-pane fails.

#### Security System

Multi-layer with configurable levels:
- **off:** No validation
- **low:** Basic input validation
- **medium:** Blocks common dangerous commands (rm -rf /, sudo, dd)
- **high:** Full protection (comprehensive validation + filtering)

Rate limiting: 60 calls/minute, max 50 concurrent sessions.

#### History Isolation

Each session gets isolated history files in temp directories. Supports bash, zsh, fish, Python REPL, Node.js REPL, PostgreSQL, MySQL. History files cleaned up on session termination.

#### Web Interface

Optional FastAPI + xterm.js web interface. Real-time terminal display via WebSocket. Agent and user can interact simultaneously without interfering.

#### Code Patterns Worth Copying for Aegis

1. **`since_input` content mode** — Track last input timestamp, capture everything after. Perfect for extracting Claude Code responses.

2. **`await_output` regex polling** — Simple but effective. 100ms polling interval. Port directly to TypeScript with `setInterval` + `capture-pane`.

3. **pipe-pane for raw output capture** — More reliable than `capture-pane` for streaming. Aegis could use this for real-time JSONL parsing.

4. **Bidirectional cleanup** — Sessions die when agent calls `exit_terminal` OR when user types `exit`. Dead sessions auto-detected every 5 seconds.

5. **History isolation** — Prevents Claude Code sessions from polluting system shell history. Aegis should implement this.

6. **Security layering** — Configurable security levels. Aegis needs something similar for multi-tenant safety.

#### Integration Feasibility: ★★★★☆

| Aspect | Assessment |
|--------|-----------|
| Stack match | ⚠️ Python (Aegis is TypeScript) — patterns portable, code not |
| tmux approach | ✅ Same as Aegis — libtmux wraps tmux CLI |
| await_output | ✅ Trivially portable to TypeScript |
| Content modes | ✅ `since_input` pattern directly applicable |
| Security | ✅ Pattern worth adopting |
| Web interface | ⚠️ Aegis has its own dashboard (Daedalus territory) |

**Verdict:** The `await_output` and `since_input` patterns are directly useful. The overall architecture is solid but Python-specific. Port the patterns, not the code.

---

### 3. DaniAkash/agent-terminal — MOD System + PTY Subscription

**Repository:** https://github.com/DaniAkash/agent-terminal
**License:** MIT
**Stack:** Rust (Tauri v2) + TypeScript + React + xterm.js + portable-pty
**Platform:** macOS only (currently)

#### Architecture Overview

A native macOS terminal app built around AI coding agents. Project-scoped workspaces, live process metrics, native Claude Code + Codex detection.

**Key files:**
```
src-tauri/src/
├── pty_manager.rs        # PTY lifecycle, reader thread, reconnection
├── shell_integration.rs  # OSC 7/133 injection scripts
├── mod_engine/           # MOD plugin system
├── commands.rs           # Tauri IPC commands
├── lib.rs
└── main.rs
```

#### MOD System — The Intelligence Layer

The MOD system is a **Rust-native plugin architecture** where each MOD:
1. Subscribes to PTY output bytes
2. Parses shell hook events (OSC 7, OSC 133)
3. Extracts structured data
4. Emits it to the frontend via Tauri channels

**Available MODs:**

| MOD | What it does | Hook events used |
|-----|-------------|-----------------|
| `DirTrackerMod` | Tracks CWD | OSC 7 (file:// URI on every prompt) |
| `ProcessTrackerMod` | Tracks running/done/error state | OSC 133 (shell marks: A=prompt, B=preexec, D=exit) |
| `ClaudeCodeMod` | Detects CC sessions, extracts --model, permission flags | Command line parsing from PTY output |
| `CodexMod` | Detects Codex sessions, extracts permission flags | Command line parsing |
| `ProcessInspectorMod` | Polls PID, RSS memory, elapsed time, TCP ports | `/proc` inspection (periodic) |
| `GitMonitorMod` | Tracks branch, dirty state, remote sync | Git CLI (periodic) |

#### Shell Integration (OSC 7 + OSC 133)

**Zsh** — via ZDOTDIR redirect:
```zsh
export ZDOTDIR_ORIG="${ZDOTDIR_ORIG:-$HOME}"
[[ -f "$ZDOTDIR_ORIG/.zshrc" ]] && source "$ZDOTDIR_ORIG/.zshrc"

# OSC 7 — emit cwd on every prompt
_at_osc7() { printf '\033]7;file://%s%s\007' "${HOST:-localhost}" "$PWD"; }

# OSC 133 — shell integration marks
_at_osc133_exit() { printf '\033]133;D;%s\007' "$?"; }
_at_osc133_prompt() { printf '\033]133;A\007'; }
_at_osc133_preexec() { printf '\033]133;B\007'; }

precmd_functions=(_at_osc133_exit _at_osc7 _at_osc133_prompt ${precmd_functions[@]})
preexec_functions=(_at_osc133_preexec ${preexec_functions[@]})
```

**Bash** — via `--init-file` + `PROMPT_COMMAND` + `trap DEBUG`:
```bash
PROMPT_COMMAND="_at_osc133_exit; _at_osc7; _at_osc133_prompt${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
trap '_at_osc133_preexec' DEBUG
```

**OSC 133 Protocol:**
| Code | Meaning | When |
|------|---------|------|
| `133;A` | Prompt started (line marker) | precmd |
| `133;B` | Command started (block open) | preexec |
| `133;C` | Command output started (block body) | Not used here |
| `133;D;<exitcode>` | Command finished (block close) | precmd (with exit code) |

#### PTY Manager Architecture

**Self-healing reader thread:**
- Dedicated reader thread per tab, 256KB buffer
- When WebView disconnects: reader clears channel, keeps reading, discards output
- When WebView reconnects: `try_reattach()` swaps in new channel
- Reader thread NEVER exits unless PTY EOF (child process died)
- MODs receive output even when WebView is disconnected (keeps state current)

**Reconnection protocol:**
```
try_reattach() checks:
1. PtyMap entry exists? → NotFound → spawn fresh
2. Child exited (try_wait)? → Expired → remove + spawn fresh
3. Reader alive? → ChannelUpdated → swap channel, done
4. Reader dead but child alive? → Reattached → spawn new reader on same master fd
```

**Known limitations (documented):**
- No output replay between disconnect/reconnect
- Mid-session channel drops not detected (no heartbeat)
- Full-app crash loses all PTY sessions (no pty-host daemon)

#### Code Patterns Worth Copying for Aegis

1. **OSC 133 shell integration** — Aegis injects shell hooks into Claude Code sessions. OSC 133 provides definitive command start/end markers without regex. This is superior to `since_input` timestamp tracking.

2. **MOD pattern (subscribe to PTY output, parse, emit structured data)** — Aegis needs this for Claude Code JSONL parsing. Subscribe to PTY stdout, parse JSONL lines, emit typed events.

3. **Self-healing reconnection** — Channel swap without thread restart. Relevant if Aegis adds WebSocket streaming to its HTTP API.

4. **ClaudeCodeMod / CodexMod pattern** — Detect agent from PTY output (command line args), extract model and permission flags. Aegis already knows this, but the pattern of detecting from raw PTY is useful for generic agent support.

5. **portable-pty direct usage** — No tmux dependency. Simpler architecture. Aegis could consider this for future "tmuxless" mode.

#### Integration Feasibility: ★★★☆☆

| Aspect | Assessment |
|--------|-----------|
| Stack match | ⚠️ Rust + Tauri (desktop app, not server) |
| PTY approach | ⚠️ portable-pty directly (no tmux) — different from Aegis |
| OSC 133 | ✅ Shell scripts are language-agnostic — copy directly |
| MOD pattern | ✅ Architecture pattern worth adopting |
| Platform | ❌ macOS only |

**Verdict:** The **OSC 133 shell integration scripts** are directly copyable and would improve Aegis's command boundary detection. The **MOD pattern** (subscribe → parse → emit) is the right architecture for Claude Code JSONL parsing. The Rust/Tauri stack is not directly portable.

---

## Group B — Claude Code Integration Patterns

---

### 4. banteg/takopi — Claude Code JSONL Stream Events (CRITICAL)

**Repository:** https://github.com/banteg/takopi
**License:** MIT
**Stack:** Python, msgspec, asyncio, Telegram Bot API

#### This Is THE Reference for Claude Code's `--output-format stream-json`

Takopi contains the **most complete, battle-tested Claude Code JSONL parser** found in any open-source project. Its schema definitions in `src/takopi/schemas/claude.py` are the gold standard.

#### Claude Code JSONL Event Types

**Stream Messages (data flow):**

| Type | Key Fields | Purpose |
|------|-----------|---------|
| `"system"` | `subtype`, `session_id`, `cwd`, `tools`, `model`, `permissionMode`, `mcp_servers` | Session init — contains `session_id` for resume |
| `"assistant"` | `message: { role, content[], model }`, `parent_tool_use_id` | Claude's turn — `text`, `thinking`, `tool_use` blocks |
| `"user"` | `message: { role, content[] }`, `parent_tool_use_id` | Claude's synthetic user turn — `tool_result` blocks |
| `"result"` | `session_id`, `is_error`, `duration_ms`, `duration_api_ms`, `num_turns`, `total_cost_usd`, `usage`, `result` | **Final result** — session complete |
| `"stream_event"` | `uuid`, `session_id`, `event: dict`, `parent_tool_use_id` | Internal stream events (subagent lifecycle) |

**Control Messages (bidirectional):**

| Type | Key Fields | Purpose |
|------|-----------|---------|
| `"control_request"` | `request_id`, `request: ControlRequest` | CC asks for permission, hooks, MCP messages |
| `"control_response"` | `response: ControlResponse` | Your response to control requests |
| `"control_cancel_request"` | `request_id` | Cancel a pending control request |

**Control Request Subtypes:**

| Subtype | Fields | Purpose |
|---------|--------|---------|
| `"interrupt"` | — | CC needs user input |
| `"can_use_tool"` | `tool_name`, `input`, `permission_suggestions`, `blocked_path` | **Permission dialog** |
| `"initialize"` | `hooks` | CC sends hooks config at startup |
| `"set_permission_mode"` | `mode` | Permission mode change notification |
| `"hook_callback"` | `callback_id`, `input`, `tool_use_id` | Hook execution callback |
| `"mcp_message"` | `server_name`, `message` | MCP server communication |
| `"rewind_files"` | `user_message_id` | File rewind after undo |

**Content Block Types (inside messages):**

| Type | Fields |
|------|--------|
| `"text"` | `text: str` |
| `"thinking"` | `thinking: str`, `signature: str` |
| `"tool_use"` | `id: str`, `name: str`, `input: dict` |
| `"tool_result"` | `tool_use_id: str`, `content: str|list|None`, `is_error: bool|None` |

#### How Takopi Invokes Claude Code

```python
args = ["-p", "--output-format", "stream-json", "--verbose"]
if resume: args.extend(["--resume", resume.value])
if model: args.extend(["--model", model])
if allowed_tools: args.extend(["--allowedTools", allowed_tools])
if dangerously_skip_permissions: args.append("--dangerously-skip-permissions")
args.extend(["--", prompt])
```

**Critical flags for Aegis:**
- `-p` — pipe mode (non-interactive)
- `--output-format stream-json` — JSONL on stdout
- `--verbose` — includes thinking blocks
- `--resume <session_id>` — resume existing session
- `--dangerously-skip-permissions` — auto-approve all tools
- `--allowedTools` — restrict available tools

#### JSONL Parsing Architecture

```python
@dataclass
class ClaudeStreamState:
    factory: EventFactory
    pending_actions: dict[str, Action]  # tool_use_id → Action
    last_assistant_text: str | None    # fallback answer
    note_seq: int                       # monotonic counter
```

1. Spawn subprocess with stdin/stdout/stderr pipes
2. Iterate stdout line-by-line
3. Decode via msgspec (tagged unions on `type` field)
4. Translate to normalized events
5. Track state: pending tool actions, session ID, completion flag
6. Handle edge cases: invalid JSON (skip), decode errors (skip), post-completion lines (drop)

**Tool result matching:** `pending_actions` dict maps `tool_use_id` → Action. CC sends `tool_use` in assistant message, `tool_result` comes later in user message. Must correlate by ID.

#### Tool Classification

| Tool Name | Action Kind |
|-----------|-------------|
| `Bash`, `Shell`, `KillShell` | `command` |
| `Edit`, `Write`, `NotebookEdit`, `MultiEdit` | `file_change` |
| `Read` | `tool` |
| `Glob` | `tool` |
| `Grep` | `tool` |
| `WebSearch`, `WebFetch` | `web_search` |
| `Task`, `Agent` | `subagent` |

#### Integration Feasibility: ★★★★★ (CRITICAL REFERENCE)

**This is the single most important reference for Aegis' JSONL parsing.**

1. **TypeScript equivalent needed:** Port `schemas/claude.py` to Zod discriminated unions
2. **Control protocol:** Aegis MUST implement `control_request` / `control_response` for `can_use_tool`, `interrupt`, `hook_callback`, `mcp_message`
3. **Session lifecycle:** Track `session_id` from `system` init, use for resume
4. **Tool result matching:** `pending_actions` dict pattern is essential
5. **Stdin/stdout:** Claude Code reads nothing from stdin in `-p` mode — output is pure JSONL on stdout

---

### 5. helix-codex — MCP Bridge Claude→Codex with JSONL Parsing

*(Subagent research was truncated — partial analysis from README available)*

**Repository:** https://github.com/helix-codex
**Stack:** TypeScript

#### Key Patterns

- MCP bridge that translates between Claude Code and OpenAI Codex CLI
- JSONL parsing approach similar to takopi but in TypeScript
- Translates Claude Code's streaming events into Codex-compatible format
- Session management with resume support

#### Integration Feasibility: ★★★★☆

TypeScript stack makes this directly relevant. The JSONL parsing TypeScript implementation could be used as a reference for Aegis's own parser. Worth reading the source files for the TypeScript JSONL parsing patterns specifically.

---

### 6. FlorianBruniaux/claude-code-ultimate-guide/examples/hooks — PreToolUse/PostToolUse Hooks

*(Subagent research was truncated — partial analysis from README available)*

**Repository:** https://github.com/FlorianBruniaux/claude-code-ultimate-guide
**Stack:** Documentation + examples

#### Key Hook Patterns

Claude Code supports hooks in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "echo 'about to run bash'" }]
    }],
    "PostToolUse": [{
      "matcher": "Write",
      "hooks": [{ "type": "command", "command": "npm run lint" }]
    }]
  }
}
```

**Hook event types:**
- `Stop` — Session ends
- `SubagentStop` — Sub-agent completes
- `UserPromptSubmit` — User submits a prompt
- `PreToolUse` — Before a tool is called (matcher filters by tool name)
- `PostToolUse` — After a tool returns

#### Integration Feasibility: ★★★★☆

Hooks are directly relevant to Aegis. Aegis could:
1. Inject hook configuration into Claude Code sessions
2. Use PostToolUse hooks to trigger Aegis-specific actions (logging, validation)
3. Use PreToolUse hooks for permission management

---

### 7. anthropics/claude-code issue #6305 — PostToolUse Hooks Bug

**Repository:** https://github.com/anthropics/claude-code/issues/6305

#### The Bug

**PreToolUse and PostToolUse hooks never execute**, while other hook types work correctly.

**Environment:** Claude Code `claude-sonnet-4-20250514`, macOS Darwin 24.6.0

**Evidence:**
- ✅ WORKING: `Stop`, `SubagentStop`, `UserPromptSubmit` hooks
- ❌ BROKEN: `PreToolUse`, `PostToolUse` hooks

**Configuration tested:**
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "echo 'PreToolUse triggered' >> /tmp/pretool-test.log" }]
    }],
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "cat /path/to/.claude/commands/aw.md" }]
    }]
  }
}
```

**Testing performed:** Multiple matchers (`*`, `Bash`, `Task`, `Write`, `Edit`), simple and complex commands, JSON input parsing with jq, file permissions, absolute paths, fresh tests after clearing logs.

**Conclusion:** Selective hook system failure affecting only tool-related events. Other hook types function correctly with identical configuration patterns.

#### Impact on Aegis

**CRITICAL:** If Aegis relies on PreToolUse/PostToolUse hooks for permission management or action triggering, this bug will break that functionality. Aegis should:

1. **Monitor this issue** for resolution
2. **Implement fallback:** Use the `control_request` / `control_response` protocol (from takopi analysis) instead of hooks for permission handling
3. **Workaround:** Use `--output-format stream-json` and parse `tool_use` / `tool_result` blocks directly from JSONL output instead of relying on hooks
4. **Test hook functionality** in the specific Claude Code version before relying on it

---

## Group C — Alternative Terminal Approaches

---

### 8. parkerhancock/dev-terminal — Native PTY with WebSocket Streaming

**Repository:** https://github.com/parkerhancock/dev-terminal
**License:** MIT
**Stack:** TypeScript, Express, node-pty, ssh2, ws, ansi_up
**File count:** ~330 lines across 4 source files

#### Architecture Overview

Persistent PTY session manager exposed via HTTP API + WebSocket streaming. "Dev-browser" pattern by Sawyer Hood — persistent resources accessible across multiple AI scripts.

**Key files:**
- `src/index.ts` — Express + WebSocket server, terminal registry, HTTP endpoints
- `src/backend.ts` — PTY backend abstraction (`LocalPtyBackend` via node-pty, `SshPtyBackend` via ssh2)
- `src/client.ts` — HTTP client SDK with `waitForText()`, `waitForExit()`
- `src/types.ts` — Shared TypeScript types + `SpecialKeys` escape sequence map

#### Backend Abstraction Pattern

```typescript
interface TerminalBackend {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (exitCode: number) => void): void;
  pid: number;
}
```

Two implementations: `LocalPtyBackend` (node-pty) and `SshPtyBackend` (ssh2 with async factory pattern).

#### WebSocket Protocol

**Server → Client:**
```typescript
broadcast({ type: "data", name, data });      // PTY output
broadcast({ type: "created", name, size });   // New terminal
broadcast({ type: "closed", name, exitCode });// Terminal died
broadcast({ type: "resized", name, size });  // Terminal resized
```

**Client → Server:**
```typescript
{ type: "input", name: "my-app", data: "ls -la\r" }
```

**Connection lifecycle:** On connect → server sends full terminal list + buffered content. On disconnect → client removed, terminals persist.

#### LLM-Friendly Features

**Snapshot system:** `text` (ANSI stripped), `raw` (raw ANSI), `lines` (last `rows*3`), `svg` (ANSI → HTML → SVG via ansi_up for LLM vision).

**Wait primitives:**
```typescript
async waitForText(text: string, options?: WaitOptions): Promise<boolean>
async waitForExit(options?: WaitOptions): Promise<number | undefined>
```
Both poll at 100ms intervals, 30s default timeout.

#### Code Patterns Worth Copying

1. **`TerminalBackend` interface** — Clean abstraction for PTY interaction. Aegis could wrap tmux behind this interface.
2. **Idempotent terminal creation** — POST returns existing terminal if name matches. Eliminates race conditions.
3. **SVG snapshot for LLM vision** — ANSI → HTML → SVG pipeline. Could supplement Aegis's text output with visual terminal snapshots.
4. **`SpecialKeys` as const object** — Type-safe escape sequence mapping with 30+ key definitions.
5. **Buffer trimming** — Ring buffer preventing memory leaks on long-running sessions.

#### Integration Feasibility: ★★★☆☆

| Aspect | Assessment |
|--------|-----------|
| Stack match | ✅ TypeScript — perfect match |
| PTY approach | ⚠️ node-pty direct; Aegis uses tmux |
| Session model | ⚠️ In-memory Map; Aegis needs durability |
| WebSocket | ✅ Could complement Aegis HTTP API |
| MCP support | ❌ None |

**Verdict:** The `TerminalBackend` interface and SVG snapshot pipeline are the most valuable patterns. ~330 lines, clean but minimal. Good TypeScript reference.

---

### 9. AuraFriday/terminal_mcp — 20+ Protocols, Atomic Execution

**Repository:** https://github.com/AuraFriday/terminal_mcp
**License:** Apache 2.0
**Stack:** Python, `easy_mcp`, pyserial, paramiko, bleak, pybluez, zeroconf, pywinpty
**File count:** 1 monolithic file (~11,000+ lines)

#### Architecture Overview

A single MCP tool called `terminal` that handles every operation through a dispatch table. Designed for the MCP-Link ecosystem. Supports 20+ transport protocols.

**Transport hierarchy (BaseTransport → concrete):**
Serial, TCP, Telnet, RFC2217, SSH, Bluetooth (BLE + Classic), WebSocket, HTTP, USB, CAN bus, MQTT, ZeroConf discovery, TLS wrapping, IPv6, and more.

#### Atomic Execution

The "atomic execution" concept means: the MCP tool bundles connect + command + disconnect into a single atomic operation. The agent doesn't need separate connect/send/disconnect calls. This reduces the number of round-trips and eliminates state management burden.

**Pattern:**
```python
# Single atomic call:
terminal(protocol="ssh", host="192.168.1.1", command="ls -la", atomic=True)
# Internally: connect → send command → capture output → disconnect → return
```

#### Code Patterns Worth Copying

1. **Atomic execution pattern** — Bundle lifecycle operations into single calls. Aegis could do this for "run command in Claude Code session and wait for result."
2. **Transport abstraction** — BaseTransport interface with 20+ implementations. Good pattern for Aegis if it ever needs multi-protocol support.
3. **Dispatch table pattern** — Single entry point, route to handler based on parameters.

#### Integration Feasibility: ★★☆☆☆

| Aspect | Assessment |
|--------|-----------|
| Stack match | ❌ Python, monolithic 11K line file |
| Relevance | ⚠️ Protocol diversity is interesting but not Aegis's use case |
| Atomic execution | ✅ Pattern worth adopting |
| Code quality | ❌ Monolithic, no tests, Apache 2.0 with proprietary note |

**Verdict:** The atomic execution concept is the main takeaway. The codebase is not suitable for direct reference — too monolithic and Python-only.

---

### 10. Infraware-dev/terminal — NOT FOUND

**Repository:** https://github.com/Infraware-dev/terminal — returns 404
**Alternative URLs tried:** `https://github.com/Infraware/terminal` — also 404

This repository either doesn't exist, has been renamed, or is private. Unable to analyze.

---

## Cross-Cutting Analysis: Patterns for Aegis

### Priority 1 — Implement Now

| Pattern | Source | What to do |
|---------|--------|-----------|
| JSONL stream parsing | takopi (repo 4) | Port schemas/claude.py to Zod discriminated unions in TypeScript |
| Control request/response protocol | takopi (repo 4) | Implement `can_use_tool`, `interrupt`, `hook_callback` handling |
| OS-level process state detection | tmux-mcp (repo 1) | Port `/proc/<pid>/wchan` + `/proc/<pid>/syscall` to Node.js |
| Synchronous command execution | tmux-mcp (repo 1) | Use `tmux wait-for` + UUID channels |
| Trigger-based monitoring | tmux-mcp (repo 1) | Block until regex/exit/shell/user_input trigger fires |
| OSC 133 shell integration | agent-terminal (repo 3) | Inject shell integration for definitive command boundaries |

### Priority 2 — Implement Soon

| Pattern | Source | What to do |
|---------|--------|-----------|
| `since_input` content mode | terminal-control-mcp (repo 2) | Track last input timestamp, capture output after |
| `await_output` regex polling | terminal-control-mcp (repo 2) | 100ms polling for regex match in terminal output |
| Headless tmux server | tmux-mcp (repo 1) | Isolated sessions invisible to user |
| TerminalBackend interface | dev-terminal (repo 8) | Abstract tmux behind clean interface |
| Atomic execution | terminal_mcp (repo 9) | Bundle lifecycle into single calls |

### Priority 3 — Monitor/Investigate

| Pattern | Source | What to do |
|---------|--------|-----------|
| PreToolUse/PostToolUse bug | claude-code #6305 (repo 7) | Don't rely on hooks; use JSONL parsing instead |
| SVG terminal snapshots | dev-terminal (repo 8) | Future: LLM vision for terminal output |
| MOD plugin system | agent-terminal (repo 3) | Future: extensible session intelligence |
| Channel mode (Claude Code) | tmux-mcp (repo 1) | Future: push-based event delivery |
| History isolation | terminal-control-mcp (repo 2) | Prevent session history pollution |

### Known Bugs to Track

1. **claude-code #6305** — PreToolUse/PostToolUse hooks don't fire. Aegis should use JSONL `tool_use`/`tool_result` parsing as the primary mechanism for tool event detection, not hooks.

---

*Analysis generated: 2026-04-26T18:33 CEST by Hephaestus*
*For Aegis development reference — OneStepAt4time/aegis*
