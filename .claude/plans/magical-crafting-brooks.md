# Plan: Add loading/empty/error states to 6 dashboard pages

## Context

Issue #2653 — UX audit found 6 pages with missing loading, empty, or error states. Users see blank screens when data is loading, empty, or fails. The codebase already has **unused shared components** (`Skeleton.tsx`, `EmptyState.tsx`, `ErrorState.tsx`) — the fix is to adopt them consistently.

## Strategy

Use existing shared components rather than adding new ones. Each page gets loading → error → empty → content flow where applicable.

## Changes per page

### 1. ActivityPage.tsx — Add loading + error fallback
- **Loading**: `MetricCards` already shows its own skeleton (line 79 of MetricCards.tsx). Wrap `LiveAuditStream` section with a `SkeletonCard` fallback.
- **Error**: Wrap the content area in `ErrorBoundary` from `shared/ErrorBoundary.tsx`. No API call to retry at page level.

### 2. OverviewPage.tsx — Add loading indicator for SessionTable
- `SessionTable` already handles its own loading (skeleton rows) and empty state internally (lines 797, 973). `HomeStatusPanel` has no async state. Page is fine — **no changes needed**.

### 3. SessionsPage.tsx — Add loading state to Active tab
- Replace the inline `LoadingFallback` spinner with `SkeletonTable` from shared `Skeleton.tsx`.
- The Active tab's `SessionTable` already handles its own loading/empty/error states internally. No page-level changes needed beyond the Suspense fallback fix.

### 4. SettingsPage.tsx — Add save error feedback
- Pure client-side page — no loading state needed (localStorage is synchronous).
- **Add**: Track `saveError` state, show inline error banner when `saveSettings()` throws. Wrap the save in try/catch (currently silently swallows errors via empty `catch {}`).

### 5. AuthKeysPage.tsx — Refactor to shared components
- Already has all 3 states but uses inline ad-hoc JSX.
- **Loading** (line 352): Replace `<div className="animate-pulse">Loading auth keys…</div>` with `SkeletonTable` from shared.
- **Error** (line 356): Replace inline amber box with `ErrorState variant="server-5xx"` with `onRetry={fetchKeys}`.
- **Empty** (line 368): Replace inline dashed-border box with `EmptyState` component.

### 6. CostPage.tsx — Add loading + empty + error states
- Currently uses synchronous mock data — zero states.
- **Loading**: Add a brief loading state (`SkeletonStatCard` × 4 + `SkeletonCard` × 2 for chart areas).
- **Empty**: When `dailyData` is empty (all zeros), show `EmptyState` with `DollarSign` icon.
- **Error**: Add try/catch around data generation with `ErrorState` fallback.

## Files to modify

1. `dashboard/src/pages/ActivityPage.tsx` — wrap in ErrorBoundary
2. `dashboard/src/pages/SessionsPage.tsx` — use SkeletonTable for Suspense fallback
3. `dashboard/src/pages/SettingsPage.tsx` — add save error feedback
4. `dashboard/src/pages/AuthKeysPage.tsx` — refactor inline states to shared components
5. `dashboard/src/pages/CostPage.tsx` — add loading/empty/error states

**No new files created.** All shared components already exist.

## Verification

```bash
cd dashboard && npx tsc --noEmit   # type check
npm run build:dashboard             # build
cd .. && npm run gate               # full quality gate
```

Visual verification: load each page in the browser and confirm skeleton → content flow, empty state when data is cleared, and error state when API is unreachable.
