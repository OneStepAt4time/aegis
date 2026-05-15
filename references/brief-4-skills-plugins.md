# Technical Brief: Skill/Plugin System Integration for Aegis

**Version:** 1.0  
**Date:** 2026-04-01  
**Author:** Hephaestus  
**Status:** Draft for Review  

---

## Executive Summary

This brief proposes a comprehensive Skill/Plugin System for Aegis that combines the best patterns from:

1. **Claude Code Native Skills** — Lightweight prompt templates with YAML frontmatter
2. **Oh-My-ClaudeCode (OMC) Skills** — Stateful workflow orchestrators with composition, verification, and persistence
3. **Aegis HTTP Hooks** — Existing hook infrastructure for lifecycle events

**Key Innovation:** Transform Aegis from a session manager into a **workflow orchestration platform** where skills are stateful, composable pipelines that enforce quality gates, track progress, and verify completion.

**Business Value:**
- Differentiation from generic CC wrappers
- Marketplace potential (shareable skills, agents, plugins)
- Enterprise features (governance, verification, audit trails)
- Dogfooding acceleration (Aegis develops Aegis with skills)

---

## 1. Current State

### 1.1 Aegis Today

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│  Aegis HTTP API (Fastify)                               │
│  - POST /v1/sessions → Create CC session                │
│  - POST /v1/sessions/:id/message → Send prompt          │
│  - GET /v1/sessions/:id/events → SSE stream             │
│  - POST /v1/hooks/:eventName → HTTP hook receiver       │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Session Manager (session.ts)                           │
│  - Creates/destroys tmux sessions                       │
│  - Manages CC processes                                 │
│  - Tracks subagents, status, permissions                │
│  - JSONL parsing for CC output                          │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Claude Code (child process)                            │
│  - Runs in tmux pane (interactive mode)                 │
│  - Hooks configured in .claude/settings.json            │
│  - Skills from .claude/skills/                          │
│  - Agents from .claude/agents/                          │
└─────────────────────────────────────────────────────────┘
```

**Current Hook System (hooks.ts):**
- HTTP endpoint: `POST /v1/hooks/:eventName?sessionId=UUID`
- Events handled: 24 known events (Stop, PreToolUse, PermissionRequest, etc.)
- Decision events: PreToolUse (with AskUserQuestion intercept), PermissionRequest
- Status tracking: Updates session status from hook events
- Subagent tracking: SubagentStart/SubagentStop for active agent count
- Auto-approval: bypassPermissions, dontAsk, acceptEdits, plan modes

**What Aegis Does NOT Have:**
- ❌ Skill discovery/loading
- ❌ Plugin management
- ❌ Workflow orchestration
- ❌ State persistence across compaction
- ❌ Verification pipelines
- ❌ Marketplace integration

### 1.2 Claude Code Native Skill System

**Skill Sources:**
```typescript
type SkillSource = 
  | 'bundled'     // Compiled into CLI
  | 'skills'      // .claude/skills/*/SKILL.md
  | 'commands'    // .claude/commands/ (legacy)
  | 'mcp'         // MCP-exposed skills
  | 'plugin'      // From installed plugins
  | 'managed';    // Enterprise policy
```

**Skill Definition:**
```typescript
interface BundledSkillDefinition {
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  hooks?: HooksSettings;
  context?: 'inline' | 'fork';
  getPromptForCommand(args, context): Promise<ContentBlockParam[]>;
}
```

**Limitations:**
- No state management (prompt-only)
- No composition (single skill at a time)
- No verification (user must verify)
- No persistence across sessions

### 1.3 Oh-My-ClaudeCode Skill System

**Skill Composition Model:**
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

**Key Innovations:**
- ✅ State persistence across compaction
- ✅ Skill composition (layering)
- ✅ Verification pipelines (ralph, ultraqa)
- ✅ Magic keyword detection
- ✅ Session-scoped state isolation
- ✅ Compaction-resistant memory (notepad)

---

## 2. Gap Analysis

### 2.1 What Aegis Has

| Feature | Implementation | Status |
|---------|----------------|--------|
| HTTP Hook Receiver | `hooks.ts` | ✅ Production |
| Session Management | `session.ts` | ✅ Production |
| Subagent Tracking | `SubagentStart/Stop` | ✅ Production |
| Permission Approval | `PermissionRequest` | ✅ Production |
| AskUserQuestion Intercept | `PreToolUse` | ✅ Production |
| Status Detection | Hook-based | ✅ Production |
| SSE Event Bus | `events.ts` | ✅ Production |
| JSONL Parsing | `terminal-parser.ts` | ✅ Production |

### 2.2 What Aegis Needs

| Feature | Priority | Effort | Value |
|---------|----------|--------|-------|
| Skill Discovery | P0 | 3 days | High |
| Skill Frontmatter Parsing | P0 | 2 days | High |
| Skill Composition Engine | P0 | 5 days | Critical |
| State Persistence Layer | P0 | 3 days | Critical |
| Verification Pipeline | P1 | 4 days | High |
| Plugin Management | P1 | 5 days | Medium |
| Marketplace Integration | P2 | 7 days | Medium |
| Magic Keyword Detection | P1 | 2 days | Medium |
| Compaction-Resistant Memory | P1 | 2 days | High |

### 2.3 Comparison Matrix

| Aspect | Aegis (Current) | CC Native | OMC | Target |
|--------|-----------------|-----------|-----|--------|
| Skill Discovery | ❌ | ✅ | ✅ | ✅ |
| State Persistence | ❌ | ❌ | ✅ | ✅ |
| Skill Composition | ❌ | ❌ | ✅ | ✅ |
| Verification | ❌ | ❌ | ✅ | ✅ |
| Plugin System | ❌ | ✅ | ✅ | ✅ |
| Marketplace | ❌ | ✅ | ❌ | ✅ |
| Hook Integration | ✅ | ✅ | ✅ | ✅ |
| Session Isolation | ✅ | ❌ | ✅ | ✅ |
| HTTP API | ✅ | ❌ | ❌ | ✅ |

---

## 3. Proposed Architecture

### 3.1 Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  AEGIS SKILL/PLUGIN SYSTEM                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Skill Discovery Service                                     │ │
│  │  - Scopes: bundled | user | project | plugin | managed      │ │
│  │  - Sources: .claude/skills/, plugins/, builtin              │ │
│  │  - Parsing: YAML frontmatter + XML content                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Skill Composition Engine                                    │ │
│  │  - Layers: Execution + Enhancement + Guarantee              │ │
│  │  - Pipeline: [skill1 → skill2 → skill3]                     │ │
│  │  - Handoff: artifacts passed between skills                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  State Management Layer                                      │ │
│  │  - Storage: .aegis/state/{sessionId}/                       │ │
│  │  - Artifacts: plans/, prd.json, progress.txt                │ │
│  │  - Memory: notepad.md, project-memory.json                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Verification Pipeline                                       │ │
│  │  - Quality Gates: tsc + build + test + lint                 │ │
│  │  - Fresh Evidence: no assumptions, verify everything        │ │
│  │  - Reviewer Sign-off: architect/critic/qa                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Plugin Manager                                              │ │
│  │  - Install/Uninstall/Update                                  │ │
│  │  - Scope: user | project | managed                           │ │
│  │  - Manifest: plugin.json + marketplace.json                 │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Skill Format

**File Structure:**
```
skills/
├── implement-feature/
│   └── SKILL.md
├── verify-completion/
│   └── SKILL.md
├── autopilot/
│   └── SKILL.md
└── workflow/
    └── SKILL.md
```

**Skill Definition Schema:**
```typescript
interface AegisSkillDefinition {
  // Identity
  name: string;                    // Unique skill identifier
  description: string;             // Human-readable description
  version: string;                 // Skill version (semver)
  
  // Discovery
  triggers?: string[];             // Magic keywords (['ulw', 'autopilot'])
  whenToUse?: string;              // When to invoke guidance
  argumentHint?: string;           // Argument format hint
  
  // Composition
  pipeline?: string[];             // Skill chain: ['plan', 'implement', 'verify']
  nextSkill?: string;              // Explicit handoff
  handoff?: string;                // Artifact path handed to next skill
  
  // Execution
  agent?: string;                  // Agent to use (executor, architect, etc.)
  model?: 'haiku' | 'sonnet' | 'opus';  // Model override
  level?: 1 | 2 | 3 | 4 | 5;       // Complexity tier
  
  // Constraints
  allowedTools?: string[];         // Tool whitelist
  maxIterations?: number;          // Max execution cycles
  timeout?: number;                // Max execution time (ms)
  
  // Verification
  requiresVerification?: boolean;  // Require quality gate
  verificationSkill?: string;      // Skill to use for verification
  reviewers?: string[];            // Required reviewers (architect, critic)
  
  // State
  persistent?: boolean;            // Persist across compaction
  stateSchema?: object;            // State file schema
  
  // Hooks
  hooks?: {
    PreToolUse?: HookAction[];
    PostToolUse?: HookAction[];
    Stop?: HookAction[];
    PreCompact?: HookAction[];
    [key: string]: HookAction[];
  };
}
```

**Example Skill (SKILL.md):**
```markdown
---
name: autopilot
description: Full autonomous feature implementation with verification
version: 1.0.0
triggers:
  - "autopilot"
  - "auto-implement"
pipeline:
  - deep-interview
  - plan
  - implement
  - verify
  - cleanup
agent: executor
model: sonnet
level: 5
requiresVerification: true
reviewers:
  - architect
  - critic
persistent: true
stateSchema:
  type: object
  properties:
    phase:
      type: string
      enum: [interview, planning, implementation, verification, cleanup]
    iteration:
      type: integer
    prd:
      type: string
---

# Autopilot Skill

<Purpose>
Fully autonomous feature implementation with built-in verification and cleanup.
</Purpose>

<Use_When>
- Clear feature request with acceptance criteria
- Need end-to-end implementation without manual intervention
- Quality gates must be enforced automatically
</Use_When>

<Do_Not_Use_When>
- Requirements are ambiguous (use deep-interview first)
- One-off quick fixes (use implement-feature)
- Exploratory prototyping (use brainstorm skill)
</Do_Not_Use_When>

<Steps>
1. **Phase 0 - Interview**: Deep-interview skill to clarify requirements
2. **Phase 1 - Planning**: Create execution plan with architect
3. **Phase 2 - Implementation**: Execute plan with executor agents
4. **Phase 3 - Verification**: Run quality gates + reviewer sign-off
5. **Phase 4 - Cleanup**: Remove temporary files, deslop code
</Steps>

<Failure_Modes_To_Avoid>
- Starting implementation without clear requirements
- Skipping verification phase
- Allowing infinite retry loops (max 10 iterations)
- Ignoring reviewer feedback
</Failure_Modes_To_Avoid>

<Success_Criteria>
- All tests pass (tsc + build + test)
- At least one reviewer approved
- No temporary/debug code left
- PR created and ready for merge
</Success_Criteria>
```

### 3.3 Skill Discovery

**Discovery Service (skillDiscovery.ts):**
```typescript
export class SkillDiscoveryService {
  private skills: Map<string, AegisSkillDefinition> = new Map();
  
  /**
   * Discover all skills from all sources.
   * Priority: managed > plugin > project > user > bundled
   */
  async discoverAll(): Promise<Map<string, AegisSkillDefinition>> {
    this.skills.clear();
    
    // Bundled skills (lowest priority)
    await this.loadBundledSkills();
    
    // User skills (~/.claude/skills/)
    await this.loadUserSkills();
    
    // Project skills (.claude/skills/)
    await this.loadProjectSkills();
    
    // Plugin skills
    await this.loadPluginSkills();
    
    // Managed skills (highest priority, enterprise)
    await this.loadManagedSkills();
    
    return this.skills;
  }
  
  /**
   * Find skill by magic keyword.
   */
  findByTrigger(keyword: string): AegisSkillDefinition | undefined {
    return Array.from(this.skills.values())
      .find(skill => skill.triggers?.includes(keyword));
  }
  
  /**
   * Resolve skill pipeline (flatten composition).
   */
  resolvePipeline(skillName: string): AegisSkillDefinition[] {
    const skill = this.skills.get(skillName);
    if (!skill) throw new Error(`Skill not found: ${skillName}`);
    
    if (!skill.pipeline) return [skill];
    
    return skill.pipeline.flatMap(name => this.resolvePipeline(name));
  }
}
```

**Skill Sources Priority:**
```
1. Managed (enterprise policy)     — Highest, cannot be overridden
2. Plugin (installed plugins)      — User-installed extensions
3. Project (.claude/skills/)       — Project-specific workflows
4. User (~/.claude/skills/)        — User's personal skills
5. Bundled (compiled into Aegis)   — Built-in skills, always available
```

### 3.4 Skill Lifecycle

**Lifecycle States:**
```typescript
type SkillLifecycleState = 
  | 'discovered'     // Skill found and parsed
  | 'initialized'    // State files created
  | 'running'        // Skill actively executing
  | 'paused'         // Waiting for user input or external event
  | 'verifying'      // Running verification pipeline
  | 'completed'      // Successfully finished
  | 'failed'         // Failed with error
  | 'cancelled';     // User cancelled
```

**State Transitions:**
```
discovered → initialized → running ⇄ paused
                           ↓
                       verifying
                           ↓
                       completed
```

**State Manager (skillState.ts):**
```typescript
export class SkillStateManager {
  private stateDir: string;
  
  constructor(sessionId: string) {
    this.stateDir = `.aegis/state/sessions/${sessionId}/skills/`;
  }
  
  /**
   * Initialize skill state.
   */
  async initialize(skill: AegisSkillDefinition): Promise<SkillState> {
    const state: SkillState = {
      skillName: skill.name,
      status: 'initialized',
      startTime: Date.now(),
      iteration: 0,
      phase: skill.pipeline?.[0] || 'main',
      artifacts: {},
      checkpoints: [],
    };
    
    await this.save(state);
    return state;
  }
  
  /**
   * Save state to disk (survives compaction).
   */
  async save(state: SkillState): Promise<void> {
    const filePath = path.join(this.stateDir, `${state.skillName}-state.json`);
    await fs.mkdir(this.stateDir, { recursive: true });
    await fs.writeJSON(filePath, state, { spaces: 2 });
  }
  
  /**
   * Write to notepad (compaction-resistant memory).
   */
  async writeToNotepad(content: string): Promise<void> {
    const notepadPath = path.join(this.stateDir, 'notepad.md');
    await fs.appendFile(notepadPath, `\n${new Date().toISOString()}: ${content}\n`);
  }
}
```

### 3.5 Plugin Architecture

**Plugin Manifest (plugin.json):**
```json
{
  "name": "aegis-terraform-plugin",
  "version": "1.2.0",
  "description": "Terraform infrastructure automation skills",
  "author": "community",
  "license": "MIT",
  "aegis": {
    "minVersion": "0.4.0",
    "maxVersion": "0.5.0"
  },
  "skills": "./skills/",
  "agents": "./agents/",
  "mcpServers": {
    "terraform-ls": {
      "command": "terraform-ls",
      "args": ["serve"]
    }
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write:*/*.tf",
        "action": {
          "type": "command",
          "command": "terraform fmt -check"
        }
      }
    ]
  }
}
```

**Marketplace Listing (marketplace.json):**
```json
{
  "id": "aegis-terraform-plugin",
  "name": "Terraform Automation",
  "tagline": "Infrastructure as Code skills for Terraform",
  "category": "infrastructure",
  "tags": ["terraform", "iac", "aws"],
  "icon": "🏗️",
  "rating": 4.8,
  "downloads": 1234,
  "featured": true,
  "verified": true
}
```

**Plugin Manager (pluginManager.ts):**
```typescript
export class PluginManager {
  private plugins: Map<string, AegisPlugin> = new Map();
  
  /**
   * Install plugin from URL or local path.
   */
  async install(source: string, scope: 'user' | 'project' = 'user'): Promise<AegisPlugin> {
    const tempDir = await this.downloadPlugin(source);
    const manifest = await this.validatePlugin(tempDir);
    
    const targetDir = path.join(this.pluginDir, scope, manifest.name);
    await fs.move(tempDir, targetDir);
    
    const plugin: AegisPlugin = {
      ...manifest,
      installedPath: targetDir,
      scope,
      installedAt: Date.now(),
      enabled: true,
    };
    
    this.plugins.set(manifest.name, plugin);
    
    // Re-discover skills to include plugin skills
    await this.skillDiscovery.discoverAll();
    
    return plugin;
  }
  
  /**
   * Uninstall plugin.
   */
  async uninstall(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
    
    await fs.remove(plugin.installedPath);
    this.plugins.delete(pluginId);
    
    // Re-discover skills to remove plugin skills
    await this.skillDiscovery.discoverAll();
  }
}
```

### 3.6 Hook Expansion

**New Hooks Needed:**
```typescript
interface AegisHookEvents {
  // Skill lifecycle
  SkillStarted: { skillName: string; sessionId: string; pipeline?: string[] };
  SkillPaused: { skillName: string; reason: string };
  SkillCompleted: { skillName: string; duration: number; status: 'success' | 'failed' };
  
  // Verification
  VerificationStarted: { sessionId: string; gates: string[] };
  VerificationPassed: { sessionId: string; results: VerificationResult[] };
  VerificationFailed: { sessionId: string; failures: string[] };
  
  // Plugin lifecycle
  PluginInstalled: { pluginId: string; version: string };
  PluginUpdated: { pluginId: string; oldVersion: string; newVersion: string };
  PluginUninstalled: { pluginId: string };
  
  // Pipeline
  PipelineStageStarted: { sessionId: string; stage: string; skill: string };
  PipelineStageCompleted: { sessionId: string; stage: string; success: boolean };
  PipelineHandoff: { sessionId: string; fromSkill: string; toSkill: string; artifact: string };
}
```

---

## 4. Marketplace Potential

### 4.1 Marketplace Architecture

**Components:**
1. **Plugin Registry** — Centralized plugin index (JSON)
2. **Plugin CDN** — Hosted plugin tarballs
3. **Rating System** — User ratings and reviews
4. **Verification Badges** — Official, verified, community
5. **Search/Discovery** — Category, tags, search

**CLI Commands:**
```bash
# Search plugins
aegis plugin search terraform

# Install plugin
aegis plugin install aegis-terraform-plugin

# List installed plugins
aegis plugin list

# Update plugin
aegis plugin update aegis-terraform-plugin

# Publish plugin (for authors)
aegis plugin publish ./my-plugin/
```

### 4.2 Initial Plugin Ideas

| Plugin | Category | Value |
|--------|----------|-------|
| aegis-terraform | Infrastructure | High |
| aegis-kubernetes | Infrastructure | High |
| aegis-react | Frontend | High |
| aegis-python | Backend | High |
| aegis-security | Security | High |
| aegis-testing | QA | High |
| aegis-ci | CI/CD | High |

---

## 5. Migration Path

### 5.1 Phase 1: Foundation (Week 1-2)

**Deliverables:**
- [ ] Skill discovery service
- [ ] SKILL.md parser (YAML frontmatter)
- [ ] Skill registry (in-memory)
- [ ] 5 bundled skills (implement, verify, plan, brainstorm, workflow)

**Files:**
```
src/
├── skills/
│   ├── skillDiscovery.ts
│   ├── skillParser.ts
│   ├── skillRegistry.ts
│   ├── types.ts
│   └── bundled/
│       ├── implement/SKILL.md
│       ├── verify/SKILL.md
│       ├── plan/SKILL.md
│       ├── brainstorm/SKILL.md
│       └── workflow/SKILL.md
```

### 5.2 Phase 2: State & Composition (Week 3-4)

**Deliverables:**
- [ ] State persistence layer
- [ ] Skill composition engine
- [ ] Pipeline execution
- [ ] Notepad (compaction-resistant memory)

**Files:**
```
src/
├── skills/
│   ├── skillState.ts
│   ├── skillComposer.ts
│   └── pipelineExecutor.ts
├── state/
│   └── stateManager.ts
```

### 5.3 Phase 3: Verification (Week 5-6)

**Deliverables:**
- [ ] Verification pipeline
- [ ] Quality gates (tsc, build, test, lint)
- [ ] Reviewer integration
- [ ] Fresh evidence requirement

**Files:**
```
src/
├── verification/
│   ├── verificationPipeline.ts
│   ├── qualityGates.ts
│   └── reviewers.ts
```

### 5.4 Phase 4: Plugins (Week 7-8)

**Deliverables:**
- [ ] Plugin manager
- [ ] Plugin installation/uninstallation
- [ ] Plugin validation
- [ ] Plugin skills integration

**Files:**
```
src/
├── plugins/
│   ├── pluginManager.ts
│   ├── pluginValidator.ts
│   └── types.ts
```

### 5.5 Phase 5: Marketplace (Week 9-10)

**Deliverables:**
- [ ] Plugin registry
- [ ] Marketplace API
- [ ] Search/discovery
- [ ] Rating system

**Files:**
```
src/
├── marketplace/
│   ├── registryClient.ts
│   ├── searchService.ts
│   └── types.ts
```

### 5.6 Phase 6: Dogfooding (Week 11-12)

**Deliverables:**
- [ ] Aegis develops Aegis using skills
- [ ] 3+ plugins created internally
- [ ] Documentation updated
- [ ] Blog post announcing marketplace

---

## 6. Effort Estimation

### 6.1 Total Effort

| Phase | Duration | Effort (person-days) |
|-------|----------|----------------------|
| Phase 1: Foundation | 2 weeks | 10 days |
| Phase 2: State & Composition | 2 weeks | 10 days |
| Phase 3: Verification | 2 weeks | 10 days |
| Phase 4: Plugins | 2 weeks | 10 days |
| Phase 5: Marketplace | 2 weeks | 10 days |
| Phase 6: Dogfooding | 2 weeks | 10 days |
| **Total** | **12 weeks** | **60 days** |

### 6.2 Dependencies

- **Phase 2** depends on Phase 1
- **Phase 3** depends on Phase 2
- **Phase 4** depends on Phase 1 (skills only)
- **Phase 5** depends on Phase 4
- **Phase 6** depends on all previous phases

### 6.3 Risk Buffer

Add 20% buffer for unknowns: **72 person-days total (14 weeks)**

---

## 7. Risks & Mitigations

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CC skill format changes | Medium | High | Monitor CC changelog, version lock skills |
| State file corruption | Low | Medium | Atomic writes, backups, checksums |
| Plugin security vulnerabilities | Medium | High | Sandbox, code review, verification badges |
| Performance degradation | Low | Medium | Lazy loading, caching, profiling |
| Compaction breaks state | Medium | High | Notepad pattern, state serialization |

### 7.2 Product Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Low plugin adoption | Medium | Medium | Dogfooding, marketing, featured plugins |
| Skill complexity barrier | High | High | Good docs, examples, templates |
| Marketplace fragmentation | Low | Medium | Curation, verification, guidelines |
| Enterprise governance needs | High | High | Managed skills, audit trails, RBAC |

### 7.3 Security Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Malicious plugins | Medium | Critical | Sandboxing, code signing, review process |
| Secrets in state files | Medium | High | Encryption, secret redaction, .gitignore |
| Plugin privilege escalation | Low | Critical | Permission model, scoped access |

---

## 8. Success Criteria

### 8.1 Technical Metrics

- [ ] All 5 phases completed on schedule
- [ ] 10+ bundled skills available
- [ ] 5+ community plugins published
- [ ] 0 P0 bugs in production
- [ ] <100ms skill discovery time
- [ ] <1s skill execution startup

### 8.2 Product Metrics

- [ ] 50% of Aegis sessions use skills
- [ ] 3+ internal plugins dogfooding
- [ ] Documentation coverage >90%
- [ ] NPS >50 from early adopters

### 8.3 Business Metrics

- [ ] Marketplace launched with 10+ plugins
- [ ] 100+ plugin downloads in first month
- [ ] 1+ enterprise pilot customer
- [ ] Blog post with 500+ views

---

## 9. Next Steps

### 9.1 Immediate Actions (This Week)

1. **Review this brief** with manudis23
2. **Create GitHub issue** for tracking (#XXX)
3. **Set up project board** with 6 phases
4. **Start Phase 1** — Skill discovery service

### 9.2 Decisions Needed

1. **Plugin scope priority** — User vs project vs managed?
2. **Marketplace hosting** — Self-hosted vs cloud?
3. **Verification strictness** — Required vs optional?
4. **Plugin pricing** — Free vs freemium vs paid?

### 9.3 Open Questions

1. Should skills be versioned independently from Aegis?
2. How to handle skill conflicts (same name, different sources)?
3. What's the plugin review process for marketplace?
4. How to monetize marketplace (if at all)?

---

## 10. References

### 10.1 Source Documents

- `/references/cc-analysis-ui-plugins.md` — Claude Code UI, plugins, services analysis
- `/references/omc-analysis-skills-plugins.md` — Oh-My-ClaudeCode deep-dive
- `/home/bubuntu/projects/aegis/src/hooks.ts` — Aegis hook receiver

### 10.2 External Resources

- Claude Code docs: https://docs.anthropic.com/en/docs/claude-code
- OMC repo: https://github.com/Yeachan-Heo/oh-my-claudecode
- Superpowers marketplace: https://github.com/obra/superpowers-marketplace

### 10.3 Related Issues

- #169 — HTTP hooks infrastructure
- #284 — Hook-based permission approval
- #336 — AskUserQuestion intercept
- #580 — Session ID validation

---

**Document History:**
- v1.0 (2026-04-01): Initial draft by Hephaestus

---

_"Skills are not just prompts—they're stateful workflow orchestrators."_
