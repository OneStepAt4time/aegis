# Dashboard Competitive Analysis — v0.7.0 Vision

> **Author:** Daedalus (Frontend Architect)
> **Date:** 2026-05-25
> **Context:** Boss requested product thinking on where the Aegis dashboard should go next.
> Target audience: solo dev / small team running 1–100 CC agents.

---

## Competitors Analyzed

### 1. Claude Code — Native UI (Terminal + VS Code + Desktop)

**Session management:**
- Terminal: single session, scrollback, slash commands (`/help`, `/model`, `/undo`)
- VS Code extension: **multi-tab sessions** — each conversation opens as a full editor tab. Activity Bar shows session list.
- Desktop app: **side-by-side sessions**, scheduled recurring tasks, cloud sessions

**Key UX patterns:**
- Inline diff review — side-by-side original vs proposed, accept/reject/edit before applying
- Permission modes: normal (ask), auto-accept edits, auto-accept all — selectable per prompt
- `@-mention` files with line ranges (`@file.ts#5-10`) — contextual file references
- Plan review: Claude shows plan → user reviews → then executes
- Onboarding checklist with "Show me" interactive walkthrough

**Cost tracking:** None visible in terminal. VS Code shows model name. Desktop app likely has usage tracking under account settings.

**Multi-agent:** No native multi-agent. Single session at a time (desktop app adds parallel cloud sessions).

### 2. Cline — VS Code Extension + CLI + Kanban

**Session management:**
- VS Code: single agent panel with conversation history
- CLI: terminal TUI, headless mode for CI/CD
- **Kanban** (research preview): web-based task board — THIS IS THEIR KILLER FEATURE

**Kanban — what it does well:**
- Each task card = one agent session with its own **worktree** (no merge conflicts)
- Real-time status on cards: latest message or tool call visible without opening
- Click card → see agent TUI + diff of all changes in that worktree
- **Dependency chains**: ⌘+click to link cards; when one completes, next auto-starts
- Auto-commit / auto-PR per card
- Inline comments on diff lines → sent back to agent
- Script Shortcuts: play buttons for common commands (`npm run dev`)
- Branch management UI: full git interface without leaving the board

**Key UX patterns:**
- Plan mode vs Act mode toggle
- Checkpoints for every edit (undo capability)
- `.clinerules` project-specific behavior files

**Cost tracking:** Per-model token counting visible during session. No aggregate dashboard.

**Multi-agent:** Kanban IS multi-agent. This is the most advanced parallel agent UX in the market.

### 3. Cursor — IDE-Native Agent

**Session management:**
- Agent mode embedded in editor chat panel
- Inline diffs in editor (not separate view)
- Apply/reject individual hunks
- Multi-file edits shown sequentially

**Key UX patterns:**
- Context chips: @files, @folders, @web, @docs, @git
- "Ask" mode vs "Agent" mode
- Error detection: auto-runs linter/tests and fixes before showing result
- Tool calls shown as expandable inline blocks

**Cost tracking:** Usage-based billing in account. Not shown per-session in editor.

**Multi-agent:** None. Single agent at a time.

### 4. Aider — Terminal-Only

**Session management:**
- Pure terminal: `aider>` prompt, chat history in scrollback
- `/undo` command to revert last AI change
- Git-based checkpointing (auto-commits with sensible messages)

**Key UX patterns:**
- Repo map: auto-generates codebase map for context
- Voice input mode
- Watch mode: add comments in code, aider picks them up from editor
- `/model` command to switch models mid-session

**Cost tracking:** Token counts shown per prompt in terminal output. No dashboard.

**Multi-agent:** None.

---

## Gap Analysis: Aegis vs Competitors

### What Aegis Dashboard Already Does Well

| Feature | Status |
|---------|--------|
| Session list with real-time status | Full |
| Session detail with transcript viewer | Full |
| Live terminal (xterm.js) | Full |
| Token/cost tracking per session | Full |
| Aggregate analytics (KPIs, charts, model distribution) | Full |
| Approval/reject workflow | Full |
| Audit trail | Full |
| SSE real-time updates | Full |
| Dark theme, responsive, a11y | Full |
| Auth with RBAC | Full |
| Pipeline management | Full |
| Templates + Routines | Full |
| i18n (Italian catalog) | Scaffolding |

### What We're Missing — Ranked by Impact for Solo Dev

#### P0: Must-Have for v0.7.0

**1. Live Agent Status Dashboard (Cline Kanban pattern)**
- **Gap:** Our session list shows status (active/completed/failed) but doesn't show *what the agent is doing right now*.
- **Competitor:** Cline Kanban shows latest message/tool call on each card at a glance.
- **Proposal:** Add a "live feed" to each session row — latest tool call or message preview. Like a mini activity indicator. No need to open the session to know what's happening.
- **Effort:** Medium (SSE already streams events, just surface them in the list)

**2. Session Quick Actions (approve/reject/kill from list)**
- **Gap:** Approving requires opening session detail, scrolling to the pending approval.
- **Competitor:** CC Desktop has inline permission prompts.
- **Proposal:** Inline action buttons on session rows when `status=permission_prompt`. One-click approve/reject without navigating away.
- **Effort:** Small (API already exists, just add UI)

**3. Cost Alert System**
- **Gap:** We show costs after the fact (analytics page). No proactive alerts.
- **Competitor:** Nobody does this well. Opportunity.
- **Proposal:** Budget thresholds per session or per day — toast notification when approaching/exceeding. "Session XYZ has spent $2.40 (80% of your $3/session budget)."
- **Effort:** Medium (needs backend budget tracking, dashboard just displays)

#### P1: Strong Differentiators

**4. Multi-Agent Board View (Cline Kanban-inspired)**
- **Gap:** Our Sessions page is a flat list. When running 10+ agents, you can't see the big picture.
- **Competitor:** Cline Kanban's card-based board is killer for parallel work.
- **Proposal:** Toggle between list view and "board view" — cards arranged by status (active/pending/completed). Each card shows: session name, model, cost-so-far, latest action, time elapsed. Drag to reprioritize.
- **Effort:** Large (new page component, but data model already exists)

**5. Diff Review in Dashboard**
- **Gap:** We show terminal output and transcript, but not file diffs.
- **Competitor:** CC Desktop, Cursor, Cline all show inline diffs.
- **Proposal:** When agent makes file edits, show a diff tab in SessionDetail (like GitHub PR diff view). Read-only at first.
- **Effort:** Large (needs backend diff streaming, frontend diff viewer component)

**6. Session Comparison View**
- **Gap:** No way to compare two sessions side by side.
- **Proposal:** Split-pane view — two sessions' transcripts/diffs/stats side by side. Useful for A/B testing prompts or comparing model outputs.
- **Effort:** Medium

#### P2: Nice-to-Have

**7. Command Palette**
- **Gap:** We lazy-load one but it's basic.
- **Competitor:** CC's slash commands are core to the workflow.
- **Proposal:** Enhance with session actions: switch session, kill session, filter by model, jump to page.

**8. Mobile Approval Flow**
- **Gap:** Dashboard is responsive but approval on mobile is clunky.
- **Competitor:** Nobody has a good mobile approval UX.
- **Proposal:** PWA push notifications for pending approvals. Swipe to approve/reject. This is the "approve from your phone" vision from Ema's solo-dev focus.
- **Effort:** Large (PWA + push notification infrastructure)

**9. Session Templates as "One-Click Launch"**
- **Gap:** Templates exist but launching from one feels heavy.
- **Competitor:** CC Desktop has scheduled tasks.
- **Proposal:** Template cards on Overview page with play button — instant session launch with pre-filled params.

---

## v0.7.0 Recommended Roadmap

Based on solo-dev focus and effort/impact:

### v0.7.0 (Next Release)
1. **Live Agent Status** — surface latest action in session rows (P0, medium effort)
2. **Quick Approve/Reject** — inline action buttons on session list (P0, small effort)
3. **Cost Alerts** — budget thresholds with toast notifications (P0, medium effort)

### v0.7.1
4. **Board View** — card-based multi-agent visualization (P1, large effort)
5. **Enhanced Command Palette** — session actions, filters, navigation (P2, small effort)

### v0.8.0
6. **Diff Review** — inline file diffs in session detail (P1, large effort)
7. **Mobile Approval PWA** — push notifications + swipe UX (P2, large effort)
8. **Session Comparison** — side-by-side view (P1, medium effort)

---

## Key Insight: The Cline Kanban Threat

Cline's Kanban is the most dangerous competitive feature. It directly targets the "solo dev running multiple agents" use case that Aegis is aimed at. However:

- Kanban is a **research preview** (they say this explicitly)
- It only works with Cline's own CLI agent
- No enterprise features (RBAC, audit, webhooks)

**Aegis's advantage:** We have the infrastructure (RBAC, audit, webhooks, MCP hub). If we build the Kanban-style board view ON TOP of our control plane, we offer something Cline can't: visual multi-agent orchestration with enterprise-grade observability.

**The pitch:** "Cline Kanban gives you the board. Aegis gives you the board PLUS the security, audit trail, and approval workflows your team actually needs."

---

## Design Principles for v0.7.0

1. **Glanceable** — you should know what's happening across all sessions in 3 seconds
2. **Actionable** — common actions (approve, kill, filter) should be 1 click, not 3
3. **Progressive** — Overview shows summary — click for detail — click again for deep dive
4. **Mobile-first for approvals** — the solo dev approves from their phone
5. **Cost-transparent** — never let a session surprise you with a $50 bill

---

*Daedalus — Frontend Architect, Aegis Dashboard*
