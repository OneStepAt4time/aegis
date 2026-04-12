# Aegis v0.5.1-alpha — Comprehensive UAT Plan

> **Objective:** Validate all core functionality across backend API, dashboard UI, session orchestration, and integration pathways.

---

## 1. AUTHENTICATION & AUTHORIZATION

### 1.1 Auth Key Management
- [ ] **Create auth key** → Retrieve key, verify name and TTL
- [ ] **List auth keys** → Confirm pagination (page, limit, total)
- [ ] **Revoke auth key** → Confirm 401 on next use
- [ ] **Rate limit enforcement** → Exceed rateLimit, observe 429
- [ ] **Bearer token validation** → Invalid/expired token → 401

### 1.2 Permission Guards (Wave A)
- [ ] **GET /v1/metrics** → Requires valid auth key (not public)
- [ ] **GET /v1/health** → Accessible without auth (public)
- [ ] **Session ownership** → Non-owner cannot access /sessions/:id with different bearer token
- [ ] **Hook secret validation** → Invalid hook secret → reject PreToolUse/PostToolUse/UserPromptSubmit

---

## 2. SESSION LIFECYCLE

### 2.1 Session Creation
- [ ] **Create session** (POST /v1/sessions)
  - [ ] Valid workDir → Session created with id, windowId, status=idle
  - [ ] Invalid workDir → 400 error
  - [ ] Custom env vars → Applied to tmux pane
  - [ ] stallThresholdMs customization → Applied to session config
  - [ ] permissionMode variants (bypassPermissions, promptUser, blockAll) → Enforced

### 2.2 Session Interaction
- [ ] **Send prompt** (POST /v1/sessions/:id/send)
  - [ ] Delivery tracking (attempts, delivered flag)
  - [ ] Session state after send → waiting_for_input
  - [ ] Read session pane output immediately → Partial buffer
  
- [ ] **Read session output** (POST /v1/sessions/:id/read)
  - [ ] Offset tracking across multiple reads
  - [ ] UI state detection → working, idle, permission_prompt, error
  - [ ] Transcript parsing → messages, tool calls, results
  
- [ ] **Get session pane** (GET /v1/sessions/:id/pane)
  - [ ] Raw terminal output (no parsing)
  - [ ] Screenshot capture integrated

### 2.3 Session Monitoring
- [ ] **Session health** (GET /v1/sessions/:id/health)
  - [ ] Detect stalled sessions (lastActivityAgo exceeds stallThresholdMs)
  - [ ] Detect dead sessions (tmux window gone)
  - [ ] Status availability reflects current state
  
- [ ] **Metrics per session** (GET /v1/sessions/:id/metrics)
  - [ ] Token usage tracking (input, output, cache)
  - [ ] Duration calculation (createdAt vs now)
  - [ ] Tool call count, approval count

### 2.4 Session Termination
- [ ] **Kill session** (DELETE /v1/sessions/:id)
  - [ ] tmux window destroyed
  - [ ] Session marked completed
  - [ ] Subsequent sends → 404
  
- [ ] **Graceful shutdown** (SIGTERM)
  - [ ] Active sessions killed cleanly
  - [ ] PID file removed
  - [ ] Event bus flushed

---

## 3. HOOKS SYSTEM

### 3.1 Hook Callbacks
- [ ] **UserPromptSubmit** hook
  - [ ] Triggered on /v1/sessions/:id/send
  - [ ] Secret validation enforced
  - [ ] Payload: { sessionId, userId, prompt, timestamp }
  - [ ] Empty body tolerance (no 400)
  - [ ] Unknown fields stripped (no 400)

- [ ] **PreToolUse** hook
  - [ ] Triggered before tool execution
  - [ ] Payload: { sessionId, toolName, toolArgs, timestamp }

- [ ] **PostToolUse** hook
  - [ ] Triggered after tool result captured
  - [ ] Payload: { sessionId, toolName, result, succeeded, timestamp }

- [ ] **Stop** hook
  - [ ] Triggered on manual session kill
  - [ ] Payload: { sessionId, reason, timestamp }

### 3.2 Hook Resilience
- [ ] **Transient failures** → Retry with exponential backoff
- [ ] **Persistent failures** → Log and continue (non-blocking)
- [ ] **Timeout** (5s) → Abort and proceed
- [ ] **Rate limiting** → Back off gracefully, no cascading 429s

---

## 4. PIPELINE ORCHESTRATION

### 4.1 Pipeline Creation
- [ ] **Create pipeline** (POST /v1/pipelines)
  - [ ] Name, workDir, stages array
  - [ ] Initial status = "running"
  - [ ] currentStage = first stage id
  - [ ] stageHistory starts with plan stage

### 4.2 Pipeline Execution
- [ ] **Execute stage** → Session created for stage
- [ ] **Stage completion** → Next stage queued
- [ ] **Stage failure** → Pipeline halts (retryCount honored)
- [ ] **Retry logic** → maxRetries respected, backoff applied

### 4.3 Pipeline Monitoring
- [ ] **Get pipeline** (GET /v1/pipelines/:id)
  - [ ] Current status, stage, history
  - [ ] Session ids linked to stages
  
- [ ] **List pipelines** (GET /v1/pipelines)
  - [ ] Running, completed, failed counts
  - [ ] Pagination support
  - [ ] Last 24h visible

### 4.4 Pipeline State Transitions
- [ ] **running** → **completed** (all stages done)
- [ ] **running** → **failed** (stage fails + retries exhausted)
- [ ] **completed/failed** → Reads return final state (idempotent)

---

## 5. AUDIT TRAIL

### 5.1 Audit Log Capture
- [ ] **Session create** → actor, action, sessionId, timestamp logged
- [ ] **Session kill** → actor, sessionId, reason logged
- [ ] **Hook execute** → hookType, sessionId, result logged
- [ ] **Auth key create/revoke** → actor, keyId logged
- [ ] **Permission response** → sessionalId, decision, timestamp

### 5.2 Audit Retrieval
- [ ] **Fetch logs** (GET /v1/audit?page=0&pageSize=20)
  - [ ] Timestamp field present (ts)
  - [ ] Pagination: page, pageSize, total, totalPages
  - [ ] Filter by actor, action, sessionId
  - [ ] Sort by timestamp (descending default)

### 5.3 Audit Data Integrity
- [ ] **Timestamps valid** (parseable ISO 8601 or epoch ms)
- [ ] **No "Invalid Date"** when rendering
- [ ] **Abort on nav** → Clean error handling (not UI crash)

---

## 6. DASHBOARD FRONTEND

### 6.1 Authentication & Navigation
- [ ] **Login page** → Token input, localStorage persist
- [ ] **Auth failure** → Redirect to /dashboard/login
- [ ] **Token expiry** → Auto-logout, redirect
- [ ] **Protected routes** → Inaccessible without token

### 6.2 Overview Page
- [ ] **Metrics cards** → Active, total, avg duration, uptime
- [ ] **Polling** → Fetch on interval (10s without SSE, 30s with)
- [ ] **Live count updates** → New/ended sessions reflected within polling interval
- [ ] **Activity stream** → Recent events (status, message, ended, created)

### 6.3 Sessions Page
- [ ] **Session table** → Search, filter by status, sort by age/activity
- [ ] **Live status** → Status icons update in real time
- [ ] **Quick actions** → Interrupt, Kill, View Detail
- [ ] **Pagination** → Load/unload in batches (500ms jitter)

### 6.4 Session Detail Page
- [ ] **Pane output** → Terminal emulation (xterm)
- [ ] **Transcript** → Messages, tool use, results, permissions
- [ ] **Hook order** → No "Rendered more hooks" crash
- [ ] **Real-time updates** → SSE subscription per session

### 6.5 Pipelines Page (NEW FIX)
- [ ] **Empty state (no pipelines)** → "No pipelines yet" message
- [ ] **Load error (fetch failed)** → "Unable to load pipelines" + reason
- [ ] **Running pipelines** → Status badge, stage count, created time
- [ ] **New Pipeline button** → Modal opens, create form works
- [ ] **Reduced polling** → 10s fallback (was 5s) to mitigate 429s

### 6.6 Pipeline Detail Page
- [ ] **Pipeline info** → Name, status, stage list, history
- [ ] **Stage sessions** → Links to session detail
- [ ] **Stage status** → pending/running/completed/failed badges

### 6.7 Audit Page
- [ ] **Audit table** → Records with id, actor, action, timestamp, description
- [ ] **Row key stability** → No console warnings (key fallback: ts + actor + index)
- [ ] **Timestamp parsing** → Field is `ts` (not `timestamp`)
- [ ] **Abort handling** → Navigation away cleans up fetch
- [ ] **Pagination** → Page, pageSize, total

### 6.8 Auth Keys Page
- [ ] **List auth keys** → Name, created, last used, rate limit
- [ ] **Create key** → Name input, modal confirmation, copy-to-clipboard
- [ ] **Revoke key** → Confirm prompt, immediate removal

---

## 7. REAL-TIME UPDATES (SSE)

### 7.1 SSE Token Flow
- [ ] **Request SSE token** (POST /v1/auth/sse-token)
  - [ ] Returns short-lived token + expiresAt
  - [ ] Requires bearer auth
  
- [ ] **Subscribe to events** (GET /v1/events?token=sse_xxx)
  - [ ] Valid token → SSE stream opens
  - [ ] Invalid/expired → 401
  - [ ] 5 concurrent limit enforced → 429 on 6th

### 7.2 SSE Event Schema
- [ ] **Global events** → sessionId, type, data, timestamp
- [ ] **Session events** → status changes, messages, errors
- [ ] **Resilience** → Missing sessionId/data → normalization applied (no UI crash)

### 7.3 Dashboard SSE Subscription
- [ ] **Auto-reconnect** → On disconnect, attempt every 2s (backoff)
- [ ] **Auth abort** → 401 → redirect to login (no infinite loop)
- [ ] **State consistency** → Fallback polling picks up if SSE stale > 30s

---

## 8. MCP SERVER

### 8.1 Tool Registration
- [ ] **24 tools available** (`claude mcp ls aegis`)
- [ ] **Tool invocation** → Hook integration works
- [ ] **Tool result capture** → PostToolUse fired
- [ ] **Tool error handling** → Returned to Claude, session continues

### 8.2 Prompt Integration
- [ ] **3 prompts available** → Listed by `claude mcp info aegis`
- [ ] **Prompt context** → Session info injected
- [ ] **Multi-tool workflows** → Sequential tool use within prompt

---

## 9. VALIDATION & ERROR HANDLING

### 9.1 Input Validation
- [ ] **workDir validation** → Must exist, absolute path enforced
- [ ] **sessionId format** → Must be valid UUID, reject otherwise
- [ ] **JSON schema** → All payloads validated (Zod), errors descriptive

### 9.2 Error Responses
- [ ] **4xx errors** → Include error message, statusCode
- [ ] **5xx errors** → Log internally, generic message to user
- [ ] **Rate limit (429)** → Retry-After header present
- [ ] **Concurrent operation conflict** → Return 409 with reason

### 9.3 Edge Cases
- [ ] **Non-existent session** → 404
- [ ] **Session already killed** → 404 on kill, -status returns completed
- [ ] **Empty hook payload** → Accepted, no 400
- [ ] **Unknown hook fields** → Stripped, no 400

---

## 10. PERFORMANCE & STABILITY

### 10.1 Concurrency
- [ ] **Multiple sessions** (10+ concurrent) → All responsive
- [ ] **Multiple hooks** (100+ per second) → No dropped events
- [ ] **Parallel reads** → Data raceconditions absent

### 10.2 Stall Detection
- [ ] **Session silent > stallThresholdMs** → Marked stalled
- [ ] **Stall alert sent** → Webhook/notification fires (if configured)
- [ ] **Manual kill** → Stall cleared on interaction

### 10.3 Memory & Resource Management
- [ ] **Long-running session (1h+)** → No memory leak
- [ ] **Session cleanup** → After kill, resources freed (tmux pane destroyed)
- [ ] **Transcript limits** → Large transcripts (1MB+) handled gracefully

### 10.4 Graceful Degradation
- [ ] **tmux unavailable** → Clear error, no server crash
- [ ] **Claude Code CLI missing** → Detected at startup, error logged
- [ ] **Disk full** → Transcript writes fail gracefully, events still fired

---

## 11. INTEGRATION TESTS

### 11.1 End-to-End Session Workflow
```
1. CREATE session
2. SEND prompt
3. WAIT for working state (poll status)
4. READ output (multiple reads, offset tracking)
5. Check metrics (duration, messages, tools)
6. KILL session
7. Verify metrics finalized
8. Verify audit trail captured all steps
```

### 11.2 Pipeline End-to-End
```
1. CREATE pipeline with 2 stages
2. Monitor stage 1 session creation
3. Verify stage 1 completes
4. Verify stage 2 starts
5. Verify final status = completed
6. Verify pipeline appears in dashboard
7. Verify metrics aggregated
```

### 11.3 Hook Chain End-to-End
```
1. SET hook endpoints (UserPromptSubmit, PreToolUse, PostToolUse)
2. SEND prompt → UserPromptSubmit fired
3. SESSION executes tool → PreToolUse fired, then PostToolUse
4. VERIFY hook payloads in audit trail
5. VERIFY no timing anomalies (latencies logged)
```

### 11.4 Dashboard Real-Time Flow
```
1. LOGIN with valid token
2. NAVIGATE to Overview → Metrics load
3. CREATE session via API
4. OBSERVE session appear (via SSE or poll)
5. UPDATE session state via API
6. OBSERVE state change reflected (< 2s)
7. NAVIGATE to Pipelines → Data loads
8. CREATE pipeline via dashboard modal
9. VERIFY pipeline appears without reload
```

---

## 12. REGRESSION TEST VECTORS

### 12.1 Previously Known Issues (Fixed)
- [ ] **Audit timestamp "Invalid Date"** → Use `ts` field, parse correctly
- [ ] **Abort on audit page nav** → Handle AbortError gracefully
- [ ] **Hook 400 errors** → Empty/unknown-field payloads accepted
- [ ] **SessionDetail hook crash** → Hook order stable, no conditional early returns
- [ ] **Pipelines rate limit** → Reduced fallback polling, graceful 429 handling

### 12.2 Browser Compatibility
- [ ] **Chrome (latest)** → All pages load, SSE works
- [ ] **Firefox (latest)** → All pages load, SSE works
- [ ] **Edge (latest)** → All pages load

### 12.3 Network Conditions
- [ ] **Latency (100ms)** → UI responsive
- [ ] **Packet loss (5%)** → SSE reconnects, polling catches up
- [ ] **Intermittent 429s** → Backoff applied, dashboard recovers

---

## 13. TEST EXECUTION ORDER

### Phase 1: Auth & Health (5 min)
- Health check (public)
- Auth key creation/validation
- Bearer token enforcement

### Phase 2: Session Lifecycle (10 min)
- Create empty session
- Send prompt, verify state change
- Kill session, verify cleanup

### Phase 3: Hooks & Callbacks (5 min)
- Register hooks
- Trigger each hook type
- Verify audit trail

### Phase 4: Pipeline (10 min)
- Create 2-stage pipeline
- Monitor execution
- Verify completion

### Phase 5: Dashboard E2E (15 min)
- Login
- Navigate all pages
- Check real-time updates
- Test error states

### Phase 6: Stress/Reliability (20 min)
- 10 concurrent sessions
- 100 rapid API calls
- Memory/resource checks

### Phase 7: Regression (10 min)
- Test all previously fixed bugs
- Verify no new console warnings

---

## Success Criteria

✅ **All sections complete without errors**
✅ **No UI crashes or unhandled exceptions**
✅ **Real-time updates < 2s latency**
✅ **No "Invalid Date", missing ids, or broken row keys**
✅ **Load errors clearly communicated (not silent failures)**
✅ **Rate-limit handling graceful (no cascading 429s)**
✅ **Audit trail complete and queryable**
✅ **Hook chain executes reliably**

---
