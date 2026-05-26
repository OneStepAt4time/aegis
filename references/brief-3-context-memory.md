# Brief 3: Context Compaction & Memory System Integration

**Author:** Hephaestus (via subagent)
**Date:** 2026-04-01
**Status:** Draft
**Priority:** P0 — Critical for long-running sessions

---

## Executive Summary

This brief outlines how to integrate Claude Code's context compaction and memory architecture into Aegis. The goal is to enable **long-running autonomous sessions** that can exceed model context windows while maintaining coherent conversation state and persistent knowledge.

**Key Insight:** Claude Code's compaction system is **cache-aware** — it uses a forked agent pattern that shares the prompt cache prefix with the main conversation, saving ~50-70K tokens per compact. Combined with OMC's **notepad system** for compaction-resistant state, this creates a powerful pattern for persistent agentic workflows.

---

## 1. Current State: How Aegis Handles Context/Transcripts Today

### 1.1 Session Management (`session.ts`)

Aegis tracks sessions with the following context-related fields:

```typescript
interface SessionInfo {
  id: string;                    // Aegis session ID (UUID)
  windowId: string;              // tmux window ID
  claudeSessionId?: string;      // CC's own session ID
  jsonlPath?: string;            // Path to the JSONL transcript
  byteOffset: number;            // Last read byte offset (for API reads)
  monitorOffset: number;         // Last read byte offset (for monitor)
  status: UIState;               // Current UI state
  // ...
}
```

**Key Behaviors:**
- **Offset-based reading**: Two separate offsets (API vs monitor) for incremental transcript reads
- **JSONL discovery**: Hook-based (via `session_map.json`) + filesystem-based fallback
- **Parsed entries cache**: `MAX_CACHE_ENTRIES_PER_SESSION = 10_000` with LRU eviction
- **No context window awareness**: Aegis doesn't know CC's context window size or current usage

### 1.2 Transcript Parsing (`transcript.ts`)

**Current capabilities:**
- Parse JSONL entries into structured messages (text, thinking, tool_use, tool_result)
- Incremental reading from byte offset
- Tool summarization (e.g., `📖 Read file.ts`)
- **No token counting**: Messages are counted, not tokens
- **No compaction awareness**: Aegis doesn't know when CC compacts

### 1.3 JSONL Watching (`jsonl-watcher.ts`)

**Current capabilities:**
- fs.watch-based real-time monitoring
- Debounced reads (100ms default)
- Truncation detection (for `/clear` commands)
- **No compaction event detection**: Compaction is invisible to Aegis

### 1.4 Gaps in Current Architecture

| Gap | Impact |
|-----|--------|
| No token counting | Cannot predict when context will fill |
| No compaction awareness | Lost context is invisible to orchestrators |
| No persistent memory | Knowledge dies with each compact |
| No cache-aware API | Cannot share prompt cache with CC |
| No context budgeting | Cannot allocate tokens per concern |

---

## 2. Claude Code Architecture: Context & Compaction

### 2.1 Dual Context Layers

CC separates context into two memoized layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  SYSTEM CONTEXT (getSystemContext)                               │
│  - Git status (branch, commits, file changes)                   │
│  - Cache breaker (ant-only, ephemeral)                          │
│  - Cached for entire conversation                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  USER CONTEXT (getUserContext)                                   │
│  - CLAUDE.md files (project hierarchy)                          │
│  - Current date (ISO format)                                    │
│  - Cached for entire conversation                                │
└─────────────────────────────────────────────────────────────────┘
```

**Key Code (from context.ts):**
```typescript
export const getSystemContext = memoize(async () => {
  const gitStatus = shouldIncludeGitInstructions()
    ? await getGitStatus()
    : null;
  return { ...(gitStatus && { gitStatus }) };
});

export const getUserContext = memoize(async () => {
  const claudeMd = shouldDisableClaudeMd
    ? null
    : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()));
  return { ...(claudeMd && { claudeMd }), currentDate: ... };
});
```

**Implication for Aegis:** Context is expensive to rebuild. Memoization at the CC level means Aegis should avoid triggering context rebuilds unless necessary.

### 2.2 Cache-Aware Compaction

**The Problem:** When CC's context fills up, it compacts by summarizing old messages. A naive implementation would:
1. Send entire transcript to a separate summarization API call
2. This creates a ~50-70K token cache miss (system prompt, tools, context not shared)

**CC's Solution:** Forked agent pattern with cache sharing

```
Main Conversation (200K context)
├── System Prompt (cached)
├── Tools (cached)
├── System Context (cached)
├── User Context (cached)
├── [Messages to compact]
└── [Preserved tail messages]

        │
        ▼ (fork with shared cache)

Forked Compaction Agent
├── System Prompt (HIT: shared from main)
├── Tools (HIT: shared from main)
├── System Context (HIT: shared from main)
├── User Context (HIT: shared from main)
├── [Summary request]
└── [Messages to compact]
```

**Savings:** ~50-70K tokens per compact (cache hit on shared prefix)

### 2.3 Compaction Triggers

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Auto-compact | 90% context usage | Summarize oldest messages |
| Manual compact | User invokes `/compact` | Summarize from/to selector |
| Partial compact | User selects pivot | Compact around specific message |
| Reactive microcompact | Per-turn | Trim if approaching limit |

**Compaction Process:**
1. Pre-compact hooks fire
2. Count tokens (pre-compaction)
3. Strip images from old messages
4. Generate summary via forked agent
5. Restore critical context (files, skills, plan)
6. Post-compact hooks fire
7. Session start hooks re-run

### 2.4 Post-Compact Context Restoration

**Budget Partitioning:**
```typescript
const POST_COMPACT_TOKEN_BUDGET = 50_000;        // Total for restoration
const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;     // Max files
const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;  // Per-file cap
const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000; // Skills budget
const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000; // Per-skill cap
```

**Restoration Priority:**
1. Recent file reads (re-read to validate freshness)
2. Invoked skills (truncated per-skill)
3. Active plan file
4. Plan mode instructions
5. Deferred tool schemas
6. MCP instructions
7. Agent listings

### 2.5 Message Grouping for Compaction

**Key Insight:** Compaction operates on **API round boundaries**, not human turns.

```
API Round 1:
  user: "Read file.ts"
  assistant: [tool_use: Read]
  user: [tool_result: content]

API Round 2:
  assistant: [text: "Here's what I found..."]
  user: "Now edit it"
  assistant: [tool_use: Edit]
  user: [tool_result: success]
```

**Why:** Ensures tool_use/tool_result pairs stay together. Finer granularity than human turns.

### 2.6 Prompt-Too-Long Recovery

When compact request itself hits prompt-too-long:
1. Group messages by API round
2. Drop oldest groups to cover token gap
3. Retry compact with truncated history
4. Max 3 retries before failing

---

## 3. OMC Notepad: Compaction-Resistant State Persistence

### 3.1 The Notepad Concept

OMC introduces a **compaction-resistant memory layer** that persists across context compaction:

```
.omc/
├── notepad.md              # Global memo (survives compaction)
├── project-memory.json     # Project knowledge (cross-session)
└── notepads/{plan-name}/   # Per-plan wisdom
    ├── learnings.md
    ├── decisions.md
    ├── issues.md
    └── problems.md
```

### 3.2 Notepad MCP Tools

```typescript
// Read the notepad
notepad_read(): string

// Write to priority section (permanent retention)
notepad_write_priority(content: string): void

// Write to working section (retained for 7 days)
notepad_write_working(content: string): void
```

**Persistence Tags:**
```xml
<!-- Retained for 7 days -->
<remember>API endpoint changed to /v2</remember>

<!-- Retained permanently -->
<remember priority>Never access production DB directly</remember>
```

### 3.3 Pre-Compact Hook Integration

OMC's `PreCompact` hook saves critical info to notepad before compaction:

```typescript
// Hook fires before CC compacts
function preCompactHook(sessionId: string) {
  // 1. Extract critical context from transcript
  const criticalInfo = extractCriticalContext(sessionId);
  
  // 2. Write to notepad
  notepad_write_working(\`
    <remember>
    ## Pre-Compact State (\${new Date().toISOString()})
    - Current task: \${criticalInfo.currentTask}
    - Active files: \${criticalInfo.activeFiles.join(', ')}
    - Pending decisions: \${criticalInfo.pendingDecisions}
    - Blockers: \${criticalInfo.blockers}
    </remember>
  \`);
}
```

### 3.4 Session-Scoped State

```
.omc/state/sessions/{sessionId}/
├── autopilot-state.json
├── ralph-state.json
├── team/
└── progress.txt
```

**Enables:**
- Multiple concurrent sessions on same project
- State isolation between sessions
- Crash recovery per session

---

## 4. Gap Analysis: What Aegis Is Missing

### 4.1 Context Window Management

| Capability | CC Has | Aegis Has | Gap |
|------------|--------|-----------|-----|
| Token counting | ✅ | ❌ | Cannot predict context fill |
| Context window size detection | ✅ | ❌ | Don't know limits |
| Auto-compact threshold | ✅ (90%) | ❌ | No proactive management |
| Compaction hooks | ✅ | ❌ | No visibility into compacts |
| Cache-aware API | ✅ | ❌ | No prompt cache sharing |

### 4.2 Memory Persistence

| Capability | CC Has | OMC Has | Aegis Has | Gap |
|------------|--------|---------|-----------|-----|
| Session-scoped memory | ❌ | ✅ | ❌ | Lost on compact |
| Project-scoped memory | ❌ | ✅ | ❌ | No cross-session knowledge |
| Compaction-resistant storage | ❌ | ✅ | ❌ | Critical info dies |
| Per-plan wisdom | ❌ | ✅ | ❌ | No plan-level context |

### 4.3 Observability

| Capability | CC Has | Aegis Has | Gap |
|------------|--------|-----------|-----|
| Token usage per message | ✅ | ❌ | No cost visibility |
| Compaction events | ✅ | ❌ | Invisible context loss |
| Context breakdown by tool | ✅ | ❌ | No optimization hints |
| Duplicate read detection | ✅ | ❌ | No efficiency metrics |

### 4.4 Critical Missing Pieces

1. **Context Window API**
   - Cannot query CC's context window size
   - Cannot get current token usage
   - Cannot predict when compact will trigger

2. **Compaction Events**
   - PreCompact/PostCompact hooks not exposed to Aegis
   - No way to save state before compact
   - No way to restore state after compact

3. **Persistent Memory**
   - No notepad equivalent
   - No project-memory.json equivalent
   - No session-scoped state persistence

4. **Token Counting**
   - No token estimation for messages
   - No budget allocation per concern
   - No context efficiency metrics

---

## 5. Proposed Architecture

### 5.1 Context Window Management API

**New Aegis API endpoints:**

```typescript
// GET /v1/sessions/:id/context
interface ContextInfo {
  // From CC (if available via hook)
  contextWindow: number;         // e.g., 200000
  currentUsage: number;          // e.g., 145000
  usagePercent: number;          // e.g., 72.5%
  
  // Estimated (if CC doesn't expose)
  estimatedUsage: number;
  estimationMethod: 'transcript-size' | 'message-count';
  
  // Compaction status
  lastCompactedAt?: number;
  compactCount: number;
  
  // Budget allocation
  budgets: {
    system: number;              // System prompt + tools
    context: number;             // Git + CLAUDE.md
    files: number;               // Recent file reads
    skills: number;              // Invoked skills
    transcript: number;          // Conversation history
  };
}

// POST /v1/sessions/:id/context/compact
interface CompactRequest {
  trigger: 'auto' | 'manual';
  fromMessageId?: string;        // Partial compact
  preserveSkills?: boolean;
  preserveFiles?: string[];      // Specific files to re-read
}

// GET /v1/sessions/:id/context/stats
interface ContextStats {
  tokenBreakdown: {
    humanMessages: number;
    assistantMessages: number;
    toolRequests: number;
    toolResults: number;
    attachments: number;
  };
  perToolUsage: Record<string, number>;
  duplicateReads: Array<{ file: string; count: number; tokens: number }>;
  efficiency: {
    uniqueContentPercent: number;
    duplicatePercent: number;
  };
}
```

### 5.2 Compaction Strategy

**When to Compact:**

| Trigger | Condition | Action |
|---------|-----------|--------|
| Proactive | Usage > 80% | Warn orchestrator |
| Auto | Usage > 90% | Compact automatically |
| Manual | Orchestrator request | Compact on demand |
| Reactive | Prompt-too-long error | Emergency compact + retry |

**How to Compact (Aegis-managed):**

Since Aegis cannot directly invoke CC's compaction, we use a **prompt-based strategy**:

```typescript
async function requestCompaction(sessionId: string): Promise<void> {
  // 1. Save critical state to notepad
  await saveToNotepad(sessionId, {
    currentTask: await extractCurrentTask(sessionId),
    activeFiles: await extractActiveFiles(sessionId),
    pendingDecisions: await extractPendingDecisions(sessionId),
    blockers: await extractBlockers(sessionId),
  });
  
  // 2. Send compact command to CC
  await sendMessage(sessionId, '/compact');
  
  // 3. Wait for PostCompact hook (if available) or idle state
  await waitForCompactionComplete(sessionId);
  
  // 4. Restore critical context
  await restoreContext(sessionId);
}
```

**Cache-Aware Compaction (Future):**

If CC exposes a compaction API:
```typescript
// Hypothetical future API
const result = await ccApi.compact({
  sessionId: session.claudeSessionId,
  shareCacheWith: session.claudeSessionId,  // Forked agent pattern
  preserveRecent: 5,                         // Keep last 5 file reads
  preserveSkills: true,
});
```

### 5.3 Memory/Notepad System

**Architecture:**

```
~/.aegis/
├── memory/
│   ├── global.json              # Global Aegis knowledge
│   └── projects/
│       └── {project-hash}/
│           ├── project-memory.json   # Project-scoped knowledge
│           └── sessions/
│               └── {session-id}/
│                   ├── notepad.md     # Session notepad
│                   ├── state.json     # Session state
│                   └── learnings.md   # Session learnings
```

**API Endpoints:**

```typescript
// GET /v1/sessions/:id/memory
interface MemoryResponse {
  notepad: string;               // Current notepad content
  projectMemory: object;         // Project-scoped knowledge
  learnings: string[];           // Session learnings
}

// POST /v1/sessions/:id/memory
interface MemoryUpdateRequest {
  action: 'append' | 'prepend' | 'replace';
  section: 'notepad' | 'priority' | 'working';
  content: string;
  ttl?: 'permanent' | '7d' | '24h';
}

// POST /v1/sessions/:id/memory/sync
// Sync memory to CC's context (inject as CLAUDE.md or prompt)
```

**Pre-Compact Hook Handler:**

```typescript
// In hook receiver
async function handlePreCompact(sessionId: string, payload: PreCompactPayload) {
  // 1. Extract critical context from transcript
  const entries = await readTranscript(sessionId);
  const critical = extractCriticalContext(entries);
  
  // 2. Save to notepad
  await appendNotepad(sessionId, \`
<remember priority>
## Pre-Compact Snapshot (\${new Date().toISOString()})
- Current task: \${critical.currentTask}
- Active files: \${critical.activeFiles.join(', ')}
- Pending: \${critical.pending.join(', ')}
- Blockers: \${critical.blockers.join(', ')}
- Last tool: \${critical.lastTool}
</remember>
  \`);
  
  // 3. Update session metadata
  session.lastCompactedAt = Date.now();
  session.compactCount = (session.compactCount || 0) + 1;
  
  // 4. Emit event for orchestrators
  emit('session:compacting', { sessionId, reason: payload.reason });
}
```

**Post-Compact Hook Handler:**

```typescript
async function handlePostCompact(sessionId: string, payload: PostCompactPayload) {
  // 1. Read notepad
  const notepad = await readNotepad(sessionId);
  
  // 2. Inject notepad into CC's context
  // Option A: Send as message
  await sendMessage(sessionId, \`[MEMORY RESTORATION]\\n\${notepad}\`);
  
  // Option B: Write to CLAUDE.md (if project-scoped)
  await appendClaudeMd(session.workDir, notepad);
  
  // 3. Re-read recent files (context restoration)
  for (const file of payload.preservedFiles || []) {
    await sendMessage(sessionId, \`Re-read \${file} for context restoration.\`);
  }
  
  // 4. Emit event
  emit('session:compacted', { 
    sessionId, 
    tokensSaved: payload.tokensSaved,
    messagesSummarized: payload.messagesSummarized,
  });
}
```

### 5.4 Integration with CC Session Lifecycle

**Enhanced SessionInfo:**

```typescript
interface SessionInfo {
  // ... existing fields ...
  
  // Context management
  contextWindow?: number;        // From hook or config
  estimatedTokens?: number;      // Estimated usage
  lastCompactedAt?: number;      // Last compact timestamp
  compactCount: number;          // Total compacts
  
  // Memory
  notepadPath?: string;          // Path to session notepad
  projectMemoryPath?: string;    // Path to project memory
  
  // Budget tracking
  tokenBudgets?: {
    system: number;
    context: number;
    files: number;
    skills: number;
    transcript: number;
  };
}
```

**Hook Integration:**

```typescript
// Add to hook receiver (src/hooks.ts)
const COMPACT_HOOKS = ['PreCompact', 'PostCompact'];

async function handleHook(sessionId: string, hook: HookPayload) {
  switch (hook.hook_event_name) {
    case 'PreCompact':
      await handlePreCompact(sessionId, hook);
      break;
    case 'PostCompact':
      await handlePostCompact(sessionId, hook);
      break;
    // ... existing handlers ...
  }
}
```

**Context Estimation (without CC API):**

```typescript
// Rough token estimation (4 chars/token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Estimate session context usage
async function estimateContextUsage(session: SessionInfo): Promise<number> {
  if (!session.jsonlPath) return 0;
  
  const entries = await readAllEntries(session.jsonlPath);
  let total = 0;
  
  // System overhead (estimated)
  total += 20_000; // System prompt + tools
  
  // Context files (CLAUDE.md, git status)
  total += 10_000; // Estimated
  
  // Transcript
  for (const entry of entries) {
    total += estimateTokens(entry.text);
    if (entry.toolName === 'Read') {
      // File reads can be large
      total += 2_000; // Estimated average
    }
  }
  
  return total;
}
```

---

## 6. Aegis Advantage: HTTP API for External Context Management

### 6.1 Unique Positioning

Aegis's HTTP API provides a **unique advantage** over direct CC usage:

| Capability | CC CLI | Aegis HTTP |
|------------|--------|------------|
| Query context usage | ❌ | ✅ |
| Request compaction | Manual | ✅ Programmatic |
| Inspect memory | ❌ | ✅ |
| Sync memory | ❌ | ✅ |
| Context stats | ❌ | ✅ |
| Webhook on compact | ❌ | ✅ |
| External orchestrator integration | ❌ | ✅ |

### 6.2 External Orchestrator Integration

**Example: AI Orchestrator managing long-running task**

```python
# External orchestrator (e.g., n8n, Temporal, custom)
async def manage_long_task(session_id: str, task: str):
    # 1. Check context before starting
    context = await aegis.get(f"/v1/sessions/{session_id}/context")
    if context.usage_percent > 80:
        # Proactively compact
        await aegis.post(f"/v1/sessions/{session_id}/context/compact")
    
    # 2. Save task to notepad (survives compaction)
    await aegis.post(f"/v1/sessions/{session_id}/memory", json={
        "action": "prepend",
        "section": "priority",
        "content": f"<remember priority>Current task: {task}</remember>"
    })
    
    # 3. Send task to CC
    await aegis.post(f"/v1/sessions/{session_id}/message", json={
        "text": task
    })
    
    # 4. Monitor for compaction events
    async for event in aegis.subscribe(f"/v1/sessions/{session_id}/events"):
        if event.type == "session:compacted":
            # Re-inject critical context after compact
            await aegis.post(f"/v1/sessions/{session_id}/memory/sync")
```

### 6.3 Dashboard Integration

**Context Health Widget:**

```typescript
// Dashboard can show real-time context health
const contextInfo = await fetch(\`/v1/sessions/\${sessionId}/context\`);

return (
  <Widget title="Context Health">
    <ProgressBar value={contextInfo.usagePercent} max={100} color={getColor(contextInfo.usagePercent)} />
    <Stat label="Usage" value={\`\${contextInfo.currentUsage.toLocaleString()} / \${contextInfo.contextWindow.toLocaleString()\} />
    <Stat label="Last Compact" value={formatRelative(contextInfo.lastCompactedAt)} />
    <Stat label="Compact Count" value={contextInfo.compactCount} />
    <Button onClick={() => compact(sessionId)} disabled={contextInfo.usagePercent < 70}>
      Compact Now
    </Button>
  </Widget>
);
```

**Context Stats View:**

```typescript
const stats = await fetch(\`/v1/sessions/\${sessionId}/context/stats\`);

return (
  <Panel title="Token Breakdown">
    <PieChart data={stats.tokenBreakdown} />
    <Table data={stats.perToolUsage} />
    <Alert if={stats.efficiency.duplicatePercent > 20}>
      Warning: {stats.efficiency.duplicatePercent}% duplicate content
    </Alert>
  </Panel>
);
```

### 6.4 Webhook Notifications

```typescript
// Aegis can notify external systems on compaction
POST /v1/webhooks
{
  "events": ["session:compacting", "session:compacted"],
  "url": "https://orchestrator.example.com/aegis-webhook"
}

// Webhook payload
{
  "event": "session:compacted",
  "sessionId": "abc123",
  "timestamp": 1712000000000,
  "data": {
    "tokensSaved": 45000,
    "messagesSummarized": 23,
    "newUsagePercent": 45
  }
}
```

---

## 7. Migration Path

### Phase 1: Context Observability (Week 1-2)

**Goal:** Make context visible without changing behavior

**Tasks:**
1. **Add token estimation**
   - Implement `estimateTokens()` in transcript.ts
   - Add `estimatedTokens` to SessionInfo
   - Expose via `GET /v1/sessions/:id/context`

2. **Track compaction events**
   - Add `PreCompact` / `PostCompact` hook handlers
   - Update `lastCompactedAt`, `compactCount`
   - Emit events for orchestrators

3. **Context stats endpoint**
   - Implement `GET /v1/sessions/:id/context/stats`
   - Token breakdown by type
   - Duplicate read detection

**Deliverable:** Context health visible in API + dashboard

**Validation:**
- API returns context usage estimate
- Dashboard shows context health widget
- Compaction events are logged

### Phase 2: Memory System (Week 3-4)

**Goal:** Persistent knowledge across compaction

**Tasks:**
1. **Notepad implementation**
   - Create `~/.aegis/memory/` directory structure
   - Implement `readNotepad()`, `appendNotepad()`
   - Add `GET/POST /v1/sessions/:id/memory`

2. **Pre-Compact hook integration**
   - Extract critical context from transcript
   - Save to notepad before compact
   - Test with manual `/compact` commands

3. **Post-Compact restoration**
   - Read notepad after compact
   - Inject into CC via message or CLAUDE.md
   - Verify knowledge survives compact

**Deliverable:** Compaction-resistant memory

**Validation:**
- Notepad persists across `/compact`
- Critical context restored after compact
- API allows external memory management

### Phase 3: Proactive Compaction (Week 5-6)

**Goal:** Prevent context overflow

**Tasks:**
1. **Auto-compact threshold**
   - Add config: `autoCompactThreshold: 0.9`
   - Monitor context usage
   - Trigger `/compact` when threshold hit

2. **Proactive warning**
   - Warn at 80% usage
   - Expose via events + API
   - Dashboard widget

3. **Budget allocation**
   - Track per-concern token usage
   - Allocate budgets (files, skills, transcript)
   - Optimize context efficiency

**Deliverable:** Autonomous context management

**Validation:**
- Sessions don't crash from context overflow
- Warnings appear before critical threshold
- Dashboard shows proactive alerts

### Phase 4: Advanced Features (Week 7-8)

**Goal:** CC-level context intelligence

**Tasks:**
1. **Cache-aware compaction** (if CC exposes API)
   - Forked agent pattern
   - Prompt cache sharing
   - 50-70K token savings

2. **Context prediction**
   - ML model for usage prediction
   - Proactive warnings
   - Optimization suggestions

3. **Cross-session memory**
   - Project-scoped knowledge
   - Shared learnings
   - Context inheritance

**Deliverable:** Best-in-class context management

---

## 8. Effort Estimate

### 8.1 Breakdown by Component

| Component | Effort | Risk | Dependencies |
|-----------|--------|------|--------------|
| Token estimation | 2d | Low | None |
| Context stats API | 2d | Low | Token estimation |
| Compaction hooks | 2d | Medium | Hook infrastructure |
| Notepad system | 3d | Low | File I/O |
| Memory API | 2d | Low | Notepad system |
| Pre/Post compact handlers | 3d | Medium | Hooks + Memory |
| Auto-compact threshold | 2d | Medium | Token estimation |
| Dashboard widgets | 2d | Low | APIs |
| Testing + docs | 3d | Low | All |
| **Total** | **21d** | | |

### 8.2 Parallel Work Opportunities

- Token estimation + Notepad system can be parallelized
- Dashboard widgets can start once API contracts defined
- Testing can be written alongside implementation

### 8.3 Critical Path

```
Token estimation → Context stats → Compaction hooks → Pre/Post handlers → Auto-compact
                  ↘
                    Notepad → Memory API → Pre/Post handlers
```

**Shortest path:** ~15 working days (3 weeks)

### 8.4 Resource Requirements

| Resource | Phase 1-2 | Phase 3-4 | Total |
|----------|-----------|-----------|-------|
| Developer time | 10d | 11d | 21d |
| Testing time | 2d | 3d | 5d |
| Code review | 2d | 2d | 4d |
| Documentation | 1d | 2d | 3d |

---

## 9. Risk Assessment

### 9.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CC doesn't expose context window | High | Medium | Use estimation + config override |
| Compaction hooks not available | Medium | High | Prompt-based compaction trigger |
| Token estimation inaccurate | Medium | Low | Calibrate with actual usage |
| Notepad grows unbounded | Low | Medium | TTL + size limits |
| Pre-compact hook timing | Medium | High | Test thoroughly, add delays |

**Mitigation Details:**

1. **Context Window Not Exposed**
   - Default to 200K (Sonnet 4.6)
   - Config override: `contextWindow: 200_000`
   - Detect model from hooks, adjust accordingly

2. **Compaction Hooks Unavailable**
   - Fallback: Monitor for idle → message pattern
   - Alternative: Periodic memory sync regardless of compaction
   - Last resort: Prompt-based trigger (`/compact` via message)

3. **Token Estimation Inaccuracy**
   - Start with 4 chars/token (GPT-style)
   - Calibrate using actual CC output (if available)
   - Add fudge factor (±20%) for safety

### 9.2 Integration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaks existing sessions | Low | High | Feature flag, gradual rollout |
| Performance regression | Low | Medium | Profile, optimize hot paths |
| State file corruption | Low | High | Atomic writes, backups |
| Hook payload changes | Medium | Medium | Version detection, fallbacks |

**Mitigation Details:**

1. **Feature Flags**
   ```typescript
   const config = {
     enableContextTracking: true,
     enableNotepad: true,
     enableAutoCompact: false,  // Off by default initially
     autoCompactThreshold: 0.9,
   };
   ```

2. **Gradual Rollout**
   - Phase 1: Read-only (no behavior change)
   - Phase 2: Opt-in memory system
   - Phase 3: Opt-in auto-compact
   - Phase 4: Default-on

3. **State File Protection**
   ```typescript
   // Atomic writes with backup
   async function saveNotepad(sessionId: string, content: string) {
     const path = getNotepadPath(sessionId);
     const tmpPath = \`\${path}.tmp\`;
     const backupPath = \`\${path}.bak\`;
     
     // Write to temp
     await writeFile(tmpPath, content);
     
     // Backup existing
     if (existsSync(path)) {
       await rename(path, backupPath);
     }
     
     // Atomic rename
     await rename(tmpPath, path);
   }
   ```

### 9.3 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Memory files fill disk | Low | Medium | Size limits, cleanup cron |
| Auto-compact loops | Low | High | Max compacts per session |
| Notepad injection attacks | Low | Medium | Sanitize content |
| Context estimation drift | Medium | Low | Periodic recalibration |

**Safety Limits:**

```typescript
const SAFETY_LIMITS = {
  maxNotepadSize: 100_000,           // 100KB per session
  maxCompactsPerSession: 10,         // Prevent infinite loops
  minTimeBetweenCompacts: 60_000,    // 1 minute
  notepadTtlDays: 30,                // Cleanup old notepads
  maxProjectMemorySize: 1_000_000,   // 1MB per project
};
```

### 9.4 Risk Matrix

```
Impact →  High    │ [Pre-compact timing]  │ [Hooks unavailable]
                  │ [State corruption]    │
Medium ──────────┼───────────────────────┼─────────────────────
                  │ [Estimation drift]    │ [Performance]
Low     │ [Disk fill]          │ [Injection]
          Low                    Medium                 High
                              Likelihood →
```

---

## 10. Success Metrics

### 10.1 Quantitative

| Metric | Current | Target | How to Measure |
|--------|---------|--------|----------------|
| Context visibility | 0% | 100% | % sessions with context API available |
| Compaction survival | 0% | 90% | Knowledge retained after compact (spot check) |
| Auto-compact success | N/A | 95% | Compacts triggered before overflow |
| Token estimation accuracy | N/A | ±15% | Compare estimate vs actual (when available) |
| Session longevity | ~1h | 4h+ | Avg session length before context crash |
| API response time | N/A | <100ms | Context endpoint latency |

### 10.2 Qualitative

| Success Criterion | How to Validate |
|-------------------|-----------------|
| Orchestrators can reason about context | External orchestrator successfully manages long task |
| Dashboard shows real-time usage | Widget updates live during session |
| Sessions survive long autonomous tasks | 4+ hour task completes without crash |
| Knowledge persists across compaction | Critical info preserved after 3+ compacts |
| No context-related crashes | Zero "prompt too long" errors in logs |

### 10.3 Observability Requirements

**Metrics to Track:**
```typescript
// Prometheus metrics
aegis_context_usage_percent{session_id}
aegis_context_compaction_total{session_id, trigger}
aegis_context_tokens_saved_total{session_id}
aegis_context_estimation_error_percent{session_id}
aegis_memory_notepad_size_bytes{session_id}
aegis_memory_operations_total{session_id, action}
```

**Events to Emit:**
```typescript
// For orchestrators and dashboards
session:context_warning    // Usage > 80%
session:compacting         // Compact triggered
session:compacted          // Compact complete
session:memory_updated     // Notepad changed
session:memory_synced      // Memory injected to CC
```

---

## 11. Appendix

### A. Token Estimation Algorithm

```typescript
// Based on CC's roughTokenCountEstimation (~4 chars/token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// More accurate for code (denser)
function estimateCodeTokens(code: string): number {
  return Math.ceil(code.length / 3.5);
}

// For JSONL entries
function estimateEntryTokens(entry: ParsedEntry): number {
  let tokens = estimateTokens(entry.text);
  
  // Tool uses have overhead (tool name, args wrapper)
  if (entry.toolName) {
    tokens += 50; // Approximate overhead
  }
  
  // Tool results can be very large
  if (entry.contentType === 'tool_result') {
    // Cap estimate to prevent overcounting
    tokens = Math.min(tokens, 5_000);
  }
  
  // Thinking blocks
  if (entry.contentType === 'thinking') {
    tokens += 20; // Wrapper overhead
  }
  
  return tokens;
}

// Full session estimation
async function estimateSessionTokens(session: SessionInfo): Promise<number> {
  const entries = await getCachedEntries(session);
  let total = 0;
  
  // System overhead (prompt + tools)
  total += 20_000;
  
  // Context files (CLAUDE.md, git status, etc.)
  total += 10_000; // Estimated average
  
  // Transcript entries
  for (const entry of entries) {
    total += estimateEntryTokens(entry);
  }
  
  return total;
}
```

### B. Notepad Format

```markdown
# Session Notepad: abc123-def456-...

## Priority (Permanent Retention)
<remember priority>
- Project uses TypeScript strict mode
- Never commit to main directly
- Always run tests before PR
- API base URL: https://api.example.com/v2
</remember>

## Working (7-day TTL)
<remember>
- Current task: Implement context compaction system
- Active files: src/session.ts, src/transcript.ts
- Last decision: Use estimation over CC API
- Blocker: Need to verify hook availability
- Next step: Test PreCompact hook with manual /compact
</remember>

## Learnings
- 2026-04-01: Claude Code compacts at 90% usage automatically
- 2026-04-01: Prompt cache saves ~50K tokens per compact via forked agent
- 2026-04-01: CLAUDE.md files are included in every request

## Decisions
- 2026-04-01: Use token estimation vs CC API (not exposed)
- 2026-04-01: Notepad TTL: 7 days working, permanent priority
- 2026-04-01: Auto-compact threshold: 90% (configurable)

## Context Snapshots
<!-- Auto-generated by PreCompact hook -->
<remember>
## Pre-Compact Snapshot (2026-04-01T14:30:00Z)
- Current task: Writing compaction brief
- Active files: brief-3-context-memory.md
- Progress: Section 8 of 12 complete
- Pending: Review, testing, implementation
</remember>
```

### C. Hook Payload Schemas

```typescript
// PreCompact hook payload
interface PreCompactPayload {
  hook_event_name: 'PreCompact';
  session_id: string;
  timestamp: number;
  reason: 'auto' | 'manual' | 'prompt_too_long';
  current_tokens: number;
  context_window: number;
  messages_to_compact: number;
}

// PostCompact hook payload
interface PostCompactPayload {
  hook_event_name: 'PostCompact';
  session_id: string;
  timestamp: number;
  tokens_before: number;
  tokens_after: number;
  tokens_saved: number;
  messages_summarized: number;
  preserved_files: string[];
  preserved_skills: string[];
  compact_duration_ms: number;
}

// Memory sync request (internal)
interface MemorySyncRequest {
  sessionId: string;
  sections: ('priority' | 'working' | 'learnings')[];
  method: 'message' | 'claude_md' | 'prompt';
}
```

### D. Configuration Schema

```typescript
interface ContextConfig {
  // Feature flags
  enableContextTracking: boolean;    // Default: true
  enableNotepad: boolean;            // Default: true
  enableAutoCompact: boolean;        // Default: false (Phase 3)
  
  // Thresholds
  warningThreshold: number;          // Default: 0.80 (80%)
  autoCompactThreshold: number;      // Default: 0.90 (90%)
  
  // Budgets (tokens)
  contextWindowOverride: number;     // Default: 200_000
  fileRestorationBudget: number;     // Default: 50_000
  maxFilesToRestore: number;         // Default: 5
  maxTokensPerFile: number;          // Default: 5_000
  skillsBudget: number;              // Default: 25_000
  
  // Notepad
  notepadMaxSize: number;            // Default: 100_000 (100KB)
  notepadWorkingTtlDays: number;     // Default: 7
  notepadCleanupCron: string;        // Default: "0 3 * * *"
  
  // Safety
  maxCompactsPerSession: number;     // Default: 10
  minTimeBetweenCompactsMs: number;  // Default: 60_000
  estimationFudgeFactor: number;     // Default: 1.2 (20% buffer)
}

// Default configuration
const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  enableContextTracking: true,
  enableNotepad: true,
  enableAutoCompact: false,
  warningThreshold: 0.80,
  autoCompactThreshold: 0.90,
  contextWindowOverride: 200_000,
  fileRestorationBudget: 50_000,
  maxFilesToRestore: 5,
  maxTokensPerFile: 5_000,
  skillsBudget: 25_000,
  notepadMaxSize: 100_000,
  notepadWorkingTtlDays: 7,
  notepadCleanupCron: "0 3 * * *",
  maxCompactsPerSession: 10,
  minTimeBetweenCompactsMs: 60_000,
  estimationFudgeFactor: 1.2,
};
```

### E. API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/v1/sessions/:id/context` | Get context usage info |
| POST | `/v1/sessions/:id/context/compact` | Request compaction |
| GET | `/v1/sessions/:id/context/stats` | Get token breakdown |
| GET | `/v1/sessions/:id/memory` | Read session notepad |
| POST | `/v1/sessions/:id/memory` | Update notepad |
| POST | `/v1/sessions/:id/memory/sync` | Sync memory to CC |
| DELETE | `/v1/sessions/:id/memory` | Clear notepad |
| GET | `/v1/projects/:hash/memory` | Read project memory |
| POST | `/v1/projects/:hash/memory` | Update project memory |

---

## 12. Conclusion

Integrating context compaction and memory into Aegis is **critical for long-running autonomous sessions**. The proposed architecture delivers four key capabilities:

### 12.1 Key Benefits

1. **Context Visibility**
   - HTTP API exposes context usage (unique vs CC CLI)
   - Dashboard widgets show real-time health
   - Proactive warnings before overflow

2. **Knowledge Persistence**
   - Notepad survives compaction
   - Critical context auto-saved pre-compact
   - Automatic restoration post-compact

3. **Autonomous Management**
   - Auto-compact at 90% threshold
   - Budget allocation per concern
   - Efficiency optimization hints

4. **External Integration**
   - Webhooks for orchestrators
   - Memory API for external state
   - Event stream for real-time monitoring

### 12.2 Competitive Advantage

Aegis becomes the **only CC orchestration layer** with:
- Context window management API
- Compaction-resistant memory
- External orchestrator integration
- Real-time context observability

This positions Aegis as the **infrastructure of choice** for:
- Long-running autonomous agents
- Multi-step workflows
- Production-grade CC deployments
- External orchestrator integration

### 12.3 Implementation Priority

**Must Have (Phase 1-2):**
- Token estimation + context API
- Notepad system
- Compaction hooks

**Should Have (Phase 3):**
- Auto-compact threshold
- Proactive warnings

**Nice to Have (Phase 4):**
- Cache-aware compaction (requires CC API)
- Context prediction
- Cross-session memory

### 12.4 Next Steps

1. **Validate Hook Availability**
   - Test PreCompact/PostCompact hooks with manual `/compact`
   - Verify payload schema
   - Document any discrepancies

2. **Implement Phase 1**
   - Token estimation
   - Context API endpoint
   - Dashboard widget

3. **Test Notepad Survival**
   - Create session with known context
   - Trigger manual compact
   - Verify notepad persists

4. **Design Orchestrator Integration**
   - Webhook payload schema
   - Event stream API
   - External memory sync

---

**Brief Complete** — Ready for implementation planning

**Estimated Total Effort:** 21 working days (4-5 weeks with testing)

**Critical Path:** Token estimation → Hooks → Notepad → Auto-compact

**Risk Level:** Medium (mostly mitigated via feature flags and gradual rollout)

---

## References

1. **CC Source Analysis**: `/references/cc-analysis-context-state.md`
2. **OMC Skills Analysis**: `/references/omc-analysis-skills-plugins.md`
3. **CC context.ts**: `~/.claude-internals/claude-code-leaked/source/src/context.ts`
4. **Aegis session.ts**: `~/projects/aegis/src/session.ts`
5. **Aegis transcript.ts**: `~/projects/aegis/src/transcript.ts`
6. **CC Compaction**: `~/.claude-internals/claude-code-leaked/source/src/services/compact/`

---

*Document Version: 1.0*
*Last Updated: 2026-04-01*
*Author: Hephaestus (Aegis Lead Developer)*
