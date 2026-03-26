# Dashboard Comprehensive Review — Design Spec

**Date:** 2026-03-27
**Scope:** Full-stack review of Aegis dashboard (React SPA + backend API + SSE/WS + metrics)
**Priority:** Bugs/correctness first, then UX/visual quality, then new feature identification

## Background

The Aegis dashboard is a React 19 SPA served at `/dashboard/` by the Fastify backend. It has two pages (OverviewPage, SessionDetailPage) and consumes ~30 API endpoints via a typed Zod-validated client. Real-time updates use SSE. The frontend has zero component tests; only backend static-serving is tested.

## Phase 1: Backend API Verification

Run the existing test suite as a baseline. Verify all dashboard-facing API endpoints return correct data structures that match the frontend's Zod schemas.

**Actions:**
- Run `npm test` and fix any failures
- Spot-check API response shapes against `dashboard/src/api/schemas.ts`
- Verify key endpoints: `/v1/health`, `/v1/metrics`, `/v1/sessions`, `/v1/sessions/:id/events`, `/v1/events`
- Verify SSE event emission for all event types (status, message, system, approval, ended, heartbeat, stall, dead, hook, subagent_start, subagent_stop)

**Success criteria:** All existing tests pass, API responses match frontend schemas.

## Phase 2: SSE & Real-Time Layer

Verify SSE connections work correctly, events are delivered, and reconnection logic is solid.

**Actions:**
- Test global SSE (`/v1/events`) event fan-out
- Test per-session SSE (`/v1/sessions/:id/events`)
- Verify event payload structures match what TranscriptViewer and ActivityStream expect
- Check for memory leaks or stale connections in SessionEventBus
- Verify WebSocket terminal streaming endpoint

**Success criteria:** SSE events stream correctly, no drops or stale data.

## Phase 3: Frontend Code Review

Review all React components for bugs, accessibility issues, stale closures, race conditions, and missing error handling.

**Actions:**
- Review each component file for correctness
- Check Zustand stores (useStore, useToastStore) for state management bugs
- Verify polling intervals (10s metrics, 5s sessions) don't cause excessive API load
- Check SSE subscription lifecycle (connect, disconnect, reconnect, cleanup)
- Verify abort controller cleanup on unmount
- Check responsive design logic in SessionTable
- Review Zod validation error handling — are API errors shown to users gracefully?
- Check for potential XSS vectors in message rendering

**Success criteria:** No stale closures, proper cleanup, graceful error handling, no XSS vectors.

## Phase 4: Live Visual QA

Build dashboard, launch dev server + Aegis server, test every interactive feature in the browser via Chrome DevTools MCP.

**Actions:**
- Build dashboard (`npm run build:dashboard`)
- Launch Aegis server (`npm run dev`)
- OverviewPage: metric cards update, session table loads, activity stream flows, create session modal works
- SessionDetailPage: transcript renders messages, terminal preview works, metrics display, approval banner appears
- SSE connection indicator shows connected/disconnected
- Toast notifications appear for errors/successes
- Responsive layout (desktop + mobile viewports)
- Dark theme rendering
- Error boundary catches errors and shows fallback UI
- Keyboard navigation and accessibility

**Success criteria:** Every interactive element works, no console errors, responsive on all sizes.

## Phase 5: New Feature Identification

Based on findings from Phases 1-4, identify high-value features that are missing or would significantly improve the dashboard.

**Approach:**
- Analyze gaps between API data available and what the UI visualizes
- Review what the competitive analysis doc identifies as missing
- Consider operator workflows that could be streamlined
- Check which API endpoints exist but have no UI exposure (e.g., pipelines, auth keys, batch create, screenshot, bash, command)

**Deliverable:** Ranked list of feature proposals with rationale, effort estimate, and priority.

## Out of Scope

- Backend refactoring not related to dashboard correctness
- New dependencies
- Database or persistence changes
- Mobile native app

## Constraints

- No new dependencies without justification
- Changes must not break existing API contracts
- Dashboard must remain auth-bypassed (public access to static files)
- Must pass CI: `npm ci` → `npx tsc --noEmit` → `npm run build` → `npm test`
