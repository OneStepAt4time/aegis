# Technical Brief: Agent Observatory & Tiered Routing for Aegis

**Date:** 2026-04-01  
**Author:** Hephaestus (Subagent Analysis)  
**Purpose:** Integration blueprint for observatory, cost tracking, and tiered model routing

---

## Executive Summary

This brief proposes integrating **oh-my-claudecode's (OMC) Agent Observatory** and **Claude Code's native Cost Tracking** into Aegis, creating a superior orchestration layer that combines:

- **Real-time observability** of agent behavior and bottlenecks
- **Tiered model routing** (LOW/MEDIUM/HIGH) for cost optimization
- **Per-session cost accounting** with cumulative tracking
- **Escalation protocols** for stuck agents
- **Dashboard-ready metrics** via SSE streaming

**Key Insight:** Aegis's HTTP API + Dashboard + SSE streaming makes this system superior to OMC's CLI-only approach, enabling external orchestrators and CI/CD pipelines to leverage intelligent routing.

---

## 1. Current State: Aegis Metrics/Monitor/Events Today

### 1.1 Metrics System (src/metrics.ts)

Aegis has a basic in-memory metrics collector with GlobalMetrics and SessionMetrics interfaces, plus Issue #87 latency tracking (rolling window of 100 samples) for hook_latency_ms, state_change_detection_ms, permission_response_ms, and channel_delivery_ms.

**What it tracks:**
- Global counters (sessions, messages, webhooks)
- Per-session basic metrics (duration, messages, tool calls)
- Latency samples

**What it lacks:**
- No model tracking (which model is each session using?)
- No token counting (input, output, cache read/write)
- No cost tracking (USD per session, per model)
- No task complexity classification
- No agent role differentiation

### 1.2 Event System (src/events.ts)

Aegis has a robust SSE event bus with SessionSSEEvent and GlobalSSEEvent interfaces. Supports per-session and global event streams, ring buffer for Last-Event-ID replay (50 events), and various event types.

**What it lacks:**
- No cost events (e.g., cost_update, token_usage)
- No tier change events (e.g., tier_escalation)
- No bottleneck detection events
- No model switch events

### 1.3 Monitor System (src/monitor.ts)

Aegis has sophisticated stall detection with 5 types: JSONL stall, Permission stall, Unknown stall, Extended state stall, and Extended working stall.

**What it lacks:**
- No task progress tracking
- No bottleneck classification (IO-bound vs CPU-bound vs API-bound)
- No tier escalation triggers
- No cost threshold alerts

### 1.4 Session System (src/session.ts)

Tracks session lifecycle including id, windowId, windowName, workDir, status, model (Issue #89), and activeSubagents.

**What it lacks:**
- No token tracking (input, output, cache)
- No cost tracking (USD)
- No tier classification (LOW/MEDIUM/HIGH)
- No task complexity estimation
- No agent role (explorer, executor, architect, etc.)

---

## 2. CC Cost Tracking: Per-Model, Per-Session Token/Cost Accounting

### 2.1 CC's Native Cost Tracking (from cc-analysis-context-state.md)

Claude Code implements sophisticated cost tracking with ModelUsage interface (inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow, maxOutputTokens) and SessionCost aggregation.

**Key features:**
- Per-model granularity (tracks usage per canonical model name)
- Token types: Input, output, cache read, cache write
- Cost calculation: USD cost per model
- Session persistence: Costs saved to project config
- Advisor tracking: Separate tracking for sub-agent costs

### 2.2 Token Counting Methods

CC uses rough estimation (~4 chars/token) for text. For accurate counting, reads from API response usage field.

### 2.3 Cost Display Format

CC displays at session end: Total cost, duration (API/wall), code changes, usage by model with token breakdown and cost.

### 2.4 What Aegis Should Adopt

| Feature | CC Implementation | Aegis Adoption |
|---------|------------------|----------------|
| Per-model tracking | Map<string, ModelUsage> | Add to SessionInfo |
| Token types | input, output, cache read/write | Same structure |
| Cost calculation | Model-specific pricing | Use Anthropic's pricing |
| Session persistence | Save to project config | Save to state.json |
| API duration | Track per-session | Already have latency tracking |
| Sub-agent costs | Separate tracking | Track per subagent ID |

---

## 3. OMC Observatory: Real-Time Monitoring & Tiered Routing

### 3.1 Tiered Model Routing (from omc-analysis-orchestration.md)

OMC implements intelligent model routing across three tiers:

| Tier | Model | Cost (per M tokens) | Use For |
|------|-------|---------------------|---------|
| LOW | Haiku | $0.80/$4.00 input/output | Simple lookups, file reads |
| MEDIUM | Sonnet | $3.00/$15.00 | Standard implementation, debugging |
| HIGH | Opus | $15.00/$75.00 | Architecture, complex analysis |

**Agent-to-Tier Mapping:**
- LOW: explore, writer
- MEDIUM: executor, debugger, test-engineer, designer, verifier
- HIGH: architect, planner, critic, code-reviewer, analyst, security-reviewer

### 3.2 Cost Optimization Results

OMC achieves **47% cost savings** through intelligent routing:
- 70% simple lookups -> Haiku (67% savings vs Sonnet)
- 25% standard work -> Sonnet (no change)
- 5% complex work -> Opus (higher cost, but rare)

### 3.3 Real-Time Observatory

AgentObservation interface tracks: agentId, agentRole, tier, status, tokensUsed, costUSD, durationMs, turnsCompleted, stalledFor, blockedBy, lastProgressAt, heartbeatAt, errorsCount.

**Bottleneck Detection Rules:**
1. IO-bound: High file read/write, low token usage -> not a bottleneck
2. CPU-bound: Low file I/O, high tool calls -> may need escalation
3. API-bound: High token usage, long API latency -> normal
4. Stuck: No progress for >5min -> bottleneck detected

### 3.4 Escalation Protocol

When agent stuck: LOW (Haiku) -> MEDIUM (Sonnet) -> HIGH (Opus)

**Escalation triggers:**
- No token usage for 5min while working
- Same error repeated 3+ times
- Explicit "I'm stuck" in output
- Permission denied 2+ times

### 3.5 Handoff Documents

Structured handoffs between stages preserve context: Decided, Rejected, Risks, Files, Remaining.

---

## 4. Gap Analysis: What Aegis is Missing

### 4.1 Cost Tracking Gaps

| Gap | OMC/CC Feature | Aegis Status |
|-----|---------------|--------------|
| Token counting | Per-model input/output/cache | Not tracked |
| Cost calculation | USD per session/model | Not tracked |
| Cumulative costs | Per-project aggregation | Not tracked |
| Cost events | SSE events for cost updates | Not emitted |
| Cost dashboard | Real-time cost visibility | Not available |

### 4.2 Tiered Routing Gaps

| Gap | OMC Feature | Aegis Status |
|-----|-------------|--------------|
| Agent roles | 32 specialized agents | No role system |
| Tier classification | LOW/MEDIUM/HIGH | No tier system |
| Model selection | Automatic based on task | Manual only |
| Escalation protocol | Stuck -> escalate tier | No escalation |
| Cost optimization | 47% savings | No optimization |

### 4.3 Observatory Gaps

| Gap | OMC Feature | Aegis Status |
|-----|-------------|--------------|
| Real-time monitoring | Agent observation system | Basic stall detection only |
| Bottleneck classification | IO/CPU/API-bound detection | Not classified |
| Progress tracking | Task completion percentage | Not tracked |
| Agent health | Heartbeat + error tracking | Partial (dead detection) |
| Dashboard data | SSE streaming metrics | Basic events only |

### 4.4 Summary of Critical Gaps

**High Priority:**
1. Token/cost tracking (per-session, per-model)
2. Tier classification system (LOW/MEDIUM/HIGH)
3. Agent role definitions
4. Escalation protocol
5. Cost events for SSE

**Medium Priority:**
6. Bottleneck classification
7. Progress tracking
8. Handoff documents
9. Cost dashboard endpoints
10. Cumulative cost aggregation

**Low Priority:**
11. Agent health heartbeat
12. Error tracking per agent
13. Cost optimization analytics
14. Break-even analysis

---

## 5. Proposed Architecture

### 5.1 Agent Role Definition

Create src/agent-roles.ts with:

```typescript
export type AgentTier = 'LOW' | 'MEDIUM' | 'HIGH';

export type AgentRole = 
  | 'explorer'      // File discovery, quick scans
  | 'planner'       // Task decomposition, architecture
  | 'executor'      // Code implementation
  | 'debugger'      // Bug fixing
  | 'tester'        // Test writing
  | 'reviewer'      // Code review
  | 'architect'     // System design
  | 'analyst'       // Requirements analysis
  | 'critic'        // Critical review
  | 'general';      // Default

export interface AgentRoleConfig {
  role: AgentRole;
  tier: AgentTier;
  model: string;
  systemPrompt?: string;
  escalationAfter?: number;   // ms before escalating (default: 5min)
  maxRetries?: number;        // Max retries before escalation (default: 3)
}
```

**Role -> Tier Mapping:**
- explorer: LOW (Haiku)
- planner, architect, analyst, critic, reviewer: HIGH (Opus)
- executor, debugger, tester, general: MEDIUM (Sonnet)

### 5.2 Model Routing Engine

Create src/routing.ts with:

```typescript
export interface RoutingDecision {
  tier: AgentTier;
  model: string;
  reason: string;
  confidence: number;  // 0-1
}

export class ModelRoutingEngine {
  analyzeAndRoute(taskDescription: string): RoutingDecision;
  private analyzeTask(description: string): TaskAnalysis;
  private selectModel(analysis: TaskAnalysis): RoutingDecision;
}
```

**Routing Logic:**
- Security/architecture keywords -> HIGH (Opus)
- Read/scan keywords -> LOW (Haiku)
- Design/review keywords -> HIGH (Opus)
- Debug keywords -> MEDIUM (Sonnet) or HIGH if complex
- Write keywords -> MEDIUM (Sonnet) or HIGH if complex

### 5.3 Cost Tracking API

Create src/cost-tracker.ts with:

```typescript
export interface ModelCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
}

export interface SessionCost {
  sessionId: string;
  totalCostUSD: number;
  modelCosts: Map<string, ModelCost>;
  subagentCosts: Map<string, number>;
}

export class CostTracker {
  startSession(sessionId: string, model: string): void;
  recordUsage(sessionId, model, inputTokens, outputTokens, ...): number;
  endSession(sessionId, projectId): SessionCost;
  getSessionCost(sessionId): SessionCost;
  getProjectCost(projectId): ProjectCost;
  getCumulativeCost(): { totalUSD, sessionCount, modelBreakdown };
}
```

**Pricing (per million tokens):**
- Haiku: $0.80 input, $4.00 output, $0.08 cache read, $1.00 cache write
- Sonnet: $3.00 input, $15.00 output, $0.30 cache read, $3.75 cache write
- Opus: $15.00 input, $75.00 output, $1.50 cache read, $18.75 cache write

### 5.4 Observability Dashboard Data (Real-Time SSE)

Create src/observatory.ts with:

```typescript
export interface AgentObservation {
  sessionId: string;
  agentRole: string;
  tier: 'LOW' | 'MEDIUM' | 'HIGH';
  model: string;
  status: 'idle' | 'working' | 'blocked' | 'failed';
  
  // Progress
  tokensUsed: number;
  costUSD: number;
  durationMs: number;
  turnsCompleted: number;
  
  // Bottleneck detection
  stalledForMs?: number;
  bottleneckType?: 'io' | 'cpu' | 'api' | 'permission' | 'unknown';
  lastProgressAt?: number;
  
  // Health
  errorsCount: number;
  retryCount: number;
}

export class AgentObservatory {
  updateObservation(sessionId: string, update: Partial<AgentObservation>): void;
  detectBottlenecks(): Map<string, ObservatoryEvent>;
  getAllObservations(): AgentObservation[];
  getBottleneckRecommendation(type, tier): string;
}
```

**Bottleneck Classification:**
- io: No token usage -> waiting for I/O
- cpu: Multiple retries -> logic issue
- api: High token usage, short stall -> normal
- permission: Permission pending
- unknown: Catch-all

### 5.5 Escalation Protocol

Create src/escalation.ts with:

```typescript
export interface EscalationDecision {
  sessionId: string;
  fromTier: AgentTier;
  toTier: AgentTier;
  fromModel: string;
  toModel: string;
  reason: string;
  triggeredAt: number;
  retryCount: number;
}

export class EscalationProtocol {
  checkEscalation(sessionId: string): EscalationDecision | null;
  executeEscalation(decision: EscalationDecision): Promise<boolean>;
  getEscalationTriggers(obs: AgentObservation): string[];
  getEscalationHistory(sessionId): EscalationDecision[];
}
```

**Escalation Triggers:**
1. Stuck for >5min
2. Retry count >= 3
3. Error count >= 2
4. LOW tier taking >3min

**Max Escalations:** 2 per session (LOW -> MEDIUM -> HIGH)

### 5.6 API Endpoints (New)

```
GET /v1/costs/session/:id          - Session cost breakdown
GET /v1/costs/project/:workDir     - Project cumulative costs
GET /v1/costs/cumulative           - Global cumulative costs

GET /v1/observatory                - All agent observations
GET /v1/observatory/:sessionId     - Single observation

POST /v1/routing/analyze           - Analyze task, get routing

POST /v1/sessions                  - (MODIFIED) Add agentRole param

GET /v1/escalations/:sessionId     - Escalation history
```

**SSE Events (New):**
- cost_update: Token usage and cost
- tier_escalation: Tier change event
- bottleneck_detected: Bottleneck alert
- progress_update: Turn completion

---

## 6. Aegis Advantage: Why This Beats OMC

### 6.1 HTTP API vs CLI-Only

| Feature | OMC | Aegis |
|---------|-----|-------|
| Interface | Slash commands, magic keywords | REST API + MCP + CLI |
| Remote access | CLI-only | HTTP from anywhere |
| CI/CD integration | Manual | API-driven |
| Multi-tenant | Single user | Session isolation |
| External orchestrators | No API | Full REST API |

### 6.2 Dashboard vs Statusline

| Feature | OMC | Aegis |
|---------|-----|-------|
| Visibility | HUD statusline (CLI) | Web dashboard (browser) |
| Real-time updates | Polling | SSE streaming |
| Multi-session view | Single session | All sessions |
| Cost visibility | None | Per-session/project |
| Bottleneck alerts | None | Real-time detection |

### 6.3 MCP Server vs Plugin

| Feature | OMC | Aegis |
|---------|-----|-------|
| Claude Code integration | Plugin (inside CC) | MCP server (external) |
| Tool surface | 5 internal tools | 21 tools + 4 resources |
| Resource access | None | Transcripts, state, config |
| External tools | No bridge | Full MCP compliance |

### 6.4 Architecture Benefits

**Aegis advantages:**
1. **Decoupled**: Aegis runs outside CC, survives CC crashes
2. **Observable**: Full event stream for monitoring
3. **API-first**: Every feature accessible via HTTP
4. **Extensible**: MCP server for Claude Code integration
5. **Multi-user**: Session isolation per workDir

**The killer feature:** External orchestrators (like OpenClaw, CI/CD, custom scripts) can leverage intelligent routing without running CC directly.

---

## 7. Migration Path

### Phase 1: Cost Tracking (v0.4.0)

**Effort:** 3-5 days

1. Add CostTracker class to src/cost-tracker.ts
2. Integrate with hooks to capture token usage
3. Add cost fields to SessionInfo
4. Implement /v1/costs/* endpoints
5. Add cost events to SSE stream
6. Update dashboard to show costs

**Dependencies:** Hook integration for token capture, Pricing data (hardcoded initially)

**Testing:** Unit tests for CostTracker, Integration tests for API endpoints, Manual testing with real CC sessions

### Phase 2: Agent Roles & Routing (v0.4.1)

**Effort:** 5-7 days

1. Add agent-roles.ts with role definitions
2. Add ModelRoutingEngine to src/routing.ts
3. Extend POST /v1/sessions with agentRole param
4. Implement /v1/routing/analyze endpoint
5. Update session creation to use routing engine
6. Add role field to dashboard

**Dependencies:** Phase 1 (cost tracking), Model availability (Haiku, Sonnet, Opus)

**Testing:** Unit tests for routing logic, Integration tests for session creation, Manual testing with different roles

### Phase 3: Observatory (v0.4.2)

**Effort:** 3-5 days

1. Add AgentObservatory to src/observatory.ts
2. Integrate with monitor for status updates
3. Implement bottleneck detection
4. Add /v1/observatory/* endpoints
5. Add observatory events to SSE
6. Update dashboard with observatory view

**Dependencies:** Phase 1 (cost tracking), Phase 2 (agent roles)

**Testing:** Unit tests for bottleneck detection, Integration tests for observatory API, Manual testing with stuck sessions

### Phase 4: Escalation Protocol (v0.4.3)

**Effort:** 3-5 days

1. Add EscalationProtocol to src/escalation.ts
2. Integrate with observatory for trigger detection
3. Implement /v1/escalations/* endpoints
4. Add escalation events to SSE
5. Add escalation UI to dashboard

**Dependencies:** Phase 3 (observatory for trigger detection)

**Testing:** Unit tests for escalation logic, Integration tests for escalation API, Manual testing with stuck sessions

### Phase 5: Dashboard Integration (v0.5.0)

**Effort:** 5-7 days

1. Add cost dashboard view
2. Add tier indicator to session cards
3. Add observatory view (all agents)
4. Add escalation history view
5. Add cost threshold alerts
6. Add bottleneck alerts

**Dependencies:** Phases 1-4 complete

**Testing:** E2E tests for dashboard, Manual UX testing

---

## 8. Effort Estimate

### Summary

| Phase | Effort | Priority | Dependencies |
|-------|--------|----------|--------------|
| Phase 1: Cost Tracking | 3-5 days | P0 | None |
| Phase 2: Agent Roles & Routing | 5-7 days | P0 | Phase 1 |
| Phase 3: Observatory | 3-5 days | P1 | Phases 1-2 |
| Phase 4: Escalation Protocol | 3-5 days | P1 | Phase 3 |
| Phase 5: Dashboard Integration | 5-7 days | P2 | Phases 1-4 |

**Total:** 19-29 days (~4-6 weeks with testing and review)

### Detailed Breakdown

#### Phase 1: Cost Tracking (3-5 days)

| Task | Effort | Owner |
|------|--------|-------|
| Implement CostTracker class | 1 day | Backend |
| Hook integration for tokens | 0.5 day | Backend |
| Add cost fields to SessionInfo | 0.5 day | Backend |
| Implement API endpoints | 1 day | Backend |
| SSE cost events | 0.5 day | Backend |
| Dashboard cost view | 1 day | Frontend |
| Testing | 0.5 day | QA |

#### Phase 2: Agent Roles & Routing (5-7 days)

| Task | Effort | Owner |
|------|--------|-------|
| Define agent roles | 1 day | Backend |
| Implement routing engine | 2 days | Backend |
| Extend session creation | 1 day | Backend |
| Implement routing API | 1 day | Backend |
| Dashboard role indicators | 1 day | Frontend |
| Testing | 1 day | QA |

#### Phase 3: Observatory (3-5 days)

| Task | Effort | Owner |
|------|--------|-------|
| Implement AgentObservatory | 1.5 days | Backend |
| Bottleneck detection | 1 day | Backend |
| Observatory API | 1 day | Backend |
| SSE observatory events | 0.5 day | Backend |
| Dashboard observatory view | 1 day | Frontend |
| Testing | 0.5 day | QA |

#### Phase 4: Escalation Protocol (3-5 days)

| Task | Effort | Owner |
|------|--------|-------|
| Implement EscalationProtocol | 1.5 days | Backend |
| Trigger detection | 1 day | Backend |
| Escalation API | 1 day | Backend |
| SSE escalation events | 0.5 day | Backend |
| Dashboard escalation UI | 1 day | Frontend |
| Testing | 0.5 day | QA |

#### Phase 5: Dashboard Integration (5-7 days)

| Task | Effort | Owner |
|------|--------|-------|
| Cost dashboard view | 1.5 days | Frontend |
| Tier indicators | 1 day | Frontend |
| Observatory view | 1.5 days | Frontend |
| Escalation history | 1 day | Frontend |
| Cost/bottleneck alerts | 1 day | Frontend |
| E2E testing | 1 day | QA |

---

## 9. Risk Assessment

### 9.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Hook token capture fails | Medium | High | Fallback to JSONL parsing |
| Model pricing changes | High | Medium | Make pricing configurable via API |
| Mid-session model switch unsupported | High | Medium | Document limitation, recommend restart |
| SSE event flood | Medium | Medium | Rate limit per session (10/sec max) |
| Cost tracking memory leak | Low | High | TTL-based cleanup (24h retention) |

### 9.2 Integration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CC API changes | Medium | High | Pin CC version, monitor changelog |
| OMC divergence | Low | Low | Keep OMC as reference, not dependency |
| Dashboard performance | Medium | Medium | Pagination, lazy loading, virtualization |

### 9.3 User Experience Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Escalation confusion | Medium | Medium | Clear UI indicators, explain reasoning |
| Cost surprise | Medium | High | Cost threshold alerts, cumulative view |
| Tier selection errors | Medium | Medium | Confidence scores, manual override option |

### 9.4 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cost data loss | Low | High | Persist to disk on session end, backup strategy |
| Observatory state corruption | Low | Medium | Rebuild from session state |
| Escalation loop | Low | Medium | Max 2 escalations per session |

### 9.5 Risk Mitigation Strategies

**High-priority mitigations:**

1. **Hook token capture fallback**: If hooks don't provide token data, parse JSONL for message sizes and estimate tokens (~4 chars/token)

2. **Pricing configuration**: Store pricing data in config.json, allow runtime updates via API endpoint

3. **Mid-session model switch**: Document that escalation triggers a notification, not automatic switch. Recommend manual restart with new model.

4. **SSE rate limiting**: Max 10 events per second per session, batch rapid updates into single events

5. **Cost data persistence**: Persist CostTracker state to disk on every session end, load on startup

6. **Cost threshold alerts**: Default threshold $1.00 per session, configurable per project. Email/webhook alerts.

---

## 10. Success Metrics

### 10.1 Cost Optimization

- **Target:** 30-40% cost reduction vs uniform Sonnet usage
- **Measurement:** Compare cumulative costs before/after routing implementation
- **Baseline:** Current Aegis (100% Sonnet, no tracking)

### 10.2 Escalation Effectiveness

- **Target:** 80% of escalated sessions complete successfully
- **Measurement:** Track completion rate after escalation event
- **Baseline:** N/A (no escalation system today)

### 10.3 Bottleneck Detection

- **Target:** 90% of bottlenecks detected within 5min
- **Measurement:** Time from stall start to detection event
- **Baseline:** Current stall detection (5min for JSONL stalls, 3min for unknown)

### 10.4 Dashboard Adoption

- **Target:** 50% of sessions monitored via dashboard
- **Measurement:** Dashboard page views vs API-only usage
- **Baseline:** N/A (dashboard exists but not cost-focused)

### 10.5 API Usage

- **Target:** 25% of sessions created via API with agentRole param
- **Measurement:** API request params vs default sessions
- **Baseline:** 0% (no agentRole param today)

---

## 11. Conclusion

Integrating the Agent Observatory & Tiered Routing system into Aegis will:

1. **Reduce costs** by 30-40% through intelligent model routing
2. **Improve observability** with real-time agent monitoring
3. **Accelerate resolution** via bottleneck detection and escalation
4. **Enhance UX** with cost-aware dashboard and alerts
5. **Enable external orchestration** via HTTP API

**The Aegis advantage** (HTTP API + Dashboard + SSE + MCP) makes this system superior to OMC's CLI-only approach, enabling external orchestrators and CI/CD pipelines to leverage intelligent routing without running CC directly.

**Recommended timeline:**
- **v0.4.0** (Phase 1-2): Cost tracking + Agent roles (2 weeks)
- **v0.4.2** (Phase 3-4): Observatory + Escalation (2 weeks)
- **v0.5.0** (Phase 5): Dashboard integration (1 week)

**Total effort:** 4-6 weeks

**Key files to create:**
- src/agent-roles.ts (role definitions)
- src/routing.ts (model routing engine)
- src/cost-tracker.ts (cost accounting)
- src/observatory.ts (real-time observations)
- src/escalation.ts (escalation protocol)

**Key files to modify:**
- src/session.ts (add cost/tier/role fields)
- src/events.ts (add cost/tier/escalation events)
- src/monitor.ts (integrate observatory)
- src/routes/sessions.ts (add agentRole param)
- src/routes/costs.ts (new endpoints)
- src/routes/observatory.ts (new endpoints)
- src/routes/escalations.ts (new endpoints)

---

*End of Brief - Generated 2026-04-01*
*Author: Hephaestus (Subagent Analysis)*
