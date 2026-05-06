# Fix: Session Counter Mismatch Across Endpoints (#2533)

## Context

Three endpoints return different session counts for the same server:
- `/v1/analytics/costs` → `totalSessions` summed from `costTrends` (only live sessions)
- `/v1/analytics/summary` → `errorRates.totalSessions` from cumulative counter
- `/v1/sessions/stats` → `totalCreated` from cumulative counter

**Root cause**: `MetricsCache.recompute()` clears all daily buckets and rebuilds only from `sessions.listSessions()`. Killed sessions vanish from the daily breakdown while cumulative counters keep growing.

## Changes

### 1. `src/services/metrics-cache.ts` — Preserve daily creation counts across recomputes

**`recompute()`** (line 258):
- Before clearing `dailyMap`, snapshot each day's `created` count into a temp map
- After rebuilding from live sessions, merge: `day.created = max(prev, live)` for each date
- This ensures killed sessions remain in their creation-day bucket

**`handleEvent()`** (line 244):
- On `session_created`, immediately increment the daily bucket's `created` count using the event timestamp for the date key. This prevents lost counts if sessions are created and killed before the next `getMetrics()` call.

No changes to `CacheFile`, `hydrate()`, or `flush()` — the existing `daily.created` field already persists correctly, and the merge in `recompute()` will preserve hydrated values.

### 2. `src/routes/analytics.ts` — Fix `/v1/analytics/costs` totalSessions

**Line 44**: Replace:
```ts
const totalSessions = metrics.costTrends.reduce((sum, d) => sum + d.sessions, 0);
```
with:
```ts
const totalSessions = metrics.errorRates.totalSessions;
```

This aligns `totalSessions` with the same cumulative counter used by `/v1/analytics/summary` and `/v1/sessions/stats`.

### 3. Test updates

**`src/__tests__/metrics-cache-2250.test.ts`**:
- Add `getSession` to the mock `SessionManager` (needed by the `handleEvent` change)
- Add test: "preserves daily creation count when session is removed" — verifies that after killing a session, `costTrends[].sessions` and `sessionVolume[].created` still reflect the original creation count

**`src/__tests__/analytics-cost-2246.test.ts`**:
- Update mock `errorRates.totalSessions` to match a realistic value (e.g., 8)
- Update `totalSessions` assertion from `5` (sum of costTrends) to `8` (from errorRates)
- Add test: "uses errorRates.totalSessions for totalSessions, not costTrends sum"

## Files to modify

1. `src/services/metrics-cache.ts` — recompute merge + handleEvent increment
2. `src/routes/analytics.ts` — costs endpoint totalSessions fix
3. `src/__tests__/metrics-cache-2250.test.ts` — new test for killed session preservation
4. `src/__tests__/analytics-cost-2246.test.ts` — update assertions

## Verification

1. `npm test` — all existing + new tests pass
2. `npx tsc --noEmit` — type checks
3. `npm run gate` — full quality gate
