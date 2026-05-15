# Claude Code UI, Plugins & Services Analysis

## 1. UI Architecture (React + Ink)

### Core Entry Point
- **`src/ink.ts`**: Wraps all Ink render calls with ThemeProvider
- **`src/ink/root.ts`**: `createRoot()` and `render()` APIs
- **`src/ink/ink.tsx`** (1700+ lines): Core Ink class with:
  - React reconciler integration for Fiber-based rendering
  - Double-buffered screen management (frontFrame/backFrame)
  - Yoga layout engine for flexbox
  - Selection state management
  - Terminal modes: raw mode, alt-screen, mouse tracking

### Component Hierarchy
```
ink/
├── components/
│   ├── App.tsx (98KB) — Root component, handles stdin/stdout, raw mode
│   ├── Box.tsx — Layout container
│   ├── Text.tsx — Text rendering with theme support
│   ├── Button.tsx — Interactive buttons
│   ├── ScrollBox.tsx — Virtualized scrolling
│   └── design-system/
│       ├── ThemeProvider.tsx — Theme context
│       ├── ThemedText.tsx — Theme-aware text
│       └── FuzzyPicker.tsx — Fuzzy search
```

### Key Hooks
- **useInput**: Keyboard input handling
- **useStdin**: Stdin stream access
- **useTerminalFocus**: Terminal focus events
- **useSelection**: Text selection state
- **useDeclaredCursor**: IME cursor positioning

### Rendering Pipeline
1. React tree renders to Ink DOM
2. Yoga calculates layout (flexbox)
3. Renderer computes diff against previous frame
4. Optimizer minimizes terminal writes
5. Terminal write via diff protocol

## 2. Plugin System

### Architecture
- **Builtin plugins** (`src/plugins/builtinPlugins.ts`)
  - Ship with CLI, appear in /plugin UI
  - User can enable/disable
  - Provide skills, hooks, MCP servers
  
- **Marketplace plugins** (`src/services/plugins/`)
  - Install/uninstall/update operations
  - Scope: user, project, managed
  - Cached in `~/.claude/plugins/`

### Plugin Lifecycle
```typescript
// Registration
registerBuiltinPlugin({
  name: 'plugin-name',
  description: '...',
  version: '1.0.0',
  skills: [skillDefinitions],
  hooks: { ... },
  mcpServers: { ... },
  defaultEnabled: true,
})

// Discovery (marketplace)
loadInstalledPlugins() // From disk cache
installPlugin(scope, pluginId)
uninstallPlugin(pluginId)
updatePlugin(pluginId)
```

### Plugin Manifest Schema
```typescript
interface PluginManifest {
  name: string
  description: string
  version: string
  skills?: SkillDefinition[]
  hooks?: HooksSettings
  mcpServers?: Record<string, McpServerConfig>
}
```

### Plugin Scopes
- **user**: `~/.claude/settings.json`
- **project**: `.claude/settings.json`
- **managed**: Enterprise policy (read-only)
- **local**: Project directory

## 3. Service Layer

### Services Directory Structure
```
services/
├── analytics/ — Analytics (Datadog, GrowthBook)
├── api/ — API clients (Claude API)
├── mcp/ — MCP server management
├── plugins/ — Plugin operations
├── settingsSync/ — Settings cloud sync
├── SessionMemory/ — Conversation memory
├── compact/ — Conversation compaction
└── tools/ — Tool-related services
```

### Key Services

#### 1. MCP Service (`services/mcp/`)
- **Config** (`config.ts`): Loads MCP server configs from settings
- **Client** (`client.ts`): Creates MCP client connections
  - Transport: stdio, SSE, WebSocket, HTTP
  - Auth: OAuth, API key, header injection
- **Types**:
  - `stdio`: Command-based servers
  - `url`: HTTP/SSE servers
  - `websocket`: Real-time connections

#### 2. Auth Service (`services/mcp/auth.ts`)
- OAuth flow for Claude.ai
- API key management
- Token refresh
- Subscription handling

#### 3. Session Service (`assistant/sessionHistory.ts`)
- History pagination (100 events/page)
- Fetches from API: `/v1/sessions/{sessionId}/events`

#### 4. Analytics (`services/analytics/`)
- **GrowthBook** (`growthbook.ts`): Feature flags, A/B testing
- **Datadog** (`datadog.ts`): Metrics shipping
- **Metadata** (`metadata.ts`): Event metadata enrichment

## 4. Skills System

### Skill Loading
- **Sources**:
  - `bundled`: Compiled into CLI (`src/skills/bundledSkills.ts`)
  - `skills`: Directory-based (`.claude/skills/`)
  - `commands`: Legacy (`.claude/commands/`)
  - `mcp`: MCP-exposed skills
  - `plugin`: From installed plugins
  - `managed`: Enterprise policy

- **Discovery** (`loadSkillsDir.ts`):
  - Walks from `.claude/skills/` in project dirs
  - Parses `SKILL.md` files (frontmatter + content)
  - Creates `Command` objects
  - Caches with memoization

### Skill Definition
```typescript
interface BundledSkillDefinition {
  name: string
  description: string
  whenToUse?: string
  argumentHint?: string
  allowedTools?: string[]
  hooks?: HooksSettings
  context?: 'inline' | 'fork'
  getPromptForCommand(args, context): Promise<ContentBlockParam[]>
}
```

### Skill Frontmatter
```markdown
---
name: skill-name
description: Human-readable description
when_to_use: When to invoke this skill
argument-hint: "Arguments: <args>"
allowed-tools: [Read, Write, Bash]
---

## Skill content
```

## 5. Coordinator Module

### Overview
The Coordinator mode enables multi-agent orchestration via the `Agent` tool.

**Entry point**: `src/coordinator/coordinatorMode.ts`

### Key Concepts
1. **Workers**: Spawned via `Agent` tool
   - Independent execution contexts
   - Access to tools: Bash, Read, Write, Edit, MCP
   - Results arrive as `<task-notification>` messages

2. **Coordinator Role**:
   - Orchestrates workers
   - Synthesizes results
   - Communicates with user
   - Does NOT delegate understanding to workers

3. **Communication**:
   - `SendMessage` tool: Continue workers
   - `TaskStop` tool: Stop workers
   - Results arrive as user messages (not conversation)

### Worker Prompt Best Practices
1. **Self-contained**: Include all context worker needs
2. **Specific**: File paths, line numbers, exact changes
3. **Purpose**: Add a brief purpose statement
4. **Done criteria**: Define what "done" looks like

### Example Worker Prompt
```
Agent({
  description: "Fix null pointer in auth",
  prompt: "Fix the null pointer in src/auth/validate.ts:42. 
  The user field can be undefined when the session expires. 
  Add a null check before accessing user.id. 
  Commit and report the hash."
})
```

## 6. Component Architecture

### Component Categories
1. **Layout Components**:
   - `FullscreenLayout.tsx` (85KB): Main REPL layout
   - `ScrollBox.tsx`: Virtualized scrolling
   - `Pane.tsx`: Split panes
   - `Dialog.tsx`: Modal dialogs

2. **Message Components**:
   - `Message.tsx` (79KB): Message rendering
   - `Messages.tsx` (147KB): Message list
   - `MessageRow.tsx`: Message row
   - `MessageSelector.tsx` (115KB): Message selection

3. **Input Components**:
   - `TextInput.tsx`: Text input with history
   - `VimTextInput.tsx`: Vim-style input
   - `BaseTextInput.tsx`: Shared input logic

4. **Dialog Components**:
   - `BridgeDialog.tsx` (34KB): Claude.ai bridge
   - `AutoUpdater.tsx` (31KB): Auto-update flow
   - `MCPServerApprovalDialog.tsx`: MCP server approval

5. **Status Components**:
   - `StatusLine.tsx` (49KB): Status bar
   - `Stats.tsx` (152KB): Usage statistics
   - `Spinner.tsx`: Loading indicator

### Key Patterns
1. **Context Providers**:
   - `AppContext`: App-level state
   - `StdinContext`: Input stream
   - `TerminalFocusContext`: Focus events
   - `ClockContext`: Animation timing

2. **Theme System**:
   - `ThemeProvider`: Theme context
   - `ThemedText`: Theme-aware text
   - `ThemedBox`: Theme-aware containers

## 7. Key Insights for Aegis Development

### Terminal UI Patterns
1. **Double Buffering**: Ink uses front/back frames for smooth scrolling
2. **Diff Protocol**: Optimized terminal updates minimize flicker
3. **Yoga Layout**: Flexbox-based layout in terminal
4. **Selection Overlay**: Native-like text selection

### Plugin Architecture
1. **Built-in Plugins**: Ship with CLI, user-controllable
2. **Marketplace Plugins**: External, installable
3. **Plugin Components**: Skills, hooks, MCP servers
4. **Scope Management**: User, project, managed

### Service Patterns
1. **MCP Integration**: Full MCP protocol support
2. **Analytics**: GrowthBook + Datadog
3. **Auth**: OAuth + API key
4. **Settings**: Hierarchical (user > project > managed)

### Skills System
1. **Multiple Sources**: Bundled, directory-based, MCP-exposed
2. **Frontmatter Parsing**: YAML frontmatter in markdown
3. **Dynamic Discovery**: Skills discovered during session
4. **Conditional Skills**: Path-filtered activation

### Coordinator Mode
1. **Multi-Agent**: Spawn workers for parallel tasks
2. **Result Synthesis**: Coordinator aggregates worker results
3. **Communication**: Workers report via task notifications
4. **Prompt Quality**: Self-contained, specific instructions

## 8. Implementation Notes

- **Performance**: Ink uses Yoga for layout (compiled to WASM)
- **Terminal Compatibility**: Handles various terminal emulators
- **Selection**: Implements native-like text selection
- **Accessibility**: Supports screen readers via cursor declaration
- **Security**: Validates plugin manifests, sanitizes MCP tool names

---
*Generated: 2026-03-31 | Source: claude-code-leaked*
