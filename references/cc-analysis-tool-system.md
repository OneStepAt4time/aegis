# Claude Code Tool System Analysis

**Analysis Date:** March 31, 2026  
**Source Base Path:** `/home/bubuntu/projects/aegis/.claude-internals/claude-code-leaked/source/`

## Executive Summary

Claude Code's tool system is a sophisticated, extensible architecture built around TypeScript and Zod schemas. The system provides:
- **Plugin-based tool registration** with lazy loading and conditional compilation
- **Multi-layered permission system** with allow/deny/ask rules, classifiers, and hooks
- **Rich lifecycle management** with progress tracking, concurrent execution safety, and error handling
- **MCP (Model Context Protocol) integration** for external tool servers
- **Hook system** for extending behavior at multiple execution points

---

## 1. Tool Interface (`src/Tool.ts`)

### Core Tool Type Definition

The Tool interface defines the contract all tools must implement:

```typescript
export type Tool<
  Input extends AnyObject = AnyObject,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = {
  // Identity
  readonly name: string
  aliases?: string[]
  searchHint?: string
  
  // Schemas
  readonly inputSchema: Input
  readonly inputJSONSchema?: ToolInputJSONSchema
  outputSchema?: z.ZodType<unknown>
  
  // Lifecycle Methods
  call(
    args: z.infer<Input>,
    context: ToolUseContext,
    canUseTool: CanUseToolFn,
    parentMessage: AssistantMessage,
    onProgress?: ToolCallProgress<P>,
  ): Promise<ToolResult<Output>>
  
  // Metadata Methods
  isEnabled(): boolean
  isReadOnly(input: z.infer<Input>): boolean
  isDestructive?(input: z.infer<Input>): boolean
  isConcurrencySafe(input: z.infer<Input>): boolean
  
  // Permission System
  validateInput?(input, context): Promise<ValidationResult>
  checkPermissions(input, context): Promise<PermissionResult>
  
  // UI Rendering
  description(input, options): Promise<string>
  prompt(options): Promise<string>
  userFacingName(input): string
  renderToolUseMessage(input, options): React.ReactNode
  renderToolResultMessage?(content, progressMessages, options): React.ReactNode
  
  // Result Handling
  maxResultSizeChars: number
  mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam
  
  // Advanced Features
  interruptBehavior?(): 'cancel' | 'block'
  isSearchOrReadCommand?(input): { isSearch: boolean; isRead: boolean }
  isOpenWorld?(input): boolean
  shouldDefer?: boolean
  alwaysLoad?: boolean
  mcpInfo?: { serverName: string; toolName: string }
}
```

### Key Design Patterns

#### 1. **buildTool Helper Function**

Instead of implementing the full Tool interface directly, tools use `buildTool()`:

```typescript
export function buildTool<D extends AnyToolDef>(def: ToolDef<D>): BuiltTool<D> {
  return {
    ...TOOL_DEFAULTS,
    userFacingName: () => def.name,
    ...def,
  }
}
```

**Default Values (Fail-Closed Security):**
- `isEnabled` → true
- `isConcurrencySafe` → false (assume NOT safe)
- `isReadOnly` → false (assume writes)
- `isDestructive` → false
- `checkPermissions` → { behavior: 'allow', updatedInput } (defer to general permission system)
- `toAutoClassifierInput` → '' (skip classifier)
- `userFacingName` → tool name

#### 2. **ToolUseContext**

The context object passed to every tool call:

```typescript
export type ToolUseContext = {
  options: {
    commands: Command[]
    debug: boolean
    mainLoopModel: string
    tools: Tools
    verbose: boolean
    thinkingConfig: ThinkingConfig
    mcpClients: MCPServerConnection[]
    mcpResources: Record<string, ServerResource[]>
    isNonInteractiveSession: boolean
    agentDefinitions: AgentDefinitionsResult
    maxBudgetUsd?: number
    customSystemPrompt?: string
    appendSystemPrompt?: string
    refreshTools?: () => Tools
  }
  abortController: AbortController
  readFileState: FileStateCache
  getAppState(): AppState
  setAppState(f: (prev: AppState) => AppState): void
  messages: Message[]
  // ... many more fields
}
```

#### 3. **Tool Result Structure**

```typescript
export type ToolResult<T> = {
  data: T
  newMessages?: Message[]
  contextModifier?: (context: ToolUseContext) => ToolUseContext
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
}
```

---

## 2. Tool Registry (`src/tools.ts`)

### Central Tool Assembly

The registry uses a **modular, feature-flagged architecture**:

```typescript
export function getAllBaseTools(): Tools {
  return [
    AgentTool,
    TaskOutputTool,
    BashTool,
    ...(hasEmbeddedSearchTools() ? [] : [GlobTool, GrepTool]),
    ExitPlanModeV2Tool,
    FileReadTool,
    FileEditTool,
    FileWriteTool,
    NotebookEditTool,
    WebFetchTool,
    TodoWriteTool,
    WebSearchTool,
    TaskStopTool,
    AskUserQuestionTool,
    SkillTool,
    EnterPlanModeTool,
    ...(process.env.USER_TYPE === 'ant' ? [ConfigTool, TungstenTool] : []),
    ...(SuggestBackgroundPRTool ? [SuggestBackgroundPRTool] : []),
    ...(WebBrowserTool ? [WebBrowserTool] : []),
    // ... many more conditional tools
  ]
}
```

### Tool Pool Assembly

The complete tool pool merges built-in tools with MCP tools:

```typescript
export function assembleToolPool(
  permissionContext: ToolPermissionContext,
  mcpTools: Tools,
): Tools {
  const builtInTools = getTools(permissionContext)
  const allowedMcpTools = filterToolsByDenyRules(mcpTools, permissionContext)
  
  // Sort for prompt-cache stability, built-ins first
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  return uniqBy(
    [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
    'name',
  )
}
```

### Permission-Based Filtering

Tools are filtered by deny rules before the model sees them:

```typescript
export function filterToolsByDenyRules<T>(
  tools: readonly T[],
  permissionContext: ToolPermissionContext
): T[] {
  return tools.filter(tool => !getDenyRuleForTool(permissionContext, tool))
}
```

---

## 3. Tool Implementations

### 3.1 BashTool (`src/tools/BashTool/`)

**Most complex tool** - handles shell command execution with 16+ supporting files.

#### Structure:
```
BashTool/
├── BashTool.tsx          # Main implementation (1200+ lines)
├── bashPermissions.ts    # Permission checking (2600+ lines)
├── bashSecurity.ts       # Security validation
├── bashCommandHelpers.ts # Command parsing helpers
├── commandSemantics.ts   # Semantic analysis
├── pathValidation.ts     # Path-based constraints
├── readOnlyValidation.ts # Read-only command detection
├── sedValidation.ts      # sed command validation
├── shouldUseSandbox.ts   # Sandbox decision logic
└── UI.tsx                # React rendering components
```

#### Key Features:

1. **Command Classification**:
```typescript
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', 'ag', 'ack'])
const BASH_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'jq', 'awk'])
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du'])
```

2. **Sandbox Mode**:
- Automatic sandboxing for dangerous commands
- Platform-specific: seatbelt on macOS, namespaces on Linux
- Can be disabled with dangerouslyDisableSandbox flag

3. **Background Execution**:
- run_in_background flag for long-running commands
- Output readable via Read tool on task output path
- Auto-backgrounding in assistant mode after timeout

4. **Security Checks**:
- Tree-sitter AST parsing for complex commands
- Environment variable validation
- Heredoc handling
- Output redirection analysis

### 3.2 FileReadTool (`src/tools/FileReadTool/`)

**Multi-format file reader** with intelligent content handling.

#### Supported Formats:

```typescript
const outputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), file: z.object({...}) }),
  z.object({ type: z.literal('image'), file: z.object({...}) }),
  z.object({ type: z.literal('notebook'), file: z.object({...}) }),
  z.object({ type: z.literal('pdf'), file: z.object({...}) }),
  z.object({ type: z.literal('parts'), file: z.object({...}) }),  // PDF pages
  z.object({ type: z.literal('file_unchanged'), file: z.object({...}) }),
])
```

#### Key Features:

1. **Image Handling**:
- Auto-resize and compress images to token limits
- Support for PNG, JPEG, GIF, WebP
- Metadata extraction (dimensions, format)
- Base64 encoding with MIME type detection

2. **PDF Support**:
- Page range extraction (pages parameter)
- Image extraction from PDF pages
- Token budget management
- Maximum 100 pages per read

3. **Notebook Support**:
- Jupyter notebook reading
- Cell-by-cell output mapping
- Code and markdown cells

4. **Blocked Device Paths**:
```typescript
const BLOCKED_DEVICE_PATHS = new Set([
  '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
  '/dev/stdin', '/dev/tty', '/dev/console',
  '/dev/stdout', '/dev/stderr',
  '/dev/fd/0', '/dev/fd/1', '/dev/fd/2',
])
```

### 3.3 FileWriteTool (`src/tools/FileWriteTool/`)

**Atomic file writes** with staleness protection.

#### Validation Pipeline:

1. **Path Validation**: Check for deny rules
2. **Secrets Check**: `checkTeamMemSecrets(fullFilePath, content)`
3. **Read-Before-Write**: Must read file first (unless creating new)
4. **Staleness Check**: Compare mtime with last read timestamp
5. **Atomic Write**: No async operations between staleness check and write

```typescript
async validateInput({ file_path, content }, toolUseContext) {
  const fullFilePath = expandPath(file_path)
  
  // Reject writes to team memory files that contain secrets
  const secretError = checkTeamMemSecrets(fullFilePath, content)
  if (secretError) return { result: false, message: secretError, errorCode: 0 }
  
  // Check deny rules
  const denyRule = matchingRuleForInput(fullFilePath, permissionContext, 'edit', 'deny')
  if (denyRule !== null) {
    return { result: false, message: 'File is denied by permission settings.', errorCode: 1 }
  }
  
  // Must read before write
  const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
  if (!readTimestamp || readTimestamp.isPartialView) {
    return { result: false, message: 'Read file first before writing.', errorCode: 2 }
  }
  
  // Staleness check
  const lastWriteTime = getFileModificationTime(fullFilePath)
  if (lastWriteTime > readTimestamp.timestamp) {
    return { result: false, message: 'File modified since read. Read again.', errorCode: 3 }
  }
  
  return { result: true }
}
```

### 3.4 GrepTool (`src/tools/GrepTool/`)

**Fast file content search** using ripgrep.

#### Features:

1. **Multiple Output Modes**:
   - `content`: Show matching lines with context (B/A/C flags)
   - `files_with_matches`: Just filenames
   - `count`: Match counts per file

2. **Result Limiting**:
```typescript
const DEFAULT_HEAD_LIMIT = 250

function applyHeadLimit<T>(items: T[], limit: number | undefined, offset: number = 0) {
  if (limit === 0) return { items: items.slice(offset), appliedLimit: undefined }  // Unlimited
  const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT
  const sliced = items.slice(offset, offset + effectiveLimit)
  return { items: sliced, appliedLimit: wasTruncated ? effectiveLimit : undefined }
}
```

3. **VCS Directory Exclusion**:
```typescript
const VCS_DIRECTORIES_TO_EXCLUDE = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl']
```

### 3.5 MCPTool (`src/tools/MCPTool/`)

**Model Context Protocol wrapper** for external tool servers.

```typescript
export const MCPTool = buildTool({
  isMcp: true,
  isOpenWorld() { return false },
  name: 'mcp',
  maxResultSizeChars: 100_000,
  
  async call() {
    return { data: '' }  // Overridden in mcpClient.ts
  },
  
  async checkPermissions(): Promise<PermissionResult> {
    return {
      behavior: 'passthrough',
      message: 'MCPTool requires permission.',
    }
  },
})
```

**Note**: MCP tools are dynamically created and registered at runtime when MCP servers connect. The mcpInfo field identifies the source server.

---

## 4. Permission System

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     PERMISSION FLOW                              │
│                                                                  │
│  1. validateInput() → Tool-specific validation                   │
│  2. checkPermissions() → Tool-specific permission logic          │
│  3. hasPermissionsToUseTool() → General permission system        │
│     ├─ Check allow/deny/ask rules                                │
│     ├─ Check permission mode (bypass, plan, default)            │
│     ├─ Run PreToolUse hooks                                      │
│     └─ Classifier checks (bash, auto-mode)                       │
│  4. useCanUseTool() → Permission UI & decision                   │
│     ├─ Coordinator worker handling                               │
│     ├─ Swarm worker handling                                     │
│     └─ Interactive dialog (if needed)                            │
└─────────────────────────────────────────────────────────────────┘
```

### Permission Modes

```typescript
export type PermissionMode =
  | 'acceptEdits'       // Auto-accept file edits
  | 'bypassPermissions' // Auto-approve everything
  | 'default'           // Normal prompting
  | 'dontAsk'           // Auto-deny unknown
  | 'plan'              // Auto-approve reads, prompt for writes
  | 'auto'              // Classifier-based auto-approval (feature flag)
  | 'bubble'            // Bubble up to parent (subagents)
```

### Permission Rules

```typescript
export type PermissionRule = {
  source: PermissionRuleSource  // Where the rule came from
  ruleBehavior: PermissionBehavior  // 'allow' | 'deny' | 'ask'
  ruleValue: PermissionRuleValue    // Tool name + optional content
}

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string  // e.g., "git *" for Bash(git *)
}
```

**Rule Sources** (in precedence order):
1. `cliArg` - Command-line flags (highest priority)
2. `command` - Per-command rules
3. `session` - Current session only
4. `flagSettings` - Environment variable flags
5. `policySettings` - Enterprise policy
6. `localSettings` - .claude/settings.local.json
7. `projectSettings` - .claude/settings.json
8. `userSettings` - ~/.claude/settings.json

### Permission Decision Flow

```typescript
export type PermissionDecision<Input> =
  | PermissionAllowDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionDenyDecision

export type PermissionAllowDecision<Input> = {
  behavior: 'allow'
  updatedInput?: Input      // Tool can modify input
  userModified?: boolean
  decisionReason?: PermissionDecisionReason
  toolUseID?: string
  acceptFeedback?: string
  contentBlocks?: ContentBlockParam[]
}

export type PermissionAskDecision<Input> = {
  behavior: 'ask'
  message: string
  updatedInput?: Input
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  metadata?: PermissionMetadata
  pendingClassifierCheck?: PendingClassifierCheck
  contentBlocks?: ContentBlockParam[]
}

export type PermissionDenyDecision = {
  behavior: 'deny'
  message: string
  decisionReason: PermissionDecisionReason
  toolUseID?: string
}
```

### Decision Reasons

```typescript
export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'subcommandResults'; reasons: Map<string, PermissionResult> }
  | { type: 'permissionPromptTool'; permissionPromptToolName: string; toolResult: unknown }
  | { type: 'hook'; hookName: string; hookSource?: string; reason?: string }
  | { type: 'asyncAgent'; reason: string }
  | { type: 'classifier'; classifier: 'bash_allow' | 'bash_deny' | 'auto-mode'; reason: string }
  | { type: 'sandboxOverride' }
  | { type: 'workingDir'; reason: string }
  | { type: 'safetyCheck'; reason: string }
  | { type: 'other'; reason: string }
```

### Bash-Specific Permission System

The Bash tool has the most sophisticated permission checking:

1. **Command Parsing**:
   - Tree-sitter AST parsing for complex commands
   - Split compound commands (&&, ||, |, ;)
   - Extract environment variables and output redirections

2. **Security Classification**:
```typescript
// Dangerous commands that require explicit approval
const BARE_SHELL_PREFIXES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
  'cmd', 'powershell', 'pwsh',
  'env', 'xargs',
  'nice', 'stdbuf', 'nohup', 'timeout', 'time',
  'sudo', 'doas', 'pkexec',
])
```

3. **Prefix Rule Generation**:
```typescript
function getSimpleCommandPrefix(command: string): string | null {
  // 'git commit -m "fix"' → 'git commit'
  // 'npm run build' → 'npm run'
  // 'ls -la' → null (flag, not subcommand)
  
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  // Skip env var assignments at the start
  let i = 0
  while (i < tokens.length && ENV_VAR_ASSIGN_RE.test(tokens[i])) {
    const varName = tokens[i].split('=')[0]
    if (!SAFE_ENV_VARS.has(varName)) return null
    i++
  }
  
  const remaining = tokens.slice(i)
  if (remaining.length < 2) return null
  const subcmd = remaining[1]
  // Second token must look like a subcommand (e.g., "commit", "run")
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(subcmd)) return null
  return remaining.slice(0, 2).join(' ')
}
```

4. **Classifier System** (if enabled):
   - Async classifier checks for auto-approval
   - Confidence-based decisions (high/medium/low)
   - Grace period for speculative checks (2 seconds)
   - Fallback to dialog on timeout or low confidence

---

## 7. Error Handling

### Validation Errors

```typescript
export type ValidationResult =
  | { result: true }
  | { result: false; message: string; errorCode: number }
```

Tools return validation errors BEFORE permission checks.

### Permission Errors

PermissionResult includes passthrough for coordinator/swarm workers:

```typescript
export type PermissionResult<Input> =
  | PermissionDecision<Input>
  | { behavior: 'passthrough'; message: string; ... }
```

### Tool Execution Errors

Caught and rendered via `renderToolUseErrorMessage()`:

```typescript
renderToolUseErrorMessage?(
  result: ToolResultBlockParam['content'],
  options: { progressMessages, tools, verbose, isTranscriptMode }
): React.ReactNode
```

### Abort Handling

ToolUseContext includes abortController:

```typescript
abortController: AbortController

// Tools should check for abort:
if (context.abortController.signal.aborted) {
  throw new AbortError('Tool execution aborted')
}
```

---

## 8. Advanced Features

### Tool Search (Deferred Loading)

For large tool pools, tools can be deferred:

```typescript
readonly shouldDefer?: boolean  // Send with defer_loading: true
readonly alwaysLoad?: boolean   // Never defer, always include in prompt
```

Deferred tools require ToolSearch to be used before calling.

### MCP Integration

MCP tools are created dynamically:

```typescript
const mcpTool = {
  ...MCPTool,
  name: `mcp__${serverName}__${toolName}`,
  mcpInfo: { serverName, toolName },
  async call(args, context) {
    return mcpClient.callTool(serverName, toolName, args)
  }
}
```

### Skill Tool Integration

Skills are registered as tools:

```typescript
export const SkillTool = buildTool({
  name: 'Skill',
  async call({ skill_name, skill_input }, context) {
    const skill = await loadSkill(skill_name)
    return skill.execute(skill_input, context)
  }
})
```

### Agent Tool (Subagents)

```typescript
export const AgentTool = buildTool({
  name: 'Agent',
  async call({ agent_type, prompt }, context) {
    const agent = createSubagent(agent_type, context)
    return agent.execute(prompt)
  }
})
```

---

## 9. File Organization

```
src/
├── Tool.ts                    # Core tool interface (~800 lines)
├── tools.ts                   # Tool registry (~400 lines)
├── tools/
│   ├── BashTool/
│   │   ├── BashTool.tsx
│   │   ├── bashPermissions.ts
│   │   ├── bashSecurity.ts
│   │   └── ... (16 files)
│   ├── FileReadTool/
│   ├── FileWriteTool/
│   ├── FileEditTool/
│   ├── GrepTool/
│   ├── GlobTool/
│   ├── MCPTool/
│   ├── AgentTool/
│   ├── SkillTool/
│   └── ... (44 tool directories)
├── hooks/
│   ├── useCanUseTool.tsx      # Permission UI hook (~300 lines)
│   ├── toolPermission/
│   │   ├── PermissionContext.ts
│   │   ├── permissionLogging.ts
│   │   └── handlers/
│   └── ... (many more hooks)
├── utils/
│   ├── permissions/
│   │   ├── permissions.ts      # Core permission logic (~1500 lines)
│   │   ├── PermissionResult.ts
│   │   ├── bashClassifier.ts
│   │   └── ... (20+ files)
│   ├── hooks.ts               # Hook execution engine (~5000 lines)
│   └── ... (many utilities)
└── types/
    ├── permissions.ts         # Permission type definitions
    ├── tools.ts              # Tool progress types
    └── hooks.ts              # Hook type definitions
```

---

## 10. Key Insights for Aegis

### 1. Layered Permission System

Claude Code uses **defense-in-depth**:
- Tool-specific validation (validateInput)
- Tool-specific permissions (checkPermissions)
- General permission system (hasPermissionsToUseTool)
- Hook-based overrides
- Classifier-based auto-approval

**For Aegis**: Implement similar layers, especially the hook system for extensibility.

### 2. Fail-Closed Defaults

Security-sensitive defaults:
- `isConcurrencySafe` → false
- `isReadOnly` → false
- Sandbox mode for Bash by default
- Workspace trust required for ALL hooks

**For Aegis**: Always err on the side of caution in defaults.

### 3. Atomic Operations

FileWriteTool demonstrates proper atomic patterns:
- No async between staleness check and write
- Read-before-write enforcement
- mtime comparison with content fallback

**For Aegis**: Ensure file operations are atomic, especially in concurrent scenarios.

### 4. Progressive Enhancement

Features are conditionally enabled:
- Feature flags control tool availability
- Tree-sitter parsing optional (external builds)
- Classifier system optional
- MCP tools dynamically added

**For Aegis**: Design for progressive enhancement from day one.

### 5. Rich Metadata

Tools provide extensive metadata:
- UI rendering methods
- Search/read classification
- Activity descriptions
- Token counting hints

**For Aegis**: Store rich metadata for better UX and analytics.

### 6. Result Size Management

Intelligent result handling:
- Size thresholds for disk persistence
- Preview generation
- Circular dependency prevention
- Streaming progress for long operations

**For Aegis**: Implement similar result management to avoid context bloat.

### 7. Hook Extensibility

Hooks can:
- Modify tool input
- Override permission decisions
- Provide feedback
- Run asynchronously
- Suggest permission rules

**For Aegis**: Design hook system for maximum flexibility without compromising security.

---

## Summary

Claude Code's tool system is a **production-grade, security-first architecture** that balances:

- **Extensibility**: Plugin tools, MCP integration, hooks
- **Security**: Layered permissions, fail-closed defaults, workspace trust
- **Performance**: Lazy loading, concurrent execution, result size limits
- **UX**: Rich rendering, progress reporting, intelligent suggestions

The codebase demonstrates **excellent separation of concerns** with:
- Clear interface boundaries (Tool, ToolUseContext, ToolResult)
- Modular permission system
- Pluggable hook architecture
- Feature-flagged conditional compilation

**Total Scale**: ~50,000+ lines across tool implementations, permissions, hooks, and utilities.

For Aegis, this analysis provides a **blueprint for building a robust tool orchestration layer** that can safely manage Claude Code sessions while maintaining extensibility and security.

---

## Appendix: Tool Count by Category

**File Operations**: 5 tools
- FileReadTool, FileWriteTool, FileEditTool, GlobTool, GrepTool

**Execution**: 2 tools
- BashTool, PowerShellTool

**Web/Network**: 2 tools
- WebFetchTool, WebSearchTool

**MCP**: 3 tools
- MCPTool, ListMcpResourcesTool, ReadMcpResourceTool

**Planning/Tasks**: 6 tools
- EnterPlanModeTool, ExitPlanModeTool, TodoWriteTool
- TaskCreateTool, TaskGetTool, TaskListTool, TaskUpdateTool, TaskOutputTool, TaskStopTool

**Agents/Skills**: 3 tools
- AgentTool, SkillTool, BriefTool

**Search/Discovery**: 1 tool
- ToolSearchTool

**Communication**: 2 tools
- AskUserQuestionTool, SendMessageTool

**Configuration**: 2 tools
- ConfigTool, TungstenTool

**Special Purpose**: 4 tools
- NotebookEditTool, LSPTool, EnterWorktreeTool, ExitWorktreeTool

**Conditional/Feature-Flagged**: 10+ tools
- WebBrowserTool, SleepTool, MonitorTool, etc.

**Total**: ~40 base tools, expands to 50+ with feature flags
