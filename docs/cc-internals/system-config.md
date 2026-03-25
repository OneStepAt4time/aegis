# Claude Code Internals: System Prompt, Configuration & Subagent Architecture

> **Version Analyzed:** 2.1.81 (Build: 2026-03-20T21:26:18Z)
> **Package:** `@anthropic-ai/claude-code`
> **Source:** Minified/obfuscated bundle analysis

---

## Table of Contents

1. [System Prompt Architecture](#1-system-prompt-architecture)
2. [Subagent Instructions](#2-subagent-instructions)
3. [Settings System](#3-settings-system)
4. [Permission Mode Configuration](#4-permission-mode-configuration)
5. [Environment Variables](#5-environment-variables)
6. [Model Configuration](#6-model-configuration)
7. [MCP Server Configuration](#7-mcp-server-configuration)
8. [Identity Strings](#8-identity-strings)

---

## 1. System Prompt Architecture

### How It's Assembled

The CC system prompt is **not a single static string** — it's assembled dynamically from multiple sections concatenated in order. The main function (`J58`) builds the **Environment section**, while other functions contribute additional sections.

### Core Identity Strings

Three identity strings exist for different contexts:

| Constant | Value | Context |
|----------|-------|---------|
| `DXA` | `"You are Claude Code, Anthropic's official CLI for Claude."` | Standard CLI |
| `LyD` | `"You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."` | Agent SDK |
| `DyD` | `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` | Agent SDK (standalone agent) |

All three are collected into `a71` array and stored in `qY$` (Set). The system checks the identity string against this set.

### Prompt Hash / Integrity

CC generates a 3-character SHA-256 hash from:
- The first user message content (first 3 chars at positions 4, 7, 20)
- A static salt: `"59cf53e54c78"`
- The VERSION string

This hash (`_yD`) is used for **prompt integrity verification** and potentially for caching/tracking.

### Environment Section (`J58`)

The environment section is structured as:

```
# Environment
You have been invoked in the following environment:
- Primary working directory: /path/to/cwd
- This is a git worktree — ... (conditional)
- Is a git repository: Yes/No
- Additional working directories: ... (conditional)
- Platform: linux/darwin/win32
- Shell: bash/zsh (or powershell on win32)
- OS Version: Linux 6.17.0-19-generic (or Windows equivalent)
- You are powered by the model named Claude Opus 4.6. The exact model ID is claude-opus-4-6.
- Assistant knowledge cutoff is May 2025. (model-dependent)
- The most recent Claude model family is Claude 4.5/4.6. Model IDs — Opus 4.6: 'claude-opus-4-6', Sonnet 4.6: 'claude-sonnet-4-6', Haiku 4.5: 'claude-haiku-4-5-20251001'.

<fast_mode_info>
Fast mode for Claude Code uses the same Claude Opus 4.6 model with faster output.
It does NOT switch to a different model. It can be toggled with /fast.
</fast_mode_info>
```

**Knowledge cutoff by model:**

| Model Pattern | Cutoff |
|---------------|--------|
| `claude-sonnet-4-6` | August 2025 |
| `claude-opus-4-6` | May 2025 |
| `claude-opus-4-5` | May 2025 |
| `claude-haiku-4*` | February 2025 |
| `claude-opus-4` / `claude-sonnet-4` | January 2025 |

### Additional Sections

#### Agent Notes (`kFH`)
Appended to the system prompt for agent threads:
```
Notes:
- Agent threads always have their cwd reset between bash calls, as a result please only use absolute file paths.
- In your final response, share file paths (always absolute, never relative) that are relevant to the task.
- For clear communication with the user the assistant MUST avoid using emojis.
- Do not use a colon before tool calls.
```

#### Scratchpad Directory (`co1`)
Conditional section (when `AGH()` returns true):
```
# Scratchpad Directory
IMPORTANT: Always use this scratchpad directory for temporary files instead of /tmp:
`<scratchpad_path>`
```

#### Brief Proactive Section (`no1`)
Conditional section controlled by `vo1?.isBriefEnabled()`.

#### Dynamic Boundary Marker
- `wMH = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"` — A sentinel string used to mark where dynamic/variable content ends in the prompt.

---

## 2. Subagent Instructions

### General-Purpose Subagent (`ZB` / `oo1`)

The main subagent system prompt is constructed by `oo1()`:

```
You are an agent for Claude Code, Anthropic's official CLI for Claude.
Given the user's message, you should use the tools available to complete the task.
Do what has been asked; nothing more, nothing less.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives.
  Use Read when you know the specific file path.
- For analysis: Start broad and narrow down.
- Be thorough: Check multiple locations, consider different naming conventions.
- NEVER create files unless they're absolutely necessary.
  ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files.
  Only create documentation files if explicitly requested.

- In your final response, share file paths (always absolute, never relative)
  that are relevant to the task.
- For clear communication, avoid using emojis.
```

**Key configuration:**
- `agentType: "general-purpose"`
- `tools: ["*"]` — All tools available
- `source: "built-in"`
- No model override (inherits from parent)
- `baseDir: "built-in"`

The "tight weave" feature flag (`tengu_tight_weave`) controls whether the response format is concise or detailed:
- **Enabled (default):** "respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials."
- **Disabled:** "respond with a detailed writeup."

### Constant Subagent Prompt (`T58`)

```
You are an agent for Claude Code, Anthropic's official CLI for Claude.
Given the user's message, you should use the tools available to complete the task.
Do what has been asked; nothing more, nothing less.
When you complete the task, respond with a concise report covering what was done
and any key findings — the caller will relay this to the user, so it only needs the essentials.
```

### Built-in Agent Types

#### Plan Agent (`YE$` / `ao1`)
- **Purpose:** Software architect/planning specialist
- **CRITICAL constraint:** READ-ONLY mode — absolutely no file modifications
- **Model:** `"inherit"` (same as parent)
- **Disallowed tools:** Write, Edit, Bash, MultiEdit, NotebookEdit
- **Output requirement:** Must end with "### Critical Files for Implementation" listing 3-5 files
- **Key instruction:** `"CRITICAL: This is a READ-ONLY task. You CANNOT edit, write, or create files."`

#### Statusline Setup Agent (`k58`)
- **Purpose:** Configure user's statusLine setting
- **Tools:** `["Read", "Edit"]` only
- **Model:** `"sonnet"` (forced to Sonnet)
- **Color:** `"orange"` (for visual identification)
- Receives detailed JSON input via stdin (session_id, model, workspace, context_window, rate_limits, vim mode, agent info, worktree info)

#### Guide Agent (`so1`)
- **Purpose:** Help users understand Claude Code, Agent SDK, and Claude API
- **Documentation sources:** Claude Code docs URL (`to1`), Claude Agent SDK / API docs URL (`N58`)
- **Expertise domains:** Claude Code CLI, Agent SDK, Claude API (formerly Anthropic API)

### Agent Color System (`sX`)

Colors for subagent identification:
```javascript
mO = ["red","blue","green","yellow","purple","orange","pink","cyan"]
pO = {
  red: "red_FOR_SUBAGENTS_ONLY",
  blue: "blue_FOR_SUBAGENTS_ONLY",
  green: "green_FOR_SUBAGENTS_ONLY",
  yellow: "yellow_FOR_SUBAGENTS_ONLY",
  purple: "purple_FOR_SUBAGENTS_ONLY",
  orange: "orange_FOR_SUBAGENTS_ONLY",
  pink: "pink_FOR_SUBAGENTS_ONLY",
  cyan: "cyan_FOR_SUBAGENTS_ONLY"
}
```
Color values are postfixed with `_FOR_SUBAGENTS_ONLY` to prevent main agent from using them.

### Context Inheritance

Subagents inherit:
1. **Working directory** from parent (but CWD is reset between bash calls)
2. **Tool access** (may be restricted by agent type)
3. **Model** (can be overridden per-agent with `"model"` field)
4. **CLAUDE.md files** from the project/user directories

Subagents do NOT inherit:
- The parent's conversation history (only the task prompt)
- Permission grants from the parent session

---

## 3. Settings System

### Settings File Hierarchy (Priority Order)

Settings are loaded in this order, with later sources **merging/overriding** earlier ones:

| Priority | Source | File Path | Scope |
|----------|--------|-----------|-------|
| 1 (lowest) | `userSettings` | `~/.claude/settings.json` (or `cowork_settings.json` if cowork mode) | User-wide |
| 2 | `projectSettings` | `.claude/settings.json` (in project root) | Project/team |
| 3 | `localSettings` | `.claude/settings.local.json` (in project root, gitignored) | Local/user |
| 4 | `policySettings` | Managed settings (multiple sources, see below) | Enterprise |
| 5 (highest) | `flagSettings` | CLI flags / feature flags | Session |

**Special handling:** When `CLAUDE_CODE_USE_COWORK_PLUGINS` is set or `OVH()` returns true, user settings file becomes `cowork_settings.json` instead of `settings.json`.

### Policy Settings Sources (Priority Order)

The `policySettings` layer has its own fallback chain:

1. **Remote settings** (`rd()`) — fetched from remote endpoint, stored in `remote-settings.json`
2. **macOS MDM** (`BwH()`) — from plist (loaded via `Af$()`)
3. **Managed settings file** (`ejL()`) — `managed-settings.json` in Claude config dir
4. **Windows HKCU Registry** (`gwH()`) — `HKCU\SOFTWARE\Policies\ClaudeCode\Settings`

### Settings Merge Strategy

- **Arrays** for certain keys (permissions, sandbox, hooks) are **merged** (union) across sources
- **Other keys** follow standard merge (later source wins)
- **Special array merge keys:** `permissions.allow`, `permissions.deny`, `permissions.ask`, `sandbox.network`, `sandbox.hooks`, etc.

### Settings Schema (`Cj`)

The full Zod schema is defined in `Cj()`. Key top-level fields:

#### Core Settings
| Field | Type | Description |
|-------|------|-------------|
| `$schema` | string | JSON Schema reference URL |
| `apiKeyHelper` | string | Path to auth helper script |
| `awsCredentialExport` | string | Path to AWS credential export script |
| `awsAuthRefresh` | string | Path to AWS auth refresh script |
| `gcpAuthRefresh` | string | Command for GCP auth refresh |
| `env` | Record<string, string> | Environment variables for CC sessions |
| `permissions` | object | Permission configuration (see §4) |
| `model` | string | Override default model |
| `availableModels` | string[] | Model allowlist (family aliases, version prefixes, full IDs) |
| `modelOverrides` | Record<string, string> | Map Anthropic model IDs to provider-specific IDs |
| `hooks` | object | Pre/post tool execution hooks |
| `sandbox` | object | Sandbox configuration |
| `outputStyle` | string | Output style for responses |
| `language` | string | Preferred response language |
| `agent` | string | Default agent name for main thread |

#### MCP Settings
| Field | Type | Description |
|-------|------|-------------|
| `enableAllProjectMcpServers` | boolean | Auto-approve all project MCP servers |
| `enabledMcpjsonServers` | string[] | Approved MCP servers from .mcp.json |
| `disabledMcpjsonServers` | string[] | Rejected MCP servers from .mcp.json |
| `allowedMcpServers` | object[] | Enterprise allowlist (name/command/url) |
| `deniedMcpServers` | object[] | Enterprise denylist (takes precedence) |

#### Plugin Settings
| Field | Type | Description |
|-------|------|-------------|
| `enabledPlugins` | Record<string, boolean\|string[]> | Plugin enable map (`plugin@marketplace: true`) |
| `extraKnownMarketplaces` | Record<string, object> | Additional marketplace sources |
| `strictKnownMarketplaces` | object[] | Enterprise marketplace allowlist |
| `blockedMarketplaces` | object[] | Enterprise marketplace blocklist |

#### Memory Settings
| Field | Type | Description |
|-------|------|-------------|
| `autoMemoryEnabled` | boolean | Enable auto-memory (default: true) |
| `autoMemoryDirectory` | string | Custom memory directory path |
| `autoDreamEnabled` | boolean | Background memory consolidation |
| `cleanupPeriodDays` | number | Transcript retention days (default: 30, 0 = disabled) |

#### Thinking/Mode Settings
| Field | Type | Description |
|-------|------|-------------|
| `alwaysThinkingEnabled` | boolean | Enable thinking for supported models |
| `effortLevel` | `"low"` \| `"medium"` \| `"high"` | Persisted effort level |
| `fastMode` | boolean | Enable fast mode |
| `fastModePerSessionOptIn` | boolean | Don't persist fast mode across sessions |
| `autoMode` | object | Auto mode classifier customization |
| `disableAutoMode` | `"disable"` | Disable auto mode |

#### Enterprise/Admin Settings
| Field | Type | Description |
|-------|------|-------------|
| `forceLoginMethod` | `"claudeai"` \| `"console"` | Force specific login method |
| `forceLoginOrgUUID` | string | Force OAuth login org |
| `allowManagedPermissionRulesOnly` | boolean | Only managed permission rules |
| `allowManagedMcpServersOnly` | boolean | Only managed MCP allowlist |
| `allowManagedHooksOnly` | boolean | Only managed hooks |
| `strictPluginOnlyCustomization` | boolean \| string[] | Block non-plugin customization |
| `disableAllHooks` | boolean | Disable all hooks + statusLine |

---

## 4. Permission Mode Configuration

### Permission State (`vY`)

Default permission state:
```javascript
{
  mode: "default",
  additionalWorkingDirectories: new Map(),
  alwaysAllowRules: {},
  alwaysDenyRules: {},
  alwaysAskRules: {},
  isBypassPermissionsModeAvailable: false
}
```

### Permission Schema (`f69`)

```javascript
{
  allow: PermissionRule[],    // Always-allowed operations
  deny: PermissionRule[],     // Always-denied operations
  ask: PermissionRule[],      // Always-prompt operations
  defaultMode: "plan" | "autoEdit" | "bypassPermissions" | "default",
  disableBypassPermissionsMode: "disable",  // Prevent bypass mode
  disableAutoMode: "disable",               // Prevent auto mode
  additionalDirectories: string[]           // Extra dirs in permission scope
}
```

### How Permission Rules Work

1. **Deny rules** are evaluated first — if a tool call matches any deny rule, it's blocked
2. **Allow rules** are evaluated next — if a tool call matches any allow rule, it's allowed
3. **Ask rules** are evaluated — matching calls always prompt the user
4. **defaultMode** determines what happens for unmatched calls:
   - `"default"` — prompt the user
   - `"autoEdit"` — auto-approve edits, prompt for other operations
   - `"plan"` — auto-approve reads, prompt for writes
   - `"bypassPermissions"` — auto-approve everything (dangerous)

### Enterprise Permission Lock

When `allowManagedPermissionRulesOnly` is set in managed settings:
- Only permission rules from managed/policy settings are respected
- User, project, local, and CLI argument permission rules are **completely ignored**

### Subprocess Environment Scrubbing

When `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is set, these env vars are **stripped** from child processes:
```
ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN,
ANTHROPIC_FOUNDRY_API_KEY, ANTHROPIC_CUSTOM_HEADERS,
OTEL_EXPORTER_OTLP_HEADERS, OTEL_EXPORTER_OTLP_LOGS_HEADERS,
OTEL_EXPORTER_OTLP_METRICS_HEADERS, OTEL_EXPORTER_OTLP_TRACES_HEADERS,
AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_BEARER_TOKEN
```

### Safe Environment Variables (passed through)

```javascript
new Set([
  "GOEXPERIMENT", "GOOS", "GOARCH", "CGO_ENABLED", "GO111MODULE",
  "RUST_BACKTRACE", "RUST_LOG", "NODE_ENV",
  "PYTHONUNBUFFERED", "PYTHONDONTWRITEBYTECODE", "PYTEST_DISABLE_PLUGIN_AUTOLOAD",
  "PYTEST_DEBUG", "ANTHROPIC_API_KEY",  // ← Note: API key IS passed to subprocesses
  "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "LC_TIME",
  "CHARSET", "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR",
  "TZ", "LS_COLORS", "LSCOLORS", "GREP_COLOR", "GREP_COLORS",
  "GCC_COLORS", "TIME_STYLE", "BLOCK_SIZE", "BLOCKSIZE"
])
```

Plus any matching `^(LD_|DYLD_|PATH$)` pattern.

---

## 5. Environment Variables

### ANTHROPIC_* Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Primary API key for Anthropic API. Highest priority auth source in non-OAuth flows. Checked before OAuth tokens. Can be set via env or `apiKeyHelper` script. |
| `ANTHROPIC_AUTH_TOKEN` | Alternative auth token. Used when `!t3$()` (not in some restricted mode). Falls back after `ANTHROPIC_API_KEY`. |
| `ANTHROPIC_BASE_URL` | Custom API base URL. Default: `"https://api.anthropic.com"`. Used for proxy/self-hosted setups. |
| `ANTHROPIC_CUSTOM_HEADERS` | Custom HTTP headers for API requests. Scrubbed from subprocesses. |
| `ANTHROPIC_FOUNDRY_API_KEY` | API key for Foundry provider. Scrubbed from subprocesses. |
| `ANTHROPIC_UNIX_SOCKET` | Unix socket path for API communication. Stripped before env is passed to subprocesses (via `KvH`). |

### CLAUDE_CODE_* Variables

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token for claude.ai authentication. Alternative to API key. Required if `ANTHROPIC_API_KEY` is not set. |
| `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` | File descriptor pointing to an OAuth token. Read as alternative token source. |
| `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` | File descriptor pointing to an API key file. |
| `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | When set (any truthy value), sensitive env vars are stripped from child processes. |
| `CLAUDE_CODE_USE_BEDROCK` | When truthy, routes API calls through AWS Bedrock. Disables certain telemetry. |
| `CLAUDE_CODE_USE_VERTEX` | When truthy, routes API calls through Google Cloud Vertex AI. Disables certain telemetry. |
| `CLAUDE_CODE_USE_FOUNDRY` | When truthy, routes API calls through Anthropic Foundry. Disables certain telemetry. |
| `CLAUDE_CODE_USE_COWORK_PLUGINS` | When truthy, switches to cowork mode (uses `cowork_settings.json`). |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | When truthy, disables auto-memory. When `"true"` (string), forces off. |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disables non-essential network traffic (telemetry, etc.). |
| `CLAUDE_CODE_REMOTE` | When set, enables remote session mode. If set without `CLAUDE_CODE_REMOTE_MEMORY_DIR`, disables auto-memory. |
| `CLAUDE_CODE_REMOTE_MEMORY_DIR` | Custom memory directory path for remote sessions. |
| `CLAUDE_CODE_SIMPLE` | Simplified mode flag. When truthy, disables auto-memory. |

### Auth Resolution Chain

The API key resolution function (`I7`) follows this priority:

1. **Bedrock/Vertex/Foundry mode:** Check `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY` first
2. **Bedrock special case:** `ANTHROPIC_API_KEY` → `apiKeyHelper` → none
3. **General case:**
   a. `ANTHROPIC_API_KEY` (if not `L2()` restricted)
   b. If custom API key is approved → use it
   c. `apiKeyHelper` script output
   d. `wIH()` (other auth sources)
   e. Return `{key: null, source: "none"}`
4. **OAuth check:** `CLAUDE_CODE_OAUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`

### Plugin Option Env Vars

Plugin manifest `userConfig` keys become env vars in hooks:
- Format: `CLAUDE_PLUGIN_OPTION_<KEY>`
- Key validation: `/^[A-Za-z_]\w*$/` (letters, digits, underscore; no leading digit)
- Sensitive values go to secure storage (macOS keychain / `.credentials.json`)
- Non-sensitive values available in MCP/LSP server config, hook commands, and skill/agent content as `${user_config.KEY}`

---

## 6. Model Configuration

### Model Selection

**Default model name:** `"Claude Opus 4.6"` (stored in `No1`)

**Model ID constants:**
```javascript
sVA = {
  opus:   "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001"
}
```

### Model Override Paths

1. **Settings:** `model` field in any settings file (user → project → local → policy → flag)
2. **CLI:** `--model` flag
3. **Agent:** Per-agent `model` field (e.g., `"sonnet"`, `"inherit"`)
4. **Available models restriction:** `availableModels` array in managed settings
5. **Model ID mapping:** `modelOverrides` maps Anthropic IDs to provider-specific IDs (Bedrock ARNs, etc.)

### Fast Mode

- Fast mode uses the **same model** (Claude Opus 4.6) with **faster output**
- Does NOT switch to a different model
- Toggled with `/fast` command or `fastMode: true` in settings
- `fastModePerSessionOptIn: true` prevents persistence across sessions

### Model Display

The system prompt includes:
```
You are powered by the model named Claude Opus 4.6. The exact model ID is claude-opus-4-6.
```

The display name comes from `xF(modelId)` — if it returns a name, the prompt uses "powered by the model named X. The exact model ID is Y." format. Otherwise, just "powered by the model X."

---

## 7. MCP Server Configuration

### MCP Server Types

CC supports multiple MCP server transport types:

| Type | Schema Fields | Description |
|------|---------------|-------------|
| `stdio` | `command: string[]` | Local process via stdin/stdout |
| `sse-ide` | `url, ideName, ideRunningInWindows` | Server-Sent Events from IDE |
| `ws-ide` | `url, ideName, authToken` | WebSocket from IDE |
| `http` | `url, headers, headersHelper, oauth` | HTTP remote server |
| `ws` | `url, headers, headersHelper` | WebSocket remote server |
| `sdk` | `name: string` | In-process SDK server |
| `claudeai-proxy` | `url, id` | Claude.ai proxy server |

### MCP Configuration Locations

1. **Project `.mcp.json`** — project-level MCP servers (needs approval via `enabledMcpjsonServers`)
2. **Plugin manifest** — `mcpServers` in plugin's manifest (auto-approved for enabled plugins)
3. **MCPB files** — `.mcpb` or `.dxt` files (plugin packaging format)
4. **Settings `mcpServers`** — inline MCP server configs in settings.json

### MCP Approval Flow

- `enableAllProjectMcpServers: true` → auto-approve all `.mcp.json` servers
- Otherwise, servers must be in `enabledMcpjsonServers` to be active
- `disabledMcpjsonServers` explicitly blocks specific servers
- Enterprise `allowedMcpServers` / `deniedMcpServers` provide org-level control
- Denylist takes precedence over allowlist

### Enterprise MCP Server Allowlist/Denylist

**Allowed (`allowedMcpServers`):**
```javascript
{
  serverName: string,     // e.g., "my-server"
  // OR
  serverCommand: string[], // e.g., ["npx", "-y", "@acme/mcp"]
  // OR
  serverUrl: string        // e.g., "https://*.example.com/*" (wildcards supported)
}
// Exactly one of serverName, serverCommand, or serverUrl must be set
```

**Denied (`deniedMcpServers`):** Same schema, blocks matching servers.

### LSP Server Configuration

Plugins can also provide LSP servers:
```javascript
{
  command: string,
  args: string[],
  extensionToLanguage: Record<string, string>,
  transport: "stdio" | "socket",
  env: Record<string, string>,
  initializationOptions: unknown,
  settings: unknown,
  workspaceFolder: string,
  startupTimeout: number,    // ms
  shutdownTimeout: number,   // ms
  restartOnCrash: boolean,
  maxRestarts: number
}
```

---

## 8. Identity Strings

### System Identity

The first line of every CC system prompt is one of:
- `"You are Claude Code, Anthropic's official CLI for Claude."`
- `"You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."`
- `"You are a Claude agent, built on Anthropic's Claude Agent SDK."`

### Subagent Identity

Subagents receive:
```
You are an agent for Claude Code, Anthropic's official CLI for Claude.
Given the user's message, you should use the tools available to complete the task.
Do what has been asked; nothing more, nothing less.
```

### Plan Agent Identity

```
You are a software architect and planning specialist for Claude Code.
Your role is to explore the codebase and design implementation plans.
```

---

## Appendix: Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `No1` | `"Claude Opus 4.6"` | Default model display name |
| `wMH` | `"__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__"` | Dynamic prompt boundary marker |
| `s71` | `"59cf53e54c78"` | Hash salt for prompt integrity |
| `n8$` | `"anthropics"` | Reserved marketplace org |
| `sYL` | (JSON Schema URL) | Settings schema reference |
| Package | `@anthropic-ai/claude-code` | NPM package name |
| Issues | `https://github.com/anthropics/claude-code/issues` | Issue tracker |
| Docs | `https://code.claude.com/docs/en/overview` | Documentation |
