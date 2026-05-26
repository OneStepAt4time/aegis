# Technical Brief: Tool Permission System Integration for Aegis

**Date:** April 1, 2026  
**Author:** Hephaestus (Aegis Lead Developer)  
**Status:** Draft  
**Target:** Aegis v0.4.0  

---

## Executive Summary

This brief proposes a comprehensive Tool Permission System for Aegis, modeled after Claude Code's production-grade architecture. The current Aegis implementation has only basic permission handling (single `permissionMode` per session), while Claude Code implements an 8-layer defense-in-depth system with rule evaluation, classifiers, and hook extensibility.

**Key Recommendations:**
1. Implement rule-based permission system with allow/deny/ask rules
2. Add rule evaluation engine with precedence-based source hierarchy
3. Integrate classifier-based auto-approval for common patterns
4. Design hook system for permission customization
5. Maintain backward compatibility with existing API

**Estimated Effort:** 10-15 days  
**Risk Level:** Medium (architectural changes, but well-scoped)

---

## 1. Current State: How Aegis Handles Permissions

### 1.1 Existing Implementation

Aegis currently has a **minimal permission system** consisting of:

#### A. Global Configuration (`src/config.ts`)

```typescript
export interface Config {
  /** Default permission mode for new sessions (default: "bypassPermissions").
   *  Values: "default" | "plan" | "acceptEdits" | "bypassPermissions" | "dontAsk" | "auto"
   */
  defaultPermissionMode: string;
}
```

**Limitations:**
- Single string value, no rule-based system
- No allow/deny/ask granularity
- No per-tool customization
- No pattern matching for tool inputs

#### B. Per-Session Permission Mode (`src/session.ts`)

```typescript
export interface SessionInfo {
  permissionMode: string;  // "default"|"plan"|"acceptEdits"|"bypassPermissions"|"dontAsk"|"auto"
  permissionStallMs: number;  // Per-session permission stall threshold
  
  // Latency tracking (Issue #87)
  permissionPromptAt?: number;      // When permission prompt was detected
  permissionRespondedAt?: number;   // When user approved/rejected
}
```

**Limitations:**
- Session-level only, no tool-level granularity
- No rule evaluation
- No decision reasons or metadata

**Limitations:**
- Session-level only, no tool-level granularity
- No rule evaluation
- No decision reasons or metadata

#### C. Permission Guard Workaround (`src/permission-guard.ts`)

This module addresses a **specific edge case**: Claude Code's settings files can override CLI flags. When `permissionMode` is NOT `bypassPermissions`, Aegis must neutralize any `bypassPermissions` found in:

1. `~/.claude/settings.json` (user-level)
2. `<project>/.claude/settings.json` (project-level, committed)
3. `<project>/.claude/settings.local.json` (project-level, local)

```typescript
export async function neutralizeBypassPermissions(
  workDir: string, 
  targetMode = 'default', 
  homeDir?: string
): Promise<boolean> {
  const locations = getAllSettingsLocations(workDir, homeDir ?? homedir());
  // Backs up and patches all 3 settings files
}
```

**Limitations:**
- This is a **workaround**, not a permission system
- Only handles one specific issue (bypassPermissions override)
- No rule evaluation, no flexibility

#### D. Hook-Based Permission Waiting (`src/session.ts`)

```typescript
export class SessionManager {
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  
  waitForPermissionDecision(
    sessionId: string,
    timeoutMs: number = 10_000,
    toolName?: string,
    prompt?: string,
  ): Promise<PermissionDecision> {
    // Returns promise that resolves when client approves/rejects via API
  }
  
  async approve(id: string): Promise<void> {
    // Resolve pending hook-based permission first
    // Fallback: tmux send-keys
  }
}
```

**Limitations:**
- Binary allow/deny only, no nuanced decisions
- No rule-based auto-approval
- No tool-specific logic

### 1.2 API Surface

Current API endpoints related to permissions:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/sessions` | POST | Creates session with optional `permissionMode` |
| `/v1/sessions/:id/approve` | POST | Approves pending permission |
| `/v1/sessions/:id/reject` | POST | Rejects pending permission |
| `/v1/sessions/:id/hooks/permission` | POST | Receives PermissionRequest hooks |

**Missing:**
- No endpoint to query permission rules
- No endpoint to add/remove rules
- No endpoint to get permission decision reasons
- No batch permission operations

### 1.3 Summary of Current Limitations

| Feature | Aegis | Claude Code |
|---------|-------|-------------|
| Permission modes | ✅ 6 modes | ✅ 7 modes |
| Rule-based system | ❌ | ✅ 8-layer system |
| Allow/deny/ask rules | ❌ | ✅ |
| Rule precedence | ❌ | ✅ 8 sources |
| Tool-specific permissions | ❌ | ✅ |
| Pattern matching | ❌ | ✅ `Bash(git *)` |
| Classifier auto-approval | ❌ | ✅ |
| Hook extensibility | ⚠️ Basic | ✅ PreToolUse/PostToolUse |
| Permission decision reasons | ❌ | ✅ |
| Permission update suggestions | ❌ | ✅ |

---

## 2. Claude Code Permission Architecture

### 2.1 8-Layer Defense-in-Depth System

Claude Code uses a sophisticated layered approach:

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
│  5. Rule evaluation with precedence                              │
│  6. Permission modes                                             │
│  7. Classifier system                                            │
│  8. Hook extensibility                                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Permission Modes

```typescript
export type PermissionMode =
  | 'acceptEdits'       // Auto-accept file edits
  | 'bypassPermissions' // Auto-approve everything
  | 'default'           // Normal prompting
  | 'dontAsk'           // Auto-deny unknown
  | 'plan'              // Auto-approve reads, prompt for writes
  | 'auto'              // Classifier-based auto-approval
  | 'bubble'            // Bubble up to parent (subagents)
```

### 2.3 Permission Rules

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

**Rule Sources (in precedence order):**

| Priority | Source | Description |
|----------|--------|-------------|
| 1 | `cliArg` | Command-line flags (highest priority) |
| 2 | `command` | Per-command rules |
| 3 | `session` | Current session only |
| 4 | `flagSettings` | Environment variable flags |
| 5 | `policySettings` | Enterprise policy |
| 6 | `localSettings` | `.claude/settings.local.json` |
| 7 | `projectSettings` | `.claude/settings.json` |
| 8 | `userSettings` | `~/.claude/settings.json` |

### 2.4 Permission Decision Flow

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
}

export type PermissionAskDecision<Input> = {
  behavior: 'ask'
  message: string
  updatedInput?: Input
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]  // "Always allow Bash(git *)"
  blockedPath?: string
  metadata?: PermissionMetadata
}

export type PermissionDenyDecision = {
  behavior: 'deny'
  message: string
  decisionReason: PermissionDecisionReason
}
```

### 2.5 Decision Reasons

```typescript
export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'hook'; hookName: string; reason?: string }
  | { type: 'classifier'; classifier: 'bash_allow' | 'bash_deny' | 'auto-mode'; reason: string }
  | { type: 'sandboxOverride' }
  | { type: 'workingDir'; reason: string }
  | { type: 'safetyCheck'; reason: string }
  | { type: 'other'; reason: string }
```

### 2.6 Classifier System

Claude Code can **auto-approve** certain tool uses via classifiers:

1. **Bash Classifier**: Auto-approves safe commands (e.g., `git status`, `ls`, `npm run build`)
2. **Auto-Mode Classifier**: General-purpose classifier for `auto` permission mode
3. **Confidence Levels**: High (auto-approve), Medium (ask with suggestions), Low (always ask)
4. **Grace Period**: 2-second speculative check before falling back to dialog
5. **Tree-sitter AST Parsing**: For complex Bash command analysis

### 2.7 Hook System

```typescript
// PreToolUse hook can override permission decisions
export type PreToolUseHookResult = 
  | { behavior: 'allow'; reason: string }   // Force allow
  | { behavior: 'deny'; reason: string }    // Force deny
  | { behavior: 'ask'; suggestions: [] }    // Add suggestions
  | null  // Fall through to normal permission system
```

---

## 3. Gap Analysis: What Aegis is Missing

### 3.1 Critical Gaps

| Gap | Impact | Priority |
|-----|--------|----------|
| **No rule-based system** | Cannot express "allow Bash(git *) but deny Bash(rm *)" | P0 |
| **No rule precedence** | Cannot override session rules with CLI args | P0 |
| **No tool-specific permissions** | All tools treated uniformly | P1 |
| **No pattern matching** | Cannot express "allow Bash(npm run *)" | P1 |
| **No classifier integration** | Cannot auto-approve safe operations | P1 |
| **No hook extensibility** | Cannot customize permission logic | P2 |
| **No decision reasons** | Cannot explain WHY a decision was made | P2 |
| **No permission suggestions** | Cannot suggest "Always allow Bash(git *)" | P2 |

### 3.2 API Gaps

| Missing Endpoint | Purpose |
|------------------|---------|
| `GET /v1/permissions/rules` | List all permission rules |
| `POST /v1/permissions/rules` | Add a permission rule |
| `DELETE /v1/permissions/rules/:id` | Remove a permission rule |
| `GET /v1/permissions/evaluate` | Evaluate a hypothetical tool use |
| `POST /v1/sessions/:id/permissions/rules` | Add session-specific rule |

### 3.3 Data Model Gaps

**Current Aegis:**
```typescript
permissionMode: string
```

**Needed:**
```typescript
permissionMode: PermissionMode
permissionRules: PermissionRule[]
allowRules: PermissionRule[]
denyRules: PermissionRule[]
askRules: PermissionRule[]
```

### 3.4 Integration Gaps

| Component | Current | Needed |
|-----------|---------|--------|
| Hook receiver | Binary allow/deny | Rich decision with reasons |
| Permission guard | Settings patch only | Rule-based evaluation |
| Session creation | Single mode | Mode + rules + classifiers |
| API response | Simple status | Decision reasons + suggestions |

---

## 4. Proposed Architecture

### 4.1 Type Definitions

```typescript
// === Core Permission Types ===

export type PermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'
  | 'plan'
  | 'auto'
  | 'bubble';

export type PermissionBehavior = 'allow' | 'deny' | 'ask';

export type PermissionRuleSource =
  | 'cliArg'         // Highest priority
  | 'apiRequest'     // From API call
  | 'session'        // Session-specific rules
  | 'policySettings' // Enterprise policy
  | 'localSettings'  // .claude/settings.local.json
  | 'projectSettings' // .claude/settings.json
  | 'userSettings';  // ~/.claude/settings.json (lowest priority)

export interface PermissionRule {
  id: string;                    // UUID for management
  source: PermissionRuleSource;
  behavior: PermissionBehavior;
  toolName: string;              // e.g., "Bash", "Write", "*"
  pattern?: string;              // e.g., "git *" for Bash
  reason?: string;               // Human-readable reason
  createdAt: number;
  expiresAt?: number;            // Optional TTL
}

// === Permission Decisions ===

export interface PermissionDecisionReason {
  type: 'rule' | 'mode' | 'hook' | 'classifier' | 'default' | 'timeout';
  rule?: PermissionRule;
  mode?: PermissionMode;
  reason: string;
}

export interface PermissionAllowDecision {
  behavior: 'allow';
  reason: PermissionDecisionReason;
  updatedInput?: Record<string, unknown>;
}

export interface PermissionAskDecision {
  behavior: 'ask';
  reason: PermissionDecisionReason;
  message: string;
  suggestions?: PermissionSuggestion[];
}

export interface PermissionDenyDecision {
  behavior: 'deny';
  reason: PermissionDecisionReason;
  message: string;
}

export type PermissionDecision =
  | PermissionAllowDecision
  | PermissionAskDecision
  | PermissionDenyDecision;

export interface PermissionSuggestion {
  type: 'always_allow' | 'always_deny' | 'ask_next_time';
  label: string;
  rule: PermissionRule;
}

// === Permission Context ===

export interface ToolPermissionContext {
  mode: PermissionMode;
  rules: PermissionRule[];
  allowRules: PermissionRule[];
  denyRules: PermissionRule[];
  askRules: PermissionRule[];
  sessionId?: string;
  workDir?: string;
  isBypassPermissionsAvailable: boolean;
  isAutoModeAvailable: boolean;
}

// === API Types ===

export interface CreatePermissionRuleRequest {
  behavior: PermissionBehavior;
  toolName: string;
  pattern?: string;
  reason?: string;
  source?: PermissionRuleSource;
  expiresAt?: number;
}

export interface EvaluatePermissionRequest {
  toolName: string;
  toolInput: unknown;
  sessionId?: string;
}

export interface EvaluatePermissionResponse {
  decision: PermissionDecision;
  matchingRules: PermissionRule[];
}
```


### 4.2 Rule Evaluation Engine

The `PermissionEngine` class is the core of the permission system. It evaluates tool uses against rules and returns permission decisions.

**Key Responsibilities:**
1. Evaluate tool uses against allow/deny/ask rules
2. Apply rule precedence based on source
3. Pattern matching for tool inputs (commands, file paths)
4. Fall back to permission modes when no rules match
5. Generate suggestions for common patterns

**Evaluation Flow:**
```
1. Check bypass mode → if active, auto-allow
2. Check deny rules → if match, deny (fail-closed)
3. Check allow rules → if match, allow
4. Check ask rules → if match, prompt user
5. Fall back to permission mode → mode-specific behavior
```

**Pattern Matching:**
- **Bash commands**: `"git *"` matches `"git status"`, `"git commit"`, etc.
- **File paths**: `"*.ts"` matches any `.ts` file
- **Wildcards**: `"*"` matches any tool use

**Example Implementation:**
```typescript
export class PermissionEngine {
  private rules: PermissionRule[] = [];
  
  evaluate(
    toolName: string,
    toolInput: unknown,
    context: ToolPermissionContext,
  ): PermissionDecision {
    // 1. Bypass mode
    if (context.mode === 'bypassPermissions') {
      return { behavior: 'allow', reason: { type: 'mode', reason: 'Bypass mode' } };
    }
    
    // 2. Check deny rules (fail-closed)
    const denyRule = this.findMatchingRule(toolName, toolInput, context.denyRules);
    if (denyRule) {
      return { behavior: 'deny', reason: { type: 'rule', rule: denyRule } };
    }
    
    // 3. Check allow rules
    const allowRule = this.findMatchingRule(toolName, toolInput, context.allowRules);
    if (allowRule) {
      return { behavior: 'allow', reason: { type: 'rule', rule: allowRule } };
    }
    
    // 4. Check ask rules
    const askRule = this.findMatchingRule(toolName, toolInput, context.askRules);
    if (askRule) {
      return { 
        behavior: 'ask', 
        reason: { type: 'rule', rule: askRule },
        suggestions: this.generateSuggestions(toolName, toolInput)
      };
    }
    
    // 5. Fall back to mode
    return this.evaluateByMode(toolName, toolInput, context);
  }
  
  private findMatchingRule(
    toolName: string,
    toolInput: unknown,
    rules: PermissionRule[],
  ): PermissionRule | null {
    const sorted = this.sortByPrecedence(rules);
    for (const rule of sorted) {
      if (this.ruleMatches(rule, toolName, toolInput)) {
        return rule;
      }
    }
    return null;
  }
  
  private ruleMatches(
    rule: PermissionRule,
    toolName: string,
    toolInput: unknown,
  ): boolean {
    if (rule.toolName === '*') return true;
    if (rule.toolName !== toolName) return false;
    if (!rule.pattern) return true;
    return this.patternMatches(rule.pattern, toolInput);
  }
  
  private patternMatches(pattern: string, toolInput: unknown): boolean {
    const input = toolInput as Record<string, unknown>;
    
    // Bash command patterns
    if (input.command && typeof input.command === 'string') {
      if (pattern.endsWith(' *')) {
        const prefix = pattern.slice(0, -2);
        return input.command.startsWith(prefix + ' ') || input.command === prefix;
      }
      return input.command === pattern;
    }
    
    // File path patterns
    if (input.file_path && typeof input.file_path === 'string') {
      if (pattern.startsWith('*.')) return input.file_path.endsWith(pattern.slice(1));
      if (pattern.endsWith('/*')) return input.file_path.startsWith(pattern.slice(0, -2) + '/');
      return input.file_path === pattern;
    }
    
    // Generic glob matching
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return regex.test(JSON.stringify(input));
  }
  
  private sortByPrecedence(rules: PermissionRule[]): PermissionRule[] {
    const precedence = ['cliArg', 'apiRequest', 'session', 'policySettings', 'localSettings', 'projectSettings', 'userSettings'];
    return [...rules].sort((a, b) => precedence.indexOf(a.source) - precedence.indexOf(b.source));
  }
  
  private evaluateByMode(toolName: string, toolInput: unknown, context: ToolPermissionContext): PermissionDecision {
    // Mode-specific fallback logic (plan, acceptEdits, dontAsk, default, etc.)
    // See full implementation in the complete brief
  }
  
  private generateSuggestions(toolName: string, toolInput: unknown): PermissionSuggestion[] {
    // Generate "Always allow X" suggestions based on tool input
    // See full implementation in the complete brief
  }
}
```

**API:**
- `evaluate(toolName, toolInput, context)` → PermissionDecision
- `addRule(rule)` → void
- `removeRule(ruleId)` → boolean
- `getRules(filter?)` → PermissionRule[]

### 4.3 API Endpoints

```typescript
// src/routes/permissions.ts

import { FastifyInstance } from 'fastify';
import { PermissionEngine } from '../permission-engine.js';

export async function permissionRoutes(
  fastify: FastifyInstance,
  options: { engine: PermissionEngine }
) {
  const { engine } = options;
  
  // GET /v1/permissions/rules - List all permission rules
  fastify.get('/v1/permissions/rules', async (request, reply) => {
    const { toolName, behavior, source } = request.query as any;
    const rules = engine.getRules({ toolName, behavior, source });
    return { rules, total: rules.length };
  });
  
  // POST /v1/permissions/rules - Create a new permission rule
  fastify.post('/v1/permissions/rules', async (request, reply) => {
    const body = request.body as CreatePermissionRuleRequest;
    const rule = {
      id: crypto.randomUUID(),
      source: body.source || 'apiRequest',
      behavior: body.behavior,
      toolName: body.toolName,
      pattern: body.pattern,
      reason: body.reason,
      createdAt: Date.now(),
      expiresAt: body.expiresAt,
    };
    engine.addRule(rule);
    reply.code(201);
    return { rule };
  });
  
  // DELETE /v1/permissions/rules/:id - Remove a permission rule
  fastify.delete('/v1/permissions/rules/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = engine.removeRule(id);
    if (!removed) {
      reply.code(404);
      return { error: 'Rule not found' };
    }
    reply.code(204);
  });
  
  // POST /v1/permissions/evaluate - Evaluate a hypothetical tool use
  fastify.post('/v1/permissions/evaluate', async (request, reply) => {
    const body = request.body as EvaluatePermissionRequest;
    const context: ToolPermissionContext = {
      mode: 'default',
      rules: engine.getRules(),
      allowRules: engine.getRules({ behavior: 'allow' }),
      denyRules: engine.getRules({ behavior: 'deny' }),
      askRules: engine.getRules({ behavior: 'ask' }),
      isBypassPermissionsAvailable: true,
      isAutoModeAvailable: false,
    };
    const decision = engine.evaluate(body.toolName, body.toolInput, context);
    const matchingRules = engine.getRules({ toolName: body.toolName });
    return { decision, matchingRules };
  });
}
```

### 4.4 Integration with Session Creation

```typescript
// Updated src/session.ts

export interface SessionInfo {
  // ... existing fields ...
  
  // NEW: Permission engine per session
  permissionEngine?: PermissionEngine;
  
  // NEW: Permission rules (persisted)
  permissionRules: PermissionRule[];
}

// Updated createSession
async createSession(opts: {
  workDir: string;
  name?: string;
  // ... existing options ...
  
  // NEW: Permission configuration
  permissionMode?: PermissionMode;
  permissionRules?: CreatePermissionRuleRequest[];
}): Promise<SessionInfo> {
  // ... existing code ...
  
  // Create permission engine for this session
  const engine = new PermissionEngine();
  
  // Add initial rules
  if (opts.permissionRules) {
    for (const ruleReq of opts.permissionRules) {
      const rule: PermissionRule = {
        id: crypto.randomUUID(),
        source: 'apiRequest',
        behavior: ruleReq.behavior,
        toolName: ruleReq.toolName,
        pattern: ruleReq.pattern,
        reason: ruleReq.reason,
        createdAt: Date.now(),
        expiresAt: ruleReq.expiresAt,
      };
      engine.addRule(rule);
    }
  }
  
  const session: SessionInfo = {
    // ... existing fields ...
    permissionMode: effectivePermissionMode,
    permissionEngine: engine,
    permissionRules: engine.getRules(),
  };
  
  // ... rest of creation logic ...
}
```

---

## 5. Migration Path

### 5.1 Phase 1: Core Types and Engine (Days 1-3)

**Goal:** Implement type definitions and rule evaluation engine without breaking existing API.

**Changes:**
1. Add new type definitions to `src/types/permissions.ts`
2. Implement `PermissionEngine` class in `src/permission-engine.ts`
3. Add unit tests for rule evaluation
4. No API changes yet

**Validation:**
```bash
npm test -- permission-engine.test.ts
```

**Backward Compatibility:** 100% - no existing code touched

### 5.2 Phase 2: API Endpoints (Days 4-6)

**Goal:** Add new API endpoints for permission management.

**Changes:**
1. Add `src/routes/permissions.ts` with new endpoints
2. Register routes in `src/index.ts`
3. Add Zod validation schemas to `src/validation.ts`
4. Add API tests

**New Endpoints:**
- `GET /v1/permissions/rules`
- `POST /v1/permissions/rules`
- `DELETE /v1/permissions/rules/:id`
- `POST /v1/permissions/evaluate`

**Validation:**
```bash
npm test -- routes/permissions.test.ts
```

**Backward Compatibility:** 100% - new endpoints only

### 5.3 Phase 3: Session Integration (Days 7-9)

**Goal:** Integrate permission engine with session creation and management.

**Changes:**
1. Add `permissionEngine` and `permissionRules` to `SessionInfo`
2. Update `createSession()` to accept `permissionRules` option
3. Update `POST /v1/sessions` schema to include `permissionRules`
4. Persist permission rules in `state.json`

**Validation:**
```bash
npm test -- session.test.ts
```

**Backward Compatibility:** 95%
- Existing sessions continue to work
- `permissionRules` is optional in API
- Default behavior unchanged if not provided

### 5.4 Phase 4: Hook Integration (Days 10-12)

**Goal:** Use permission engine in hook handlers.

**Changes:**
1. Update `handlePermissionRequest` to use `PermissionEngine`
2. Store decision reasons in session state
3. Return suggestions in hook responses
4. Update `POST /v1/sessions/:id/approve` to accept rule suggestions

**Validation:**
```bash
npm test -- hooks/permission.test.ts
```

**Backward Compatibility:** 90%
- Hook response format may change (add `suggestions` field)
- Existing clients should handle new fields gracefully

### 5.5 Phase 5: Classifier Integration (Days 13-15) - OPTIONAL

**Goal:** Integrate classifier-based auto-approval.

**Changes:**
1. Implement basic classifier for Bash commands
2. Add classifier integration to `PermissionEngine`
3. Add `auto` mode support
4. Add telemetry for classifier accuracy

**Validation:**
```bash
npm test -- classifier.test.ts
```

**Backward Compatibility:** 100%
- Classifier is optional enhancement
- Falls back to rule evaluation if classifier unavailable

### 5.6 Deprecation Path

**Version 0.4.0:**
- New permission system available
- Old `permissionMode` still works
- `autoApprove` deprecated (use `permissionMode: 'bypassPermissions'`)

**Version 0.5.0:**
- `autoApprove` removed
- Warning logs if using simple `permissionMode` without rules

**Version 1.0.0:**
- Full deprecation of simple mode
- `permissionMode` requires at least one rule

---

## 6. Effort Estimate

### 6.1 Breakdown by Component

| Component | Effort | Complexity | Risk |
|-----------|--------|------------|------|
| Type definitions | 0.5 days | Low | Low |
| Rule evaluation engine | 2 days | Medium | Medium |
| API endpoints | 2 days | Low | Low |
| Session integration | 2 days | Medium | Medium |
| Hook integration | 2 days | Medium | High |
| Classifier integration | 2 days | High | High |
| Testing | 2 days | Medium | Low |
| Documentation | 1 day | Low | Low |
| **Total** | **13.5 days** | | |

### 6.2 Realistic Estimate

**Optimistic:** 10 days (all goes smoothly)  
**Realistic:** 13 days (some rework needed)  
**Pessimistic:** 18 days (classifier integration issues, edge cases)

**Recommended:** 15 days budget (includes buffer for testing and documentation)

### 6.3 Parallel Work Opportunities

- Types + Engine can be developed in parallel with API design
- Testing can start after Phase 1 (write tests as you go)
- Documentation can be written incrementally

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Rule evaluation bugs** | Medium | High | Comprehensive unit tests, property-based testing |
| **Pattern matching complexity** | Medium | Medium | Start with simple globs, defer regex |
| **Performance regression** | Low | Medium | Benchmark rule evaluation, lazy loading |
| **State file bloat** | Low | Low | TTL for rules, cleanup on session end |
| **Hook timeout issues** | Medium | High | Async rule evaluation, streaming responses |
| **Classifier accuracy** | High | Medium | Conservative defaults, telemetry, manual override |

### 7.2 Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Breaking existing clients** | Low | High | Extensive backward compat testing |
| **Hook response format change** | Medium | Medium | Version API, graceful degradation |
| **Session state migration** | Low | Medium | Migration script, fallback to defaults |
| **CC version compatibility** | Low | Low | Test with multiple CC versions |

### 7.3 Operational Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Rule misconfiguration** | High | High | Validation, dry-run mode, audit logs |
| **Unexpected denies** | Medium | Medium | Detailed decision reasons, easy override |
| **Permission fatigue** | Medium | Low | Good defaults, classifier auto-approval |
| **Security regression** | Low | Critical | Security review, penetration testing |

### 7.4 Mitigation Strategies

1. **Fail-Closed Defaults**: When in doubt, deny (matches CC's approach)
2. **Comprehensive Logging**: Log every decision with reasons
3. **Dry-Run Mode**: Evaluate rules without enforcing (for testing)
4. **Gradual Rollout**: Feature flag for new permission system
5. **Rollback Plan**: Revert to simple mode if issues detected

### 7.5 Testing Strategy

```bash
# Unit tests
npm test -- permission-engine.test.ts

# Integration tests
npm test -- routes/permissions.test.ts
npm test -- session-permissions.test.ts
npm test -- hooks/permission.test.ts

# Property-based tests (find edge cases)
npm test -- permission-engine.property.test.ts

# Load tests (benchmark rule evaluation)
npm run test:load -- permission-benchmark.ts

# Security tests (injection, bypass attempts)
npm run test:security -- permission-security.test.ts
```

---

## 8. Success Criteria

### 8.1 Functional Requirements

- [ ] Can create permission rules via API
- [ ] Can evaluate tool uses against rules
- [ ] Rules have correct precedence
- [ ] Pattern matching works for common cases
- [ ] Decision reasons are accurate and helpful
- [ ] Suggestions are generated for common patterns
- [ ] Backward compatibility maintained

### 8.2 Non-Functional Requirements

- [ ] Rule evaluation < 10ms (99th percentile)
- [ ] No memory leaks from rule storage
- [ ] API response time unchanged (< 50ms overhead)
- [ ] 100% backward compatibility for existing clients

### 8.3 Quality Gates

```bash
# Must pass before merge
npx tsc --noEmit
npm run build
npm test  # All tests pass
npm run lint
```

---

## 9. Future Enhancements (Out of Scope)

These are **NOT** part of this brief but could be added later:

1. **Classifier-based auto-approval** (Phase 5)
2. **Enterprise policy integration** (policySettings source)
3. **Rule templates** (predefined rule sets for common scenarios)
4. **Rule analytics** (which rules are used most)
5. **Rule sharing** (export/import rules between sessions)
6. **Natural language rules** ("allow git commands" → "Bash(git *)")
7. **External permission services** (delegate decisions to external API)
8. **Rule versioning** (track changes, rollback)

---

## 10. References

### 10.1 Source Files Analyzed

- `/home/bubuntu/.openclaw/workspace-aegis/references/cc-analysis-tool-system.md` - CC tool system analysis
- `/home/bubuntu/projects/aegis/.claude-internals/claude-code-leaked/source/src/Tool.ts` - CC Tool interface
- `/home/bubuntu/projects/aegis/src/permission-guard.ts` - Current Aegis permission guard
- `/home/bubuntu/projects/aegis/src/config.ts` - Aegis configuration
- `/home/bubuntu/projects/aegis/src/validation.ts` - Aegis validation schemas
- `/home/bubuntu/projects/aegis/src/session.ts` - Aegis session management

### 10.2 Related Issues

- Issue #102: Permission guard for settings override
- Issue #169: Hook settings file generation
- Issue #87: Latency metrics for permissions
- Issue #88: Subagent permission handling
- Issue #284: Hook-based permission resolution

---

## Appendix A: Example API Usage

### A.1 Create Session with Permission Rules

```bash
POST /v1/sessions
Content-Type: application/json

{
  "workDir": "/home/user/my-project",
  "name": "dev-session",
  "permissionMode": "default",
  "permissionRules": [
    {
      "behavior": "allow",
      "toolName": "Bash",
      "pattern": "git *",
      "reason": "Git commands are safe"
    },
    {
      "behavior": "allow",
      "toolName": "Bash",
      "pattern": "npm run *",
      "reason": "NPM scripts are safe"
    },
    {
      "behavior": "deny",
      "toolName": "Bash",
      "pattern": "rm -rf /",
      "reason": "Dangerous command"
    }
  ]
}
```

### A.2 Evaluate a Tool Use

```bash
POST /v1/permissions/evaluate
Content-Type: application/json

{
  "toolName": "Bash",
  "toolInput": {
    "command": "git status"
  },
  "sessionId": "abc-123"
}

Response:
{
  "decision": {
    "behavior": "allow",
    "reason": {
      "type": "rule",
      "rule": {
        "id": "rule-1",
        "source": "apiRequest",
        "behavior": "allow",
        "toolName": "Bash",
        "pattern": "git *",
        "reason": "Git commands are safe"
      },
      "reason": "Allowed by rule: Git commands are safe"
    }
  },
  "matchingRules": [
    { ... rule-1 ... }
  ]
}
```

### A.3 Add Rule to Existing Session

```bash
POST /v1/sessions/abc-123/permissions/rules
Content-Type: application/json

{
  "behavior": "allow",
  "toolName": "Write",
  "pattern": "*.ts",
  "reason": "TypeScript files are safe to write"
}

Response:
{
  "rule": {
    "id": "rule-new",
    "source": "session",
    "behavior": "allow",
    "toolName": "Write",
    "pattern": "*.ts",
    "reason": "TypeScript files are safe to write",
    "createdAt": 1712000000000
  }
}
```

---

**End of Brief**

---

*Generated by Hephaestus, Lead Developer of Aegis*  
*Workspace: ~/.openclaw/workspace-aegis*  
*Date: April 1, 2026*
