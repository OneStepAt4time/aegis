# Oh-My-ClaudeCode Analysis: Skills, Plugins & Workflows

> Deep-dive analysis of the oh-my-claudecode (OMC) multi-agent orchestration system
> Base path: `/home/bubuntu/projects/aegis/.claude-internals/oh-my-claudecode/`
> Version analyzed: 4.9.3
> Date: 2026-04-01

---

## Executive Summary

Oh-My-ClaudeCode (OMC) is a sophisticated multi-agent orchestration system for Claude Code that provides:

- **32 skills** (workflow templates invoked via `/oh-my-claudecode:skill-name`)
- **29 agents** (specialized subagents with tiered model routing)
- **Hooks system** (lifecycle event handlers via shell → TypeScript bridge)
- **State management** (`.omc/` directory for persistence across context compaction)
- **Team orchestration** (native Claude Code teams with staged pipeline)

The key innovation is the **skill composition model**: skills layer on top of each other (execution → enhancement → guarantee), enabling complex workflows like `ralph` (persistence) wrapping `ultrawork` (parallelism) wrapping `executor` agents.

---

## 1. Skill System

### 1.1 Skill Architecture

Skills are **behavior injections** stored as markdown files with YAML frontmatter:

```
skills/
├── autopilot/SKILL.md
├── ralph/SKILL.md
├── ultrawork/SKILL.md
├── deep-interview/SKILL.md
├── team/SKILL.md
└── ... (32 total)
```

**Skill Template Format:**

```markdown
---
name: skill-name
description: Brief description
triggers:
  - "keyword1"
agent: executor      # Optional: which agent to use
model: sonnet        # Optional: model override
pipeline: [skill-name, follow-up-skill]  # Multi-skill flow
next-skill: follow-up-skill              # Explicit handoff
handoff: .omc/plans/example.md           # Artifact handed to next skill
level: 4                               # Complexity tier
---

# Skill Name

<Purpose>What this skill accomplishes</Purpose>
<Use_When>When to invoke</Use_When>
<Do_Not_Use_When>Anti-patterns</Do_Not_Use_When>
<Steps>1. Step one 2. Step two...</Steps>
```

### 1.2 Skill Categories

| Category | Skills | Purpose |
|----------|--------|---------|
| **Execution** | `autopilot`, `ultrawork`, `ralph`, `team`, `ultraqa` | Autonomous work execution |
| **Planning** | `omc-plan`, `ralplan`, `deep-interview` | Requirements and design |
| **Exploration** | `deepinit`, `sciomc`, `external-context` | Codebase discovery |
| **Utility** | `cancel`, `hud`, `learner`, `skill`, `setup` | Configuration and management |
| **Domain** | `writer-memory`, `release`, `ai-slop-cleaner` | Specialized workflows |

### 1.3 Skill Composition Layers

Skills compose in three layers:

```
┌─────────────────────────────────────────────────────────────┐
│  GUARANTEE LAYER (optional)                                  │
│  ralph: "Cannot stop until verified done"                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  ENHANCEMENT LAYER (0-N skills)                              │
│  ultrawork (parallel) | git-master (commits) | ai-slop      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  EXECUTION LAYER (primary skill)                             │
│  default (build) | orchestrate (coordinate) | planner        │
└─────────────────────────────────────────────────────────────┘
```

**Formula:** `[Execution Skill] + [0-N Enhancements] + [Optional Guarantee]`

**Example:**
```
Task: "ultrawork: refactor API with proper commits"
Active skills: ultrawork + default + git-master
```

### 1.4 Comparison: OMC Skills vs Claude Code Native Skills

| Aspect | OMC Skills | CC Native Skills |
|--------|-----------|------------------|
| **Storage** | `skills/*/SKILL.md` | `.claude/skills/*.md` |
| **Invocation** | `/oh-my-claudecode:skill-name` | `/skill-name` |
| **Composition** | Layered (guarantee + enhancement + execution) | Single-file prompts |
| **State** | `.omc/state/` per mode | No built-in state |
| **Pipeline** | `pipeline: [skill1, skill2]` frontmatter | Manual chaining |
| **Magic Keywords** | Auto-detect from triggers | Manual invocation |
| **Verification** | Built-in (ralph, ultraqa) | User-implemented |

**Key Difference:** OMC skills are **workflow orchestrators** with state management, while CC native skills are **prompt templates**. OMC skills can span multiple sessions, track progress in `.omc/`, and chain via `next-skill` handoffs.

---

## 2. Key Skills Deep-Dive

### 2.1 autopilot (Full Autonomous Execution)

**5-Phase Pipeline:**
1. **Phase 0 - Expansion**: Analyst + Architect create spec from idea
2. **Phase 1 - Planning**: Architect creates plan, Critic validates
3. **Phase 2 - Execution**: Ralph + Ultrawork implement
4. **Phase 3 - QA**: UltraQA cycles until tests pass (max 5)
5. **Phase 4 - Validation**: Multi-perspective review (Architect, Security, Code)
6. **Phase 5 - Cleanup**: Delete state files on success

**Integration with 3-Stage Pipeline:**
```
deep-interview → ralplan → autopilot
    (clarity)   (feasibility) (correctness)
```

**Ralplan Detection:** If `.omc/plans/ralplan-*.md` or `.omc/plans/consensus-*.md` exists, skip Phase 0 + Phase 1 (already done).

### 2.2 ralph (Persistence Loop)

**PRD-Driven Execution:**
- Reads/writes `prd.json` with user stories
- Tracks progress in `progress.txt`
- Iterates until ALL stories have `passes: true`
- Requires reviewer verification (architect/critic/codex)
- **Mandatory deslop pass** after implementation

**Relationship Hierarchy:**
```
ralph (persistence wrapper)
 └── includes: ultrawork (parallel execution)
      └── provides: parallelism only
```

**State Schema:**
```json
{
  "active": true,
  "iteration": 1,
  "max_iterations": 10,
  "current_phase": "execution",
  "prd_path": ".omc/prd.json",
  "progress_path": ".omc/progress.txt"
}
```

### 2.3 deep-interview (Socratic Requirements)

**Ambiguity Scoring:**
- **Dimensions:** Goal Clarity (40%), Constraint Clarity (30%), Success Criteria (30%)
- **Threshold:** Ambiguity ≤ 20% to proceed
- **Challenge Agents:** Contrarian (R4+), Simplifier (R6+), Ontologist (R8+)

**Ambiguity Formula:**
```
Greenfield:  ambiguity = 1 - (goal × 0.40 + constraints × 0.30 + criteria × 0.30)
Brownfield:  ambiguity = 1 - (goal × 0.35 + constraints × 0.25 + criteria × 0.25 + context × 0.15)
```

**Ontology Tracking:**
- Extracts entities (nouns) from transcript
- Tracks stability ratio across rounds
- Convergence = same entities across 2+ rounds
- **stability_ratio:** `(stable + changed) / total`

### 2.4 team (N Coordinated Agents)

**Staged Pipeline:**
```
team-plan → team-prd → team-exec → team-verify → team-fix (loop)
```

**Stage Agent Routing:**
| Stage | Primary Agents | Selection Criteria |
|-------|---------------|-------------------|
| team-plan | `explore` + `planner` | `analyst` for unclear reqs, `architect` for complex boundaries |
| team-prd | `analyst` | `critic` to challenge scope |
| team-exec | `executor` | `debugger` for build errors, `designer` for UI |
| team-verify | `verifier` | `security-reviewer` for auth, `code-reviewer` for >20 files |
| team-fix | `executor` | `debugger` for type errors |

**Handoff Convention:**
Each stage writes `.omc/handoffs/<stage-name>.md`:
```markdown
## Handoff: team-plan → team-exec
- **Decided**: Key decisions made
- **Rejected**: Alternatives and why
- **Risks**: Identified risks for next stage
- **Files**: Key files created/modified
- **Remaining**: Items for next stage
```

---

## 3. Plugin Architecture

### 3.1 Plugin Structure

```
.claude-plugin/
├── plugin.json        # Plugin metadata
└── marketplace.json   # Marketplace listing
```

**plugin.json:**
```json
{
  "name": "oh-my-claudecode",
  "version": "4.9.3",
  "description": "Multi-agent orchestration system for Claude Code",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json"
}
```

### 3.2 Plugin Lifecycle

1. **Installation:**
   ```bash
   /plugin marketplace add https://github.com/Yeachan-Heo/oh-my-claudecode
   /plugin install oh-my-claudecode
   ```

2. **Hook Registration:**
   - Hooks defined in `hooks.json`
   - Shell scripts invoke TypeScript bridge via `node hook-bridge.mjs`
   - Bridge routes to `src/hooks/bridge.ts` → `processHook()`

3. **Configuration:**
   - `/omc-setup` creates `~/.claude/CLAUDE.md` or `./.claude/CLAUDE.md`
   - Skills auto-loaded from `skills/*/SKILL.md`
   - MCP servers from `.mcp.json` registered

4. **Runtime:**
   - Hooks fire on lifecycle events
   - Skills invoked via `/oh-my-claudecode:skill-name` or magic keywords
   - State persisted to `.omc/` directory

5. **Update:**
   ```bash
   /plugin marketplace update omc
   /omc-setup  # Re-run to apply new config
   ```

### 3.3 MCP Server Implementation

**`.mcp.json`:**
```json
{
  "mcpServers": {
    "t": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/bridge/mcp-server.cjs"]
    }
  }
}
```

**Tools exposed (18 total):**
- **LSP Tools (12):** `lsp_diagnostics`, `lsp_hover`, `lsp_references`, etc.
- **AST Tools (2):** `ast_grep_search`, `ast_grep_replace`
- **State Tools:** `state_read`, `state_write`
- **Notepad Tools:** `notepad_read`, `notepad_write_priority`, `notepad_write_working`
- **Memory Tools:** `project_memory_read`, `project_memory_write`, `project_memory_add_note`

**Tool disabling via environment:**
```bash
OMC_DISABLE_TOOLS=lsp,python-repl,project-memory
```

---

## 4. Hooks System

### 4.1 Architecture

```
Claude Code Event → Shell Script → Node.js Bridge → TypeScript Handler
                     (hooks.json)  (hook-bridge.mjs)  (src/hooks/bridge.ts)
```

**Example hook registration (hooks.json):**
```json
{
  "UserPromptSubmit": [{
    "matcher": "*",
    "hooks": [{
      "type": "command",
      "command": "node scripts/keyword-detector.mjs",
      "timeout": 5
    }]
  }]
}
```

### 4.2 Lifecycle Events

| Event | When It Fires | OMC Usage |
|-------|---------------|-----------|
| `UserPromptSubmit` | User submits prompt | Magic keyword detection, skill injection |
| `SessionStart` | Session begins | Project memory load, setup |
| `PreToolUse` | Before tool use | Permission validation, parallel hints |
| `PostToolUse` | After tool use | Result validation, memory update |
| `SubagentStart` | Subagent starts | Agent tracking |
| `SubagentStop` | Subagent stops | Output verification |
| `PreCompact` | Before compaction | Save critical info to notepad |
| `Stop` | Claude is about to stop | Persistent mode enforcement |

### 4.3 Key Hooks

**keyword-detector** (`UserPromptSubmit`):
- Detects magic keywords in user input
- Activates corresponding skills
- Injects `[MAGIC KEYWORD: ...]` into context

**persistent-mode** (`Stop`):
- When ralph/ultrawork active, prevents Claude from stopping
- Injects "The boulder never stops" message

**pre-compact** (`PreCompact`):
- Saves critical information to notepad
- Preserves state across context compaction

**omc-orchestrator** (`PreToolUse`/`PostToolUse`):
- Enforces delegation policy
- Provides verification reminders

### 4.4 Hook Output Patterns

| Pattern | Meaning |
|---------|---------|
| `hook success: Success` | Hook ran normally, continue |
| `hook additional context: ...` | Additional context for agent |
| `[MAGIC KEYWORD: ...]` | Magic keyword detected, execute skill |
| `The boulder never stops` | ralph/ultrawork mode active |

---

## 5. Prompt Engineering

### 5.1 Agent Prompt Structure

Agents are defined in `agents/*.md` with structured XML tags:

```markdown
---
name: executor
description: Focused task executor (Sonnet)
model: claude-sonnet-4-6
level: 2
---

<Agent_Prompt>
  <Role>What this agent does and doesn't do</Role>
  <Why_This_Matters>Rationale for constraints</Why_This_Matters>
  <Success_Criteria>Measurable completion conditions</Success_Criteria>
  <Constraints>Hard limits</Constraints>
  <Investigation_Protocol>Step-by-step process</Investigation_Protocol>
  <Tool_Usage>Which tools to use when</Tool_Usage>
  <Execution_Policy>Effort level, when to stop</Execution_Policy>
  <Output_Format>Expected structure</Output_Format>
  <Failure_Modes_To_Avoid>Anti-patterns</Failure_Modes_To_Avoid>
  <Examples>Good vs bad examples</Examples>
  <Final_Checklist>Pre-completion verification</Final_Checklist>
</Agent_Prompt>
```

### 5.2 Model Routing

| Tier | Model | Use For | Cost |
|------|-------|---------|------|
| LOW | haiku | Fast lookups, simple tasks | Low |
| MEDIUM | sonnet | Implementation, debugging | Medium |
| HIGH | opus | Architecture, strategic analysis | High |

**Agent tier assignments:**
- **haiku:** `explore`, `writer`, `executor-low`
- **sonnet:** `executor`, `debugger`, `test-engineer`, `qa-tester`
- **opus:** `architect`, `planner`, `critic`, `code-reviewer`, `analyst`

### 5.3 Delegation Categories

Semantic task classification that auto-determines model tier, temperature, thinking budget:

| Category | Tier | Temp | Thinking | Use For |
|----------|------|------|----------|---------|
| `visual-engineering` | HIGH | 0.7 | high | UI/UX, frontend |
| `ultrabrain` | HIGH | 0.3 | max | Complex reasoning, debugging |
| `artistry` | MEDIUM | 0.9 | medium | Creative solutions |
| `quick` | LOW | 0.1 | low | Simple lookups |
| `writing` | MEDIUM | 0.5 | medium | Documentation |

---

## 6. State Management

### 6.1 Directory Structure

```
.omc/
├── state/                    # Per-mode state
│   ├── autopilot-state.json
│   ├── ralph-state.json
│   ├── team/
│   └── sessions/{sessionId}/
├── notepad.md                # Compaction-resistant memo
├── project-memory.json       # Project knowledge
├── plans/                    # Execution plans
├── notepads/{plan-name}/     # Per-plan wisdom
│   ├── learnings.md
│   ├── decisions.md
│   ├── issues.md
│   └── problems.md
├── specs/                    # Deep-interview specs
├── prd.json                  # Ralph PRD
└── progress.txt              # Ralph progress log
```

### 6.2 Persistence Tags

```xml
<!-- Retained for 7 days -->
<remember>API endpoint changed to /v2</remember>

<!-- Retained permanently -->
<remember priority>Never access production DB directly</remember>
```

### 6.3 Session Scope

Per-session state in `.omc/state/sessions/{sessionId}/` enables:
- Multiple concurrent sessions on same project
- State isolation between sessions
- Crash recovery per session

---

## 7. Configuration System

### 7.1 Configuration Files

| File | Scope | Purpose |
|------|-------|---------|
| `~/.claude/CLAUDE.md` | Global | User-level OMC config |
| `./.claude/CLAUDE.md` | Project | Project-specific config (overrides global) |
| `.omc/` | Project | State, plans, notepads |
| `.claude/settings.json` | Project | Claude Code settings with OMC extensions |

### 7.2 OMC-Specific Settings

```json
{
  "omc": {
    "deepInterview": {
      "ambiguityThreshold": 0.2,
      "maxRounds": 20,
      "enableChallengeAgents": true
    },
    "autopilot": {
      "maxIterations": 10,
      "maxQaCycles": 5,
      "skipValidation": false
    },
    "team": {
      "maxAgents": 20,
      "monitorIntervalMs": 30000
    }
  }
}
```

### 7.3 Environment Variables

| Variable | Purpose |
|----------|---------|
| `OMC_STATE_DIR` | Centralized state directory (preserves across worktree deletion) |
| `OMC_DISABLE_TOOLS` | Comma-separated tool groups to disable |
| `DISABLE_OMC` | Disable all OMC hooks |
| `OMC_SKIP_HOOKS` | Comma-separated hook names to skip |
| `OMC_LSP_TIMEOUT_MS` | LSP request timeout |

---

## 8. Key Takeaways for Aegis

### 8.1 Patterns to Adopt

1. **Skill Composition Model:**
   - Layered skills (execution + enhancement + guarantee)
   - `pipeline` and `next-skill` frontmatter for chaining
   - State handoff via artifacts (`.omc/plans/*.md`)

2. **Verification-First Design:**
   - Ralph's PRD-driven completion (all stories must pass)
   - Architect verification before completion
   - Fresh evidence requirement (no assumptions)
   - Mandatory cleanup pass (deslop)

3. **Structured Agent Prompts:**
   - XML-tagged sections (Role, Constraints, Success_Criteria)
   - Failure_Modes_To_Avoid section (anti-patterns)
   - Examples (Good vs Bad)

4. **Magic Keywords:**
   - Natural language triggers (`ralph`, `ulw`, `autopilot`)
   - Auto-activation from context
   - Keyword detector hook

5. **State Isolation:**
   - Per-session state in `.omc/state/sessions/{sessionId}/`
   - Compaction-resistant notepad
   - Project-memory.json for cross-session knowledge

### 8.2 Differences from Claude Code Native

| Aspect | OMC | CC Native | Aegis Should |
|--------|-----|-----------|--------------|
| Skills | Workflow orchestrators with state | Prompt templates | Adopt OMC model |
| State | `.omc/` directory | None | Already have `state/` |
| Agents | Tiered model routing | Manual model selection | Already have |
| Hooks | Shell → TypeScript bridge | Native hooks | Use native hooks |
| Verification | Built-in (ralph, ultraqa) | User-implemented | Critical to adopt |
| Pipeline | `pipeline: [...]` frontmatter | Manual | Adopt for session types |

### 8.3 Integration Opportunities

1. **OMC skills → Aegis sessions:**
   - Aegis could invoke OMC skills via `aegis_send_message`
   - Map OMC modes to Aegis session types
   - `ralph` → persistent session, `ultrawork` → parallel agents

2. **State synchronization:**
   - Aegis `state/` mirrors OMC `.omc/state/`
   - Shared project-memory concept
   - Session-scoped state isolation

3. **Verification pipeline:**
   - Adopt Ralph's PRD + verification model
   - Quality gates at each phase
   - Mandatory cleanup before completion

4. **Skill composition:**
   - Implement layered skills in Aegis
   - `pipeline` frontmatter for session workflows
   - `next-skill` handoff between session types

---

## 9. References

### 9.1 Source Files

- **Base path:** `/home/bubuntu/projects/aegis/.claude-internals/oh-my-claudecode/`
- **README:** `README.md` (22KB, comprehensive)
- **Architecture:** `docs/ARCHITECTURE.md` (detailed system design)
- **Reference:** `docs/REFERENCE.md` (complete feature reference)
- **Features:** `docs/FEATURES.md` (internal API docs)
- **Skills:** `skills/*/SKILL.md` (32 skill definitions)
- **Agents:** `agents/*.md` (29 agent definitions)
- **Hooks:** `src/hooks/` (TypeScript hook implementations)
- **Bridge:** `src/hooks/bridge.ts` (main hook entry point, 2700+ lines)
- **Index:** `src/index.ts` (main exports)
- **MCP Server:** `src/mcp/omc-tools-server.ts` (tool definitions)

### 9.2 Key Files for Deep Understanding

| File | Lines | Purpose |
|------|-------|---------|
| `src/hooks/bridge.ts` | 2700+ | Main hook processor, all event routing |
| `skills/ralph/SKILL.md` | 300+ | Persistence loop implementation |
| `skills/deep-interview/SKILL.md` | 500+ | Socratic interview system |
| `skills/team/SKILL.md` | 600+ | Team orchestration protocol |
| `agents/executor.md` | 150+ | Agent prompt template example |
| `agents/architect.md` | 150+ | Architect agent definition |

---

## 10. Summary

Oh-My-ClaudeCode is a **workflow orchestration layer** on top of Claude Code that:

1. **Composes skills** in layers (execution + enhancement + guarantee)
2. **Tracks state** in `.omc/` directory for persistence
3. **Routes to agents** based on task complexity and model tier
4. **Verifies completion** with fresh evidence and reviewer sign-off
5. **Manages context** via notepad and project memory

The key insight for Aegis is that **skills are not just prompts—they're stateful workflow orchestrators** that can span multiple sessions, track progress, and enforce quality gates. This is fundamentally different from Claude Code's native skill system, which is prompt-only.

**Critical patterns to adopt:**
- PRD-driven execution (all stories must pass)
- Verification before completion (fresh evidence, no assumptions)
- Skill composition (layering guarantees on top of enhancements)
- Session-scoped state isolation
- Compaction-resistant memory (notepad)
