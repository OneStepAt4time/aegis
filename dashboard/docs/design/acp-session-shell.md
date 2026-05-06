# ACP Session Shell — Component Architecture Design Doc

**Author:** Daedalus (Frontend)
**Epic:** Phase 3.5 — ACP Backend Migration (M4)
**Issue:** ACP-080 (#2611)
**Status:** Draft (pre-activation recon)
**Last updated:** 2026-05-04

---

## 1. Problem Statement

The current `SessionDetailPage` (987 lines) is a monolithic component built around tmux-centric concepts: window IDs, pane capture, terminal screen scraping, and send-keys input. The ACP migration replaces tmux with `claude-agent-acp` JSON-RPC, fundamentally changing:

- **Session identity:** `windowId`/`windowName` → `aegisSessionId` + `acpProcessId`
- **Event stream:** Pane capture + JSONL parsing → ACP notifications + normalized domain events
- **Interaction model:** Send-keys to terminal → Structured prompts + approval actions via API
- **State model:** tmux health polling → Event-driven state from AcpBackend + Redis pub/sub

The dashboard must become a **native ACP control plane**, not a terminal mirror (Epic §9).

---

## 2. Component Tree

```
pages/SessionDetailPage.tsx          ← Route: /sessions/:id (rewritten)
├── SessionShell.tsx                 ← New: Layout orchestrator
│   ├── ControlRail.tsx              ← New: Persistent sidebar
│   │   ├── SessionStateBadge
│   │   ├── RoleIndicator            ← New: driver/observer
│   │   ├── RoleControls             ← New: claim/release/transfer
│   │   ├── PauseResumeButton        ← New
│   │   ├── InterventionButton       ← New
│   │   ├── ActiveToolCard           ← New
│   │   ├── PendingApprovalCard      ← New
│   │   ├── TokenMeter               ← Refactor from existing
│   │   ├── ModelProviderBadge       ← New
│   │   └── BackendHealthDot         ← New
│   ├── TabNav.tsx                   ← New: Overview | Chat | Terminal | Timeline | Transcript | Settings
│   └── <TabContent>                 ← Conditional render by active tab
│       ├── OverviewTab.tsx          ← Refactor from current overview section
│       ├── ChatView.tsx             ← New (ACP-081)
│       │   ├── ChatMessageList.tsx  ← New
│       │   │   ├── AssistantText.tsx
│       │   │   ├── ThinkingBlock.tsx
│       │   │   ├── ToolCallCard.tsx ← New (ACP-082)
│       │   │   ├── ToolResultCard.tsx ← New (ACP-082)
│       │   │   ├── DiffCard.tsx     ← New (ACP-082)
│       │   │   └── ApprovalModal.tsx ← New (ACP-083)
│       │   ├── DriverInput.tsx      ← New: prompt input with pause/resume
│       │   └── TokenUsageBar.tsx    ← Refactor
│       ├── TerminalView.tsx         ← Refactor from TerminalPassthrough (ACP-086)
│       ├── TimelineView.tsx         ← New (ACP-087)
│       │   └── TimelineEntry.tsx
│       ├── TranscriptView.tsx       ← Existing (minor refactor)
│       └── SettingsTab.tsx          ← New
```

### Key Design Decisions

1. **SessionShell** replaces the monolithic page. It owns layout (rail + tab content) and active tab state.
2. **ControlRail** is always visible (desktop) or a bottom sheet (mobile). Never hidden.
3. **ChatView** is the default tab (not terminal). Terminal is for debugging only.
4. **Tabs are URL-driven** (`?tab=chat|terminal|timeline|transcript|overview|settings`) — survives reload and link sharing.

---

## 3. Props & State

### 3.1 SessionShell

```typescript
interface SessionShellProps {
  sessionId: string;
}
```

Internal state (managed via Zustand slice or local state):
```typescript
interface SessionShellState {
  activeTab: Tab;
  session: AcpSessionInfo | null;
  loading: boolean;
  error: string | null;
  controlRailCollapsed: boolean;
}
```

### 3.2 ControlRail

```typescript
interface ControlRailProps {
  session: AcpSessionInfo;
  role: AcpRole;                    // 'driver' | 'observer' | null
  onClaim: () => void;
  onRelease: () => void;
  onTransfer: (targetUserId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onIntervene: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}
```

### 3.3 ChatView

```typescript
interface ChatViewProps {
  sessionId: string;
  events: AcpChatEvent[];           // Append-only event buffer
  pendingApproval: AcpApprovalRequest | null;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
  onSendPrompt: (text: string) => void;
  onPause: () => void;
  disabled: boolean;                 // true when not driver or session paused
}
```

### 3.4 TerminalView

```typescript
interface TerminalViewProps {
  sessionId: string;
  role: AcpRole;
  readOnly: boolean;                 // true for observers
}
```

### 3.5 TimelineView

```typescript
interface TimelineViewProps {
  sessionId: string;
  events: AcpTimelineEvent[];
  filters: TimelineFilters;
  onFilterChange: (filters: TimelineFilters) => void;
}
```

---

## 4. New Types (ACP Dashboard)

These types will live in `types/acp.ts` and replace tmux-specific types incrementally.

```typescript
// ── Session Identity (replaces windowId/windowName) ─────────────
interface AcpSessionInfo {
  id: string;                       // aegisSessionId
  acpProcessId: string;
  status: AcpSessionStatus;
  model: string;
  provider: string;
  role: AcpRole | null;             // current user's role
  driverId: string | null;
  createdAt: string;                // ISO 8601
  lastActivity: string;
  workDir: string;
  tokenUsage: TokenUsage;
  health: AcpBackendHealth;
  pendingApproval: AcpApprovalRequest | null;
  activeTool: ActiveToolInfo | null;
  isPaused: boolean;
  intervention: InterventionState | null;
}

type AcpSessionStatus = 
  | 'starting' | 'idle' | 'running' | 'waiting_approval' 
  | 'paused' | 'intervened' | 'ended' | 'error';

type AcpRole = 'driver' | 'observer';

// ── Chat Events (from ACP notification stream) ──────────────────
type AcpChatEvent =
  | AcpTextEvent
  | AcpThinkingEvent
  | AcpToolCallEvent
  | AcpToolResultEvent
  | AcpDiffEvent
  | AcpApprovalRequestEvent
  | AcpSystemEvent;

interface AcpTextEvent {
  type: 'text';
  id: string;
  sessionId: string;
  content: string;
  timestamp: string;
}

interface AcpThinkingEvent {
  type: 'thinking';
  id: string;
  sessionId: string;
  content: string;
  timestamp: string;
}

interface AcpToolCallEvent {
  type: 'tool_call';
  id: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
}

interface AcpToolResultEvent {
  type: 'tool_result';
  id: string;
  sessionId: string;
  toolCallId: string;
  output: string;
  isError: boolean;
  timestamp: string;
}

interface AcpDiffEvent {
  type: 'diff';
  id: string;
  sessionId: string;
  file: string;
  additions: number;
  deletions: number;
  patch: string;
  timestamp: string;
}

interface AcpApprovalRequestEvent {
  type: 'approval_request';
  id: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
}

// ── Timeline Events ─────────────────────────────────────────────
type AcpTimelineEvent = {
  id: string;
  sessionId: string;
  type: TimelineEventType;
  actor: string;
  tenant?: string;
  detail: string;
  timestamp: string;
};

type TimelineEventType =
  | 'driver_claimed' | 'driver_released' | 'driver_transferred' | 'driver_revoked'
  | 'prompt_submitted' | 'tool_started' | 'tool_completed' | 'tool_failed'
  | 'approval_requested' | 'approval_responded' | 'approval_timed_out'
  | 'session_paused' | 'session_resumed' | 'intervention_started' | 'intervention_completed'
  | 'child_restart' | 'acp_protocol_error' | 'backend_health_transition';

// ── Approval ────────────────────────────────────────────────────
interface AcpApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  requestedAt: string;
  expiresAt?: string;
}

// ── Token Usage ─────────────────────────────────────────────────
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

// ── Backend Health ──────────────────────────────────────────────
interface AcpBackendHealth {
  status: 'healthy' | 'degraded' | 'error';
  lastError?: string;
  acpProtocolOk: boolean;
}

// ── Intervention ────────────────────────────────────────────────
interface InterventionState {
  reason: string;
  startedAt: string;
  actionRequired?: string;
}
```

---

## 5. SSE Event Consumption

### Current Model (tmux)
```
GlobalSSE → Layout.tsx (singleton) → useStore.addActivity()
SessionSSE → StreamTab → TerminalPassthrough (WebSocket) + TranscriptViewer (SSE)
```

### New Model (ACP)
```
GlobalSSE → Layout.tsx (singleton) → useStore.addActivity()
                                      → useStore.updateSessionHealth()
SessionSSE → AcpEventStream (new hook) → ChatEventBuffer (append-only)
                                       → TimelineEventBuffer (append-only)
                                       → ApprovalState (latest)
                                       → SessionHealthState (derived)
```

### 5.1 New Hook: `useAcpSessionEvents`

```typescript
function useAcpSessionEvents(sessionId: string): {
  chatEvents: AcpChatEvent[];
  timelineEvents: AcpTimelineEvent[];
  pendingApproval: AcpApprovalRequest | null;
  isConnected: boolean;
  error: string | null;
} {
  // Connects to GET /v1/sessions/:id/sse
  // Parses ACP notification events into typed buffers
  // Returns sorted, deduplicated event arrays
  // Handles reconnection, backpressure, and cursor-based pagination
}
```

### 5.2 Event Mapping

| ACP JSON-RPC Notification | Dashboard Event | Tab |
|---|---|---|
| `notifications/text` | `AcpTextEvent` | Chat |
| `notifications/thinking` | `AcpThinkingEvent` | Chat |
| `notifications/tool_use` | `AcpToolCallEvent` | Chat |
| `notifications/tool_result` | `AcpToolResultEvent` | Chat |
| `notifications/diff` | `AcpDiffEvent` | Chat |
| `notifications/approval_request` | `AcpApprovalRequestEvent` | Chat + ControlRail |
| `state/running` | timeline `prompt_submitted` | Timeline |
| `state/paused` | timeline `session_paused` | Timeline + ControlRail |
| `state/error` | timeline `acp_protocol_error` | Timeline |
| (domain event: driver_claim) | timeline `driver_claimed` | Timeline |
| (domain event: approval_respond) | timeline `approval_responded` | Timeline |

The exact mapping depends on M0-M2 backend implementation. This design is event-type agnostic — the hook receives normalized `SessionSSEEvent` objects and maps them to typed ACP events based on `event.data.type`.

### 5.3 Backpressure & Pagination

- Chat events: Buffer last 500 events client-side. Fetch older via `GET /v1/sessions/:id/events?cursor=...` (paginated).
- Timeline events: Same pattern. Server-side cursor pagination.
- Both use `id` (monotonic) as cursor for stable ordering.

---

## 6. API Endpoints Consumed

### New/Modified (ACP)
| Endpoint | Purpose | Used by |
|---|---|---|
| `GET /v1/sessions/:id` | Session info (ACP-native schema) | SessionShell |
| `GET /v1/sessions/:id/sse` | Per-session event stream | useAcpSessionEvents |
| `POST /v1/sessions/:id/prompt` | Send prompt (driver only) | DriverInput |
| `POST /v1/sessions/:id/approve` | Approve tool use | ApprovalModal |
| `POST /v1/sessions/:id/reject` | Reject tool use | ApprovalModal |
| `POST /v1/sessions/:id/pause` | Pause session | ControlRail |
| `POST /v1/sessions/:id/resume` | Resume session | ControlRail |
| `POST /v1/sessions/:id/intervene` | Start intervention | ControlRail |
| `POST /v1/sessions/:id/claim` | Claim driver role | ControlRail |
| `POST /v1/sessions/:id/release` | Release driver role | ControlRail |
| `POST /v1/sessions/:id/transfer` | Transfer driver role | ControlRail |
| `GET /v1/sessions/:id/events` | Paginated event replay | ChatView, TimelineView |
| `GET /v1/sessions/:id/timeline` | Paginated timeline | TimelineView |
| `WS /v1/sessions/:id/terminal` | Raw terminal debug stream | TerminalView |

### Kept (unchanged)
| Endpoint | Purpose |
|---|---|
| `GET /v1/events` | Global SSE (Layout.tsx) |
| `GET /v1/sessions` | Session list |
| `GET /v1/health` | Health check |

### Removed (tmux-specific)
| Endpoint | Reason |
|---|---|
| `GET /v1/sessions/:id/pane` | tmux pane capture |
| `POST /v1/sessions/:id/input` | tmux send-keys |
| `GET /v1/sessions/:id/transcript` | JSONL transcript parsing |

---

## 7. Zustand Store Changes

### New Slice: `useAcpSessionStore`

```typescript
interface AcpSessionState {
  // Per-session state (keyed by sessionId)
  chatBuffers: Record<string, AcpChatEvent[]>;
  timelineBuffers: Record<string, AcpTimelineEvent[]>;
  pendingApprovals: Record<string, AcpApprovalRequest | null>;
  
  // Actions
  appendChatEvent: (sessionId: string, event: AcpChatEvent) => void;
  appendTimelineEvent: (sessionId: string, event: AcpTimelineEvent) => void;
  setPendingApproval: (sessionId: string, approval: AcpApprovalRequest | null) => void;
  clearSession: (sessionId: string) => void;
}
```

### Modifications to `useStore`
- Remove `windowId`/`windowName` from `SessionInfo` equality check (breaking: done in M3 via ACP-060)
- Add `AcpSessionInfo` fields (id, acpProcessId, role, etc.)
- Remove tmux-specific health polling state

---

## 8. Migration Strategy

The ACP session shell is **not a big-bang rewrite**. It's incremental:

### Phase A: Shell + Routing (ACP-080)
1. Create `SessionShell.tsx` with ControlRail + tab navigation
2. Wire tabs to existing components (Chat → current TranscriptView, Terminal → current TerminalPassthrough)
3. Add ControlRail with read-only session state (status, health, token usage)
4. Route: `/sessions/:id` renders `SessionShell` instead of monolithic `SessionDetailPage`

### Phase B: Chat View (ACP-081, ACP-082)
1. Build `ChatView.tsx` with event buffer from `useAcpSessionEvents`
2. Render `AcpTextEvent`, `AcpThinkingEvent`, `AcpToolCallEvent`, `AcpToolResultEvent`
3. Build `DriverInput.tsx` with prompt submission
4. Wire `POST /v1/sessions/:id/prompt`

### Phase C: Approval + Controls (ACP-083, ACP-084, ACP-085)
1. Build `ApprovalModal.tsx` (inline in chat, not a page)
2. Wire `POST /v1/sessions/:id/approve` and `POST /v1/sessions/:id/reject`
3. Build role controls (claim/release/transfer) in ControlRail
4. Build pause/resume/intervention controls

### Phase D: Terminal + Timeline (ACP-086, ACP-087)
1. Refactor `TerminalPassthrough` → `TerminalView` (ACP WebSocket, not tmux)
2. Build `TimelineView.tsx` with paginated timeline events
3. Wire `WS /v1/sessions/:id/terminal` for raw terminal debug

### Phase E: Polish + Tests (ACP-088)
1. Playwright coverage for all ACP event types
2. Keyboard navigation and a11y audit
3. Mobile responsive for all new components

---

## 9. Accessibility Requirements

- **ControlRail:** All actions have visible text labels + aria-labels. Collapsible with `aria-expanded`.
- **ChatView:** Messages use `role="log"` with `aria-live="polite"`. New messages announced to screen readers.
- **TerminalView:** `role="application"` (terminal is non-standard input). Clear indication it's read-only for observers.
- **TimelineView:** Semantic ordered list. Filter controls have `aria-label`.
- **ApprovalModal:** Focus trap, Escape dismiss, `aria-modal="true"`, auto-focus on first action button.
- **TabNav:** `role="tablist"` / `role="tab"` / `role="tabpanel"`. Arrow key navigation between tabs.
- **DriverInput:** `aria-label` on send button. Disabled state communicated via `aria-disabled`.

---

## 10. Open Questions (for M3 resolution)

1. **Event pagination cursor format** — `id` (monotonic integer) or `timestamp`? Depends on AcpEventStore implementation (ACP-023).
2. **Terminal WebSocket protocol** — Does ACP terminal extension use the same `pane`/`status`/`error` message types, or a new protocol? Depends on ACP-013 spike.
3. **Driver role enforcement** — Is `role` included in session GET response, or does the dashboard need a separate `GET /v1/sessions/:id/role` endpoint? Depends on ACP-061.
4. **Chat snapshot caching** — Does `GET /v1/sessions/:id/events` return rendered snapshots (from AcpChatCache) or raw events? Affects client-side rendering complexity. Depends on ACP-025.
5. **Intervention UX** — What does the intervention flow look like from the dashboard? Is it just a pause + message, or a structured form? Needs product input.

---

## 11. Dependencies on Backend (blocking)

| Blocker | ACP Issue | What I Need |
|---|---|---|
| Session GET schema | ACP-061 | `AcpSessionInfo` shape confirmed |
| Event stream format | ACP-011, ACP-043 | `SessionSSEEvent.data` shape for ACP events |
| Approval endpoints | ACP-064 | `POST approve/reject` request/response shapes |
| Control endpoints | ACP-064 | `POST pause/resume/intervene/claim/release/transfer` shapes |
| Chat cache | ACP-025 | Paginated event replay response shape |
| Terminal bridge | ACP-047 | WebSocket protocol for terminal debug |
| Driver/observer presence | ACP-028 | Role resolution mechanism |

**I can start Phase A (shell + routing) and Phase B (chat view structure) with mocked data.** Real API wiring waits for M3 contracts.

---

## 12. File Organization

```
dashboard/src/
├── components/
│   └── acp/                         ← New ACP-specific components
│       ├── SessionShell.tsx
│       ├── ControlRail.tsx
│       ├── TabNav.tsx
│       ├── ChatView.tsx
│       ├── ChatMessageList.tsx
│       ├── AssistantText.tsx
│       ├── ThinkingBlock.tsx
│       ├── ToolCallCard.tsx
│       ├── ToolResultCard.tsx
│       ├── DiffCard.tsx
│       ├── ApprovalModal.tsx
│       ├── DriverInput.tsx
│       ├── TerminalView.tsx          ← Refactor from session/TerminalPassthrough
│       ├── TimelineView.tsx
│       ├── TimelineEntry.tsx
│       ├── TokenMeter.tsx
│       ├── ModelProviderBadge.tsx
│       ├── RoleIndicator.tsx
│       ├── RoleControls.tsx
│       ├── PauseResumeButton.tsx
│       ├── InterventionButton.tsx
│       └── ActiveToolCard.tsx
├── hooks/
│   └── useAcpSessionEvents.ts       ← New
├── store/
│   └── useAcpSessionStore.ts        ← New
├── types/
│   └── acp.ts                       ← New
└── pages/
    └── SessionDetailPage.tsx         ← Rewritten to use SessionShell
```

---

## Appendix A: Current vs Target Comparison

| Aspect | Current (tmux) | Target (ACP) |
|---|---|---|
| Session identity | `windowId`, `windowName` | `aegisSessionId`, `acpProcessId` |
| Primary view | Terminal (split/terminal/transcript) | Chat (default), Terminal (debug) |
| Input method | Send-keys to tmux pane | `POST /v1/sessions/:id/prompt` |
| Approval flow | Parse terminal for prompt, send Y/n keypress | `POST approve/reject` + inline modal |
| Health monitoring | Poll pane status, detect tmux crash | Event-driven from AcpBackend health |
| Event source | tmux pane capture + JSONL transcript | ACP JSON-RPC notifications → normalized SSE |
| Real-time | WebSocket to tmux pane | SSE event stream + WebSocket terminal debug |
| State persistence | File-based JSONL | Postgres (team) / file (local) |
| Role management | N/A (single operator) | Driver/observer with RBAC |
| Session control | Kill, restart | Pause, resume, intervene, claim, release |
