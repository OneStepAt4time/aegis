# #306: Dashboard Race Conditions and Stale Closures

**Date:** 2026-03-27
**Status:** Approved
**Scope:** 4 confirmed issues (of 6 reported)

## Context

Issue #306 reports 6 race condition / stale closure bugs across dashboard components. After analysis, 4 are confirmed and 2 are already fixed or not real bugs:

- #1 (MetricCards race) — Already fixed in PR #304 (`Promise.all` + `useCallback`)
- #3 (TranscriptViewer double SSE) — Not a bug; React's effect cleanup ordering prevents double subscription
- **#2, #4, #5, #6** — Confirmed, to be fixed

## Fix #2: SessionTable Two-Step Update

**Problem:** `setSessions` and `setHealthMap` are separate state updates. A slow health fetch from poll N-1 can arrive after a fast sessions fetch from poll N, causing mismatched data.

**Solution:** Use `Promise.all` to fetch sessions and health in parallel, then apply both updates in a single Zustand `set()` call. This guarantees atomicity — the render always sees matching sessions and health data from the same poll cycle.

**Changes:**
- Add `healthMap` to the Zustand store (`dashboard/src/store/useStore.ts`) with a `setSessionsAndHealth(sessions, healthMap)` action that sets both in one `set()` call
- Remove local `useState<Record<string, RowHealth>>` from `SessionTable.tsx`
- Read `healthMap` from store instead of local state
- Change `fetchSessions` to use `Promise.all([getSessions(), getAllSessionsHealth()])` and call the combined setter
- Export `RowHealth` type from `types.ts`

## Fix #4: TranscriptViewer O(n) Dedup

**Problem:** `prev.some(m => m.timestamp === data.timestamp)` is O(n) per SSE message. Quadratic degradation over long sessions.

**Solution:** Maintain a `Set<string>` of seen timestamps in a `useRef`. O(1) lookup per message.

**Changes:**
- Add `const seenTimestamps = useRef<Set<string>>(new Set())` in `TranscriptViewer`
- On initial fetch: populate the Set from loaded messages
- On SSE message: check Set in O(1), add new timestamp to Set
- Clear the Set when `sessionId` changes (via the existing `sessionId`-dependent effect)

## Fix #5: Layout SSE Flicker

**Problem:** `onClose` fires on every transient SSE error/reconnect. The indicator flashes "SSE Off" momentarily during normal reconnection.

**Solution:** Debounce the disconnect signal. Only show "SSE Off" if disconnected for >2 seconds. Cancel the timer if reconnection succeeds.

**Changes:**
- Add a `useRef` for a timeout handle in `Layout.tsx`
- On `onClose`: start a 2s `setTimeout` that calls `setSseConnected(false)`
- On `onOpen`: clear the timer, call `setSseConnected(true)` immediately
- Cleanup the timer on effect unmount

## Fix #6: CreateSessionModal Orphan Abort

**Problem:** On rapid double-submit, the first `AbortController` is replaced but not aborted. The first request continues in-flight until it resolves or times out.

**Solution:** Abort the previous controller at the start of `handleSubmit`.

**Changes:**
- Add `abortRef.current?.abort()` as the first line of `handleSubmit` (before creating a new controller)
- The existing guard (`if (abortRef.current === controller)`) already prevents superseded requests from clearing loading state

## Files Modified

- `dashboard/src/store/useStore.ts` — add healthMap state
- `dashboard/src/components/overview/SessionTable.tsx` — use store for healthMap
- `dashboard/src/components/session/TranscriptViewer.tsx` — Set-backed dedup
- `dashboard/src/components/Layout.tsx` — debounced SSE disconnect
- `dashboard/src/components/CreateSessionModal.tsx` — abort previous request

## Testing

- Existing tests should pass unchanged (no test files for these dashboard components exist yet)
- Manual verification: open dashboard, observe no flicker on SSE reconnect, no stale health data in session table, no duplicate messages in transcript
