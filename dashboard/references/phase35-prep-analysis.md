# Phase 3.5 Dashboard Prep Analysis

**Date:** 2026-05-04
**Author:** Daedalus

---

## 1. Phase 3.5 Epic — M4 Dashboard ACP UI

### Epic: #2574 (status: not-active, blocked by #2575)

The epic directory doesn't exist on disk yet (`.claude/epics/phase-3-5-acp-backend-migration/epic.md` — not created). All context comes from the GitHub issue #2574 body.

### Milestones relevant to dashboard:
- **M0** — ACP feasibility spike (backend)
- **M1** — SessionService, state machine, identity, Postgres stores, Redis coordination
- **M2** — ACP runtime and fanout (backend)
- **M3** — Breaking public contracts: REST, OpenAPI, SDKs, MCP
- **M4** — Dashboard ACP UI: Chat, Terminal, Timeline, control rail ← MY TERRITORY
- **M5** — Cutover and tmux retirement

### Dashboard issues (#2611-#2619) — all M4, all `status: not-active`:

| # | Title | Priority | Notes |
|---|-------|----------|-------|
| #2611 | ACP-080: Build ACP dashboard session shell and control rail | P2 | Layout shell for new session view |
| #2612 | ACP-081: Build ACP chat view with text, thinking, token usage | P2 | Chat-like interface replacing transcript |
| #2613 | ACP-082: Build tool-call and diff cards | P2 | Visual cards for tool invocations |
| #2614 | ACP-083: Build ACP approval modal | P1 | Permission/approval flow |
| #2615 | ACP-084: Build driver and observer controls | P1 | Session control (driver/observer modes) |
| #2616 | ACP-085: Build pause, resume, intervention UI | P1 | Session lifecycle controls |
| #2617 | ACP-086: Build raw terminal debug tab | P2 | xterm.js debug view |
| #2618 | ACP-087: Build operator timeline view | P2 | Timeline of session events |
| #2619 | ACP-088: Add Playwright coverage for ACP dashboard views | P2 | E2E test coverage |

### Key architectural insight:
> "Dashboard Chat, Terminal, and Timeline views work from the same normalized event stream."

This means M4 needs a single event normalization layer that feeds all three views. The current dashboard uses separate polling hooks per data type — this needs to converge on SSE/WebSocket event consumption.

---

## 2. Bundle Analysis

### Total bundle: **605.9 KB gzip** (12 MB uncompressed, 40 JS chunks)

### Top 5 chunks by gzip size:

| Chunk | Raw | Gzip | What it contains |
|-------|-----|------|-----------------|
| `icons-vendor` | 611 KB | **152 KB** | lucide-react (48 imports across codebase) |
| `charts-vendor` | 388 KB | **113 KB** | recharts (5 imports) |
| `index` | 286 KB | **91 KB** | React Router, core app shell |
| `terminal-vendor` | 289 KB | **68 KB** | @xterm/xterm + addon-fit (4 imports) |
| `react-vendor` | 179 KB | **56 KB** | React + ReactDOM |

### Vite warnings: 2 chunks > 500 KB (icons-vendor, charts-vendor)

### Dependency audit:

| Dep | Size (gzip) | Imports | Verdict |
|-----|------------|---------|---------|
| `lucide-react` | 152 KB | 48 files | **OVERKILL** — tree-shaking not working. Need barrel import audit |
| `recharts` | 113 KB | 5 files | Heavy for 5 usages. Consider lightweight alternatives or lazy-load |
| `@xterm/xterm` | 68 KB | 4 files | Essential for terminal. Keep but lazy-load |
| `framer-motion` | (in index) | 15 files | Check if all 15 usages are necessary |
| `react-router-dom` | (in index) | core | Keep |
| `canvas-confetti` | tiny | 1 file | Fine |
| `@tanstack/react-virtual` | 5 KB | 1 file | Keep — replaces react-window (both installed!) |
| `react-window` | (check) | ? | **DUPLICATE** — @tanstack/react-virtual does the same thing |

### Action items before M4:
1. **Fix lucide-react tree-shaking** — 152 KB for icons is absurd. Switch to direct named imports or audit barrel setup.
2. **Lazy-load recharts** — Only 5 pages use charts. Dynamic import saves 113 KB on initial load.
3. **Remove react-window** — Duplicate of @tanstack/react-virtual.
4. **Lazy-load xterm** — Terminal is only on SessionDetailPage. 68 KB saved on initial load.
5. **Audit framer-motion** — 15 imports; check if simpler CSS transitions could replace some.

### Estimated savings: **~333 KB gzip** (55% of total) with lazy-loading + tree-shake fixes.

---

## 3. Component Inventory — Reusability Assessment for M4

### REUSABLE (minimal or no changes needed):
- components/shared/* — ConfirmDialog, CopyButton, EmptyState, ErrorBoundary, Skeleton, CodeBlock, etc.
- components/StatusDot.tsx
- components/session/TokenBreakdown.tsx
- components/session/ApprovalBanner.tsx (will need ACP event mapping)
- components/session/SessionStateBadge.tsx
- components/session/SessionHeader.tsx (layout reusable)
- components/overview/MetricCards*.tsx
- components/overview/SparkLine.tsx
- components/ConfirmDialog.tsx
- components/ToastContainer.tsx
- design/tokens.ts, design/motion.ts
- All stores (need schema updates, not rewrites)
- All utils (formatDate, sanitizeStream, etc.)

### NEEDS ADAPTATION (tmux-to-ACP event mapping):
- hooks/useSessionPolling.ts — currently polls pane endpoint; needs ACP event stream
- hooks/useSessionEvents.ts — event types need ACP mapping
- hooks/useSessionRealtimeUpdates.ts — SSE event names change
- api/schemas.ts — tmux schema block needs replacement with ACP schemas
- api/client.ts — new ACP-specific endpoints
- types/index.ts — pane type to ACP event types
- components/session/TranscriptBubble.tsx — transcript format may change
- components/session/TranscriptViewer.tsx — needs event stream consumption
- components/session/LiveTerminal.tsx — xterm backend changes (WebSocket vs tmux)
- components/session/StreamSplitView.tsx — layout reusable, data layer changes
- pages/SessionDetailPage.tsx — major refactor for ACP session model

### LIKELY REPLACED (tmux-specific):
- components/session/TerminalPassthrough.tsx — tmux-specific
- components/session/PanePreview.tsx — tmux pane concept
- hooks/useSseAwarePolling.ts — if we go full SSE/event-driven
- store/useStore.ts — significant schema changes for ACP session model

### NEEDED for M4 (new components):
- Session shell / control rail (#2611)
- Chat view with text + thinking blocks + token usage (#2612)
- Tool-call card component (#2613)
- Diff card component (#2613)
- ACP approval modal (#2614)
- Driver/observer mode toggle (#2615)
- Pause/resume/intervention controls (#2616)
- Raw terminal debug tab (#2617) — can reuse xterm, different backend
- Operator timeline view (#2618)

---

## 4. Tmux Coupling Depth

Files with deep tmux coupling (schema, types, data layer):
- api/schemas.ts — tmux schema object (line 153)
- types/index.ts — pane type (line 179)
- hooks/useSessionPolling.ts — pane fetching logic
- store/useStore.ts — session model with tmux fields

Files with shallow tmux references (UI labels, comments):
- Most page components — display "tmux" in labels/columns that become "ACP"
- SessionDetailPage, SessionHistoryPage — column headers, filters

---

## 5. Recommended Prep Order for M4

1. **Bundle optimization** (can do now) — lazy-load + tree-shake fixes
2. **Component extraction** — extract reusable pieces from session components
3. **Event normalization layer** — design the SSE event to UI state mapping
4. **Session shell layout** — #2611, the container for all M4 views
5. **Chat view** — #2612, the primary interaction surface
6. **Tool-call/diff cards** — #2613
7. **Approval modal** — #2614 (P1)
8. **Driver/observer + pause/resume** — #2615, #2616 (P1)
9. **Timeline** — #2618
10. **Raw terminal debug** — #2617
11. **Playwright coverage** — #2619
