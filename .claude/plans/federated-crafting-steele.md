# Plan: Issue #2087 — Metrics Aggregation Dashboard

## Context

Aegis exposes Prometheus metrics and a global `/v1/metrics` JSON endpoint, but has no aggregated view across time ranges, no per-key breakdown, no anomaly detection. Teams can't answer "how many sessions this week?" or "which API keys cost the most?". This adds a backend aggregation endpoint and a dashboard page to visualize it.

## Scope

### Backend
1. New types in `src/api-contracts.ts`
2. Aggregation logic as a new method on `MetricsCollector` (in `src/metrics.ts`)
3. New route `GET /v1/metrics/aggregate` in `src/routes/audit.ts`
4. Unit tests in `src/__tests__/`

### Frontend
5. New API client function + Zod schema
6. New `MetricsPage.tsx` with cards, time-series chart, by-key table, anomaly flags
7. Route + nav integration in App.tsx and Layout.tsx
8. CSV export button

## Files to modify

| File | Change |
|------|--------|
| `src/api-contracts.ts` | Add `AggregateMetricsResponse`, `AggregateMetricsTimePoint`, `AggregateMetricsByKey`, `AggregateMetricsAnomaly` interfaces |
| `src/metrics.ts` | Add `getAggregatedMetrics(sessions, from, to, groupBy, auth)` method |
| `src/routes/audit.ts` | Add `GET /v1/metrics/aggregate` route with query validation + auth guard (operator/admin only) |
| `src/__tests__/metrics-aggregate-2087.test.ts` | New test file |
| `dashboard/src/api/client.ts` | Add `getMetricsAggregate(params)` function |
| `dashboard/src/api/schemas.ts` | Add `AggregateMetricsSchema` |
| `dashboard/src/pages/MetricsPage.tsx` | New page with summary cards, chart, table, CSV |
| `dashboard/src/App.tsx` | Add lazy route for `/metrics` |
| `dashboard/src/components/Layout.tsx` | Add Metrics nav item to OPERATIONS group |

## Implementation Details

### 1. Types (`src/api-contracts.ts`)

Add after `GlobalMetrics`:

```ts
export interface AggregateMetricsTimePoint {
  timestamp: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  tokenCostUsd: number;
}

export interface AggregateMetricsByKey {
  keyId: string;
  keyName: string;
  sessions: number;
  messages: number;
  toolCalls: number;
  tokenCostUsd: number;
}

export interface AggregateMetricsAnomaly {
  sessionId: string;
  tokenCostUsd: number;
  reason: string;
}

export interface AggregateMetricsResponse {
  summary: {
    totalSessions: number;
    avgDurationSeconds: number;
    totalTokenCostUsd: number;
    totalMessages: number;
    totalToolCalls: number;
    permissionsApproved: number;
    permissionApprovalRate: number | null;
    stalls: number;
  };
  timeSeries: AggregateMetricsTimePoint[];
  byKey: AggregateMetricsByKey[];
  anomalies: AggregateMetricsAnomaly[];
}
```

### 2. Aggregation Logic (`src/metrics.ts`)

Add `getAggregatedMetrics` method on `MetricsCollector`. This method:
- Iterates `perSession` map (all sessions still in memory)
- Filters by `from`/`to` using `sessionStartTimes` map
- Groups by day/hour using truncated timestamps
- Aggregates per `ownerKeyId` using session data passed from caller
- Computes p95 of token cost, flags sessions > 3× p95 as anomalies
- Returns `AggregateMetricsResponse`

**Important**: `MetricsCollector` doesn't have direct access to `SessionManager` (where `ownerKeyId` lives). The route handler passes the session list and auth key lookup. This keeps the collector decoupled.

The route handler will:
1. Get sessions from `sessions.listSessions()` filtered by `createdAt`
2. Get per-session metrics from `metrics.getSessionMetrics(id)` for each
3. Look up key names from `auth.listKeys()` for the `byKey` breakdown
4. Group and aggregate in the handler

Actually, to keep logic testable and colocated, add a **standalone function** `computeAggregateMetrics(sessions, perSessionMetrics, keyMap, from, to, groupBy)` that does the pure aggregation. The route calls it with data gathered from services.

### 3. Route (`src/routes/audit.ts`)

Add inside `registerAuditRoutes`:

```
GET /v1/metrics/aggregate
  Auth: requireRole('admin', 'operator') — NO viewer
  Query params: from (ISO8601, default 7d ago), to (ISO8601, default now), groupBy ('day'|'hour'|'key', default 'day')
```

Pattern: same as `/v1/audit` — Zod query schema, `registerWithLegacy`, `requireRole`.

### 4. Tests (`src/__tests__/metrics-aggregate-2087.test.ts`)

Test the standalone `computeAggregateMetrics` function directly:
- Empty data → zeros
- Time range filtering
- Day/hour grouping
- Per-key aggregation
- Anomaly detection (p95 × 3)
- Edge: single session, all same cost

### 5. Dashboard API (`dashboard/src/api/client.ts` + `schemas.ts`)

Add `getMetricsAggregate(params)` function with Zod validation.

### 6. Dashboard Page (`dashboard/src/pages/MetricsPage.tsx`)

Follow CostPage patterns:
- 4 summary cards (total sessions, avg duration, total cost, approval rate)
- BarChart (Recharts) for time-series sessions + cost
- Table for by-key breakdown
- Anomaly badges
- Date range selector (7d / 30d / 90d presets)
- CSV export using `downloadCSV` utility

### 7. Integration

- `App.tsx`: lazy import + route `/metrics`
- `Layout.tsx`: add `{ to: '/metrics', label: 'Metrics', icon: BarChart3 }` to OPERATIONS group

## Verification

```bash
npm test -- --run          # Unit tests pass
npm run build              # TypeScript compiles + dashboard builds
npm run gate               # Full quality gate
```
