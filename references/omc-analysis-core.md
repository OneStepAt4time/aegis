# Oh-My-ClaudeCode (OMC) — Core Architecture Analysis

**Analyzed Version:** 4.9.3  
**Repository:** https://github.com/Yeachan-Heo/oh-my-claudecode  
**NPM Package:** `oh-my-claude-sisyphus`  
**Analysis Date:** 2026-04-01  
**Analyst:** Hephaestus Subagent

---

## Executive Summary

Oh-My-ClaudeCode (OMC) is a **multi-agent orchestration layer** for Claude Code. It transforms Claude Code from a single-agent coding assistant into a coordinated team of specialized agents with:
- 19+ specialized subagents (explore, architect, executor, planner, etc.)
- Staged pipeline execution (team-plan → team-prd → team-exec → team-verify → team-fix)
- tmux-based CLI worker coordination (Codex, Gemini, Claude)
- Hook-based injection system for context management
- Skill-based workflow templates (30+ skills)
- MCP server integration for tooling

**Key Differentiator from Aegis:** OMC is a **plugin/skill system** that extends Claude Code's capabilities through hooks and commands, while Aegis is an **HTTP API bridge** that orchestrates Claude Code sessions externally.

---

## 1. Project Structure

```
oh-my-claudecode/
├── src/
│   ├── index.ts              # Main entrypoint — createOmcSession()
│   ├── cli/                  # CLI commands (omc launch, team, wait, etc.)
│   ├── agents/               # Agent definitions (19 specialized agents)
│   ├── config/               # Configuration loader (JSONC, env vars)
│   ├── features/             # Core features (magic-keywords, background-tasks)
│   ├── hooks/                # 30+ hook modules (PreToolUse, Stop, etc.)
│   ├── team/                 # Team orchestration runtime
│   ├── skills/               # Skill bridge (empty, skills in root skills/)
│   ├── mcp/                  # MCP server definitions
│   ├── tools/                # Custom tools (LSP, AST, python-repl)
│   ├── installer/            # Installation to ~/.claude/
│   └── shared/               # Types and utilities
├── skills/                   # 30 skill directories with SKILL.md files
├── bridge/                   # Compiled CJS bridges for CLI/MCP
├── commands/                 # Command templates (mirrored to skills)
└── hooks/                    # Shell hook entrypoints
```

---

## 2. Main Entrypoint: createOmcSession()

**File:** src/index.ts

```typescript
export function createOmcSession(options?: OmcOptions): OmcSession {
  // 1. Load configuration (user + project + env)
  const config = loadConfig();

  // 2. Find context files (AGENTS.md, CLAUDE.md)
  const contextFiles = findContextFiles(workingDirectory);
  
  // 3. Build system prompt
  let systemPrompt = omcSystemPrompt + continuationSystemPromptAddition;
  
  // 4. Get agent definitions (19 specialized agents)
  const agents = getAgentDefinitions({ config });
  
  // 5. Build MCP servers + allowed tools
  const mcpServers = getDefaultMcpServers();
  const allowedTools = ['Read', 'Glob', 'Grep', 'WebSearch', ...];
  
  // 6. Create magic keyword processor
  const processPrompt = createMagicKeywordProcessor(config.magicKeywords);
  
  return { queryOptions, state, config, processPrompt, ... };
}
```

**Key Architecture Decision:** OMC wraps the Claude Agent SDK, NOT Claude Code directly. The queryOptions returned by createOmcSession() are passed to the SDK's query() function.

---

## 3. Configuration System

**File:** src/config/loader.ts

### Configuration Sources (Priority Order)

1. **Built-in defaults** (buildDefaultConfig())
2. **User config** (~/.config/claude-omc/config.jsonc)
3. **Project config** (<project>/.claude/omc.jsonc)
4. **Environment variables** (highest precedence)

### Key Configuration Options

```typescript
interface PluginConfig {
  // Agent model overrides (19 agents)
  agents?: {
    omc?: { model?: string };      // Main orchestrator
    explore?: { model?: string };  // Haiku for fast search
    architect?: { model?: string };// Opus for deep reasoning
    executor?: { model?: string }; // Sonnet for implementation
    // ... 15 more
  };
  
  // Feature toggles
  features?: {
    parallelExecution?: boolean;
    lspTools?: boolean;       // Real LSP integration
    astTools?: boolean;       // ast-grep integration
    continuationEnforcement?: boolean;
    autoContextInjection?: boolean;
  };
  
  // Model routing
  routing?: {
    enabled?: boolean;
    defaultTier?: "LOW" | "MEDIUM" | "HIGH";
    forceInherit?: boolean;   // Use parent model (for non-Anthropic providers)
    tierModels?: { LOW?, MEDIUM?, HIGH? };
    agentOverrides?: Record<string, { tier, reason }>;
  };
  
  // External models (Codex, Gemini)
  externalModels?: ExternalModelsConfig;
  
  // Delegation routing (opt-in)
  delegationRouting?: DelegationRoutingConfig;
}
```

### Environment Variables

- `OMC_ROUTING_FORCE_INHERIT=true` — Force all agents to inherit parent model
- `OMC_MODEL_ALIAS_HAIKU=inherit` — Promote haiku agents to inherit
- `OMC_EXTERNAL_MODELS_DEFAULT_PROVIDER=codex|gemini`
- `OMC_DELEGATION_ROUTING_ENABLED=true`

---

## 4. Agent System

**File:** src/agents/definitions.ts

### 19 Specialized Agents

| Category | Agents | Purpose |
|----------|--------|---------|
| **Build/Analysis** | explore (haiku), analyst (opus), planner (opus), architect (opus), debugger (sonnet), executor (sonnet), verifier (sonnet), tracer (sonnet) | Code discovery, requirements, planning, design, debugging, implementation, verification |
| **Review** | security-reviewer (sonnet), code-reviewer (opus) | Security audits, code quality |
| **Domain** | test-engineer, designer, writer, qa-tester, scientist, git-master, code-simplifier, document-specialist | Testing, UI/UX, docs, QA, data science, git, simplification, external docs |
| **Coordination** | critic (opus) | Plan review, gap analysis |

### Agent Loading

```typescript
// Agents load prompts from /agents/*.md files
export const architectAgent: AgentConfig = {
  name: 'architect',
  description: 'System design (opus) — boundaries, interfaces, tradeoffs',
  prompt: loadAgentPrompt('architect'),  // Loads from agents/architect.md
  model: 'opus',
  defaultModel: 'opus'
};
```

### OMC System Prompt

The main orchestrator system prompt enforces **relentless execution**:

```
You are the relentless orchestrator of a multi-agent development system.

## RELENTLESS EXECUTION
You are BOUND to your task list. You do not stop. You do not quit.
Work continues until EVERY task is COMPLETE.

## Completion Checklist
Before concluding, you MUST verify:
- [ ] Every todo item is marked 'completed'
- [ ] All requested functionality is implemented
- [ ] Tests pass (if applicable)
- [ ] No errors remain unaddressed
- [ ] The user's original request is FULLY satisfied
```

---

## 5. tmux Management

**Files:** src/team/tmux-session.ts, src/team/runtime.ts

### Team Runtime

OMC's team mode spawns **real CLI workers in tmux panes**:

```typescript
interface TeamRuntime {
  teamName: string;
  sessionName: string;          // tmux session name
  leaderPaneId: string;         // Lead agent pane
  workerPaneIds: string[];      // Worker pane IDs
  activeWorkers: Map<string, ActiveWorkerState>;
  cwd: string;
  resolvedBinaryPaths?: Partial<Record<CliAgentType, string>>;
  stopWatchdog?: () => void;
}
```

### CLI Worker Types

```typescript
type CliAgentType = 'claude' | 'codex' | 'gemini';

// Spawn command examples:
// omc team 2:codex "review auth module"
// omc team 2:gemini "redesign UI components"
// omc team 1:claude "implement payment flow"
```

### tmux Session Lifecycle

```typescript
// Create team session
const session = createTeamSession(teamName, workerCount);

// Spawn worker in pane
spawnWorkerInPane(session, workerIndex, agentType);

// Send message to worker
sendToWorker(paneId, message);

// Kill session
killTeamSession(sessionName);
```

### Heartbeat & Health

Workers write heartbeats to `.omc/state/team/<teamName>/heartbeats/<worker>.json`:

```typescript
interface HeartbeatData {
  workerName: string;
  teamName: string;
  provider: 'codex' | 'gemini';
  pid: number;
  lastPollAt: string;
  currentTaskId?: string;
  consecutiveErrors: number;
  status: 'idle' | 'busy' | 'error' | 'draining';
}
```

---

## 6. Multi-Agent/Teams Architecture

**File:** src/team/index.ts, skills/team/SKILL.md

### Staged Pipeline (Canonical Team Runtime)

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

### Stage Descriptions

| Stage | Agents | Purpose | Exit Criteria |
|-------|--------|---------|---------------|
| **team-plan** | explore (haiku), planner (opus), analyst?, architect? | Decompose task into subtasks | Task graph ready |
| **team-prd** | analyst (opus), critic? | Extract requirements, challenge scope | Acceptance criteria explicit |
| **team-exec** | executor, debugger, designer, writer, test-engineer | Implement subtasks | Tasks reach terminal state |
| **team-verify** | verifier (sonnet), test-engineer, security-reviewer, code-reviewer | Verification gates | Gates pass OR fix tasks generated |
| **team-fix** | executor, debugger | Fix defects from verification | Fixes complete → back to team-exec |

### Storage Layout

```
~/.claude/
  teams/fix-ts-errors/
    config.json              # Team metadata + members
  tasks/fix-ts-errors/
    .lock                    # File lock for concurrent access
    1.json                   # Subtask #1
    2.json                   # Subtask #2
    ...
```

### Team CLI Commands

```bash
# Spawn team
omc team 3:executor "fix all TypeScript errors"

# Check status
omc team status auth-review

# Shutdown
omc team shutdown auth-review
```

### Handoff Convention

Between stages, the lead writes handoffs to `.omc/handoffs/<stage>.md`:

```markdown
## Handoff: team-plan → team-exec
- **Decided**: Microservice architecture with 3 services
- **Rejected**: Monolith (scaling concerns)
- **Risks**: Worker service needs Redis — not yet provisioned
- **Files**: DESIGN.md, TEST_STRATEGY.md
- **Remaining**: Database migrations, CI/CD config
```

---

## 7. Plugin/Skill System

**Directory:** skills/ (30 skill directories)

### Skill Structure

Each skill has a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: team
description: N coordinated agents on shared task list
aliases: []
level: 4
---

# Team Skill

## Usage
/team 3:executor "task description"

## Workflow
1. Parse input (N, agent-type, task)
2. Analyze & decompose
3. Spawn workers
...
```

### Skill Categories

| Category | Skills | Trigger Keywords |
|----------|--------|------------------|
| **Execution** | autopilot, ultrawork, ralph, team, ultraqa | "autopilot", "ulw", "ralph", "team" |
| **Planning** | omc-plan, ralplan, deep-interview, ralph-init | "plan this", "interview me" |
| **Cleanup** | ai-slop-cleaner | "deslop", "anti-slop" |
| **Exploration** | deepinit, sciomc, external-context | "deepinit", "research" |
| **Utility** | learner, note, cancel, hud, setup | "stop", "cancel" |
| **Domain** | psm, writer-memory, release | psm context |

### Skill Invocation

```bash
# Manual
/oh-my-claudecode:team 3:executor "fix TypeScript errors"

# Magic keyword auto-detection
"autopilot build me a REST API"  # Triggers autopilot skill
"ulw fix all errors"              # Triggers ultrawork
```

### Learned Skills

OMC can **extract reusable patterns from sessions** into skill files:

```bash
/learner  # Extract hard-won debugging knowledge into .omc/skills/
```

Skills are stored in:
- Project scope: `.omc/skills/` (version-controlled)
- User scope: `~/.omc/skills/` (all projects)

### Skill Template Format

```markdown
---
name: skill-name
description: Brief description
triggers:
  - "keyword1"
  - "keyword2"
agent: executor  # Optional: which agent to use
model: sonnet    # Optional: model override
pipeline: [skill-name, follow-up-skill]  # Optional: multi-skill flow
next-skill: follow-up-skill              # Optional: handoff target
---

# Skill Name

## Purpose
What this skill accomplishes.

## Workflow
1. Step one
2. Step two
3. Step three
```

---

## 8. Hooks System

**File:** src/hooks/index.ts

### 30+ Hook Modules

| Hook | Purpose |
|------|---------|
| `keyword-detector` | Detect magic keywords (autopilot, ralph, etc.) |
| `ralph` | Persistence loop (PRD integration, verification) |
| `autopilot` | Autonomous execution state machine |
| `team-pipeline` | Team orchestration hooks |
| `learner` | Skill extraction from sessions |
| `think-mode` | Extended thinking activation |
| `rules-injector` | Inject project rules (.claude/rules/) |
| `recovery` | Context window limit recovery |
| `pre-compact` | Pre-compaction checkpoint |
| `project-memory` | Project-level context persistence |
| `omc-orchestrator` | Delegation enforcement |
| `todo-continuation` | Ensure todos complete before stopping |
| `ultrawork` | Maximum parallelism state |
| `notepad` | Compaction-resilient memory |

### Hook Bridge Architecture

```
Claude Code → Shell hook script → Node.js bridge (processHook) → JSON response
```

Shell scripts invoke TypeScript functions for complex logic:

```typescript
export function processHook(input: HookInput): HookOutput {
  // 1. Detect keywords
  const keywords = detectKeywordsWithType(input.prompt);
  
  // 2. Process mode-specific logic
  if (keywords.includes('ralph')) {
    return createRalphLoopHook(input);
  }
  
  // 3. Return modified prompt or guidance
  return { continue: true, message: enhancedPrompt };
}
```

### Key Hook Events

- `PreToolUse` — Before tool invocation (can block/modify)
- `PostToolUse` — After tool invocation (can analyze results)
- `Stop` — Claude response completes (can trigger continuation)
- `SessionStart` — Session begins (inject context)
- `UserPromptSubmit` — User submits prompt (detect keywords)

---

## 9. CLI Commands

**File:** src/cli/index.ts

### Main Commands

```bash
omc                          # Launch Claude Code with OMC integration
omc launch [args...]         # Explicit launch
omc team [args...]           # Team CLI API (spawn/status/shutdown)
omc ask [provider] [args]    # Provider advisor (claude|codex|gemini)
omc config                   # Show configuration
omc install                  # Install to ~/.claude/
omc setup                    # Sync all components
omc update                   # Check/install updates
omc wait                     # Rate limit wait & auto-resume
omc teleport [ref]           # Git worktree creation
omc session search [query]   # Search session history
omc doctor conflicts         # Diagnose issues
omc hud                      # HUD statusline renderer
omc ralphthon                # Autonomous hackathon lifecycle
omc autoresearch             # Thin-supervisor autoresearch
```

### Team Commands

```bash
omc team 3:executor "fix TypeScript errors"   # Spawn team
omc team status auth-review                    # Check status
omc team shutdown auth-review                  # Shutdown
```

### Ask Commands

```bash
omc ask claude "review this migration plan"
omc ask codex --prompt "identify architecture risks"
omc ask gemini --prompt "propose UI polish ideas"
```

---

## 10. MCP Integration

**Files:** src/mcp/servers.ts, src/mcp/omc-tools-server.ts

### Built-in MCP Servers

- **Exa** — Web search API
- **Context7** — Context injection

### Custom OMC Tools (MCP Format)

- `mcp__t__lsp_*` — LSP integration (go-to-definition, references, etc.)
- `mcp__t__ast_*` — AST tools using ast-grep
- `mcp__t__python_repl` — Python REPL

### Team MCP Bridge

**File:** bridge/team-mcp.cjs

The MCP team bridge daemon:
1. Polls task files in `.omc/state/team/<team>/tasks/`
2. Builds prompts for CLI workers
3. Spawns Codex/Gemini CLI processes
4. Reports results via outbox files

---

## 11. Key Architecture Patterns

### 1. Relentless Execution

The core philosophy: **Never stop until verified complete.**

```typescript
// From omcSystemPrompt:
"You are BOUND to your task list. You do not stop. You do not quit.
Work continues until EVERY task is COMPLETE."
```

### 2. Delegation Aggression

The orchestrator delegates to specialized agents rather than doing work itself:

```typescript
// Delegate Aggressively: Fire off subagents for specialized tasks
// Parallelize Ruthlessly: Launch multiple subagents concurrently
```

### 3. Staged Pipeline

Team execution follows strict stages with entry/exit criteria:

```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

### 4. Context Resilience

Multiple mechanisms to survive context compaction:
- **Notepad** — Compaction-resilient memory (`.omc/notepad.md`)
- **Project Memory** — Project-level context persistence
- **Pre-compact hooks** — Save state before compaction
- **Handoffs** — Stage transition documents

### 5. Multi-Provider Support

OMC supports non-Claude providers via:
- `forceInherit` — Use parent model for all agents
- `externalModels` config — Codex/Gemini defaults
- `delegationRouting` — Route specific roles to external providers

---

## 12. Comparison with Aegis

| Aspect | OMC | Aegis |
|--------|-----|-------|
| **Architecture** | Claude Code plugin/skill system | HTTP API bridge |
| **Orchestration** | Inside Claude Code (hooks) | External (Fastify server) |
| **tmux Management** | Built-in (team runtime) | Built-in (session manager) |
| **Agent Model** | 19 specialized subagents | Single Claude Code session |
| **Team Mode** | Native Claude Code teams + CLI workers | Planned multi-session |
| **Skill System** | 30 skills via `/oh-my-claudecode:` prefix | Not yet implemented |
| **Configuration** | JSONC + env vars | JSON + env vars |
| **Notification Hooks** | Telegram, Discord, Slack, webhooks | Planned |
| **State Persistence** | `.omc/` directory | `.manus/` (migrating to `.aegis/`) |
| **HTTP API** | None | RESTful API (9100) |
| **MCP Bridge** | MCP team bridge daemon | MCP server for Claude Code |

### Key Insights for Aegis

**What OMC does well (Aegis should adopt):**
1. **Staged pipeline** — Formal stage definitions with entry/exit criteria
2. **Handoff documents** — Context preservation between stages
3. **19 specialized agents** — Granular delegation based on task type
4. **Skill learning** — Automatic extraction of reusable patterns
5. **Multi-provider support** — Codex/Gemini integration patterns
6. **Relentless execution** — Forced completion loops

**What Aegis does differently (and better for external orchestration):**
1. **HTTP API** — External control plane for any orchestrator
2. **Language-agnostic** — Any HTTP client can use it
3. **Session persistence** — Long-running sessions with state
4. **Queue management** — Multiple concurrent sessions

---

## 13. Magic Keywords Reference

| Keyword | Effect | Example |
|---------|--------|---------|
| `team` | Team orchestration | `/team 3:executor "fix TypeScript errors"` |
| `omc team` | tmux CLI workers | `omc team 2:codex "security review"` |
| `ccg` | Tri-model synthesis | `/ccg review this PR` |
| `autopilot` | Full autonomous execution | `autopilot: build a todo app` |
| `ralph` | Persistence mode | `ralph: refactor auth` |
| `ulw` | Maximum parallelism | `ulw fix all errors` |
| `ralplan` | Iterative planning | `ralplan this feature` |
| `deep-interview` | Socratic requirements | `deep-interview "vague idea"` |
| `deepsearch` | Codebase search | `deepsearch for auth middleware` |
| `ultrathink` | Deep reasoning | `ultrathink about this architecture` |
| `cancelomc`, `stopomc` | Stop active modes | `stopomc` |

---

## 14. Key Files Reference

| Component | Primary File(s) |
|-----------|-----------------|
| Main entrypoint | `src/index.ts` |
| Configuration | `src/config/loader.ts`, `src/shared/types.ts` |
| Agent definitions | `src/agents/definitions.ts`, `src/agents/*.ts` |
| Team runtime | `src/team/runtime.ts`, `src/team/tmux-session.ts` |
| Team bridge | `src/team/mcp-team-bridge.ts`, `bridge/team-mcp.cjs` |
| Hooks | `src/hooks/index.ts`, `src/hooks/bridge.ts` |
| Skills | `skills/*/SKILL.md` |
| CLI | `src/cli/index.ts`, `src/cli/commands/*.ts` |
| MCP servers | `src/mcp/servers.ts`, `src/mcp/omc-tools-server.ts` |
| Installer | `src/installer/index.ts` |

---

## 15. Dependencies (from package.json)

**Core:**
- `@anthropic-ai/claude-agent-sdk` — Claude Agent SDK integration
- `@modelcontextprotocol/sdk` — MCP server support
- `@ast-grep/napi` — AST-based code analysis
- `better-sqlite3` — SQLite for state management
- `commander` — CLI framework
- `zod` — Schema validation

**Dev:**
- `vitest` — Testing framework
- `typescript` — Type system
- `esbuild` — Bundling

---

**End of Analysis**
