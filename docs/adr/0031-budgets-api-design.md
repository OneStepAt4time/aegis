# ADR-0031: /v1/budgets API Design for Cost Alerts

**Status:** Proposed  
**Date:** 2026-05-25  
**Issue:** #4196 — backend: /v1/budgets API design (spec)  
**Epic:** #4192 — v0.7.0 | #4194 — Cost Alerts feature

## Context

Aegis already tracks per-session and aggregate costs via `/v1/cost` and persists `MeteringRecord` entries in `metering.jsonl`. The next step is **Cost Alerts**: let the solo developer define spending budgets and get notified when thresholds approach or breach.

This ADR sketches the API surface, data model, evaluation strategy, and persistence for budgets.

## Decision

### 1. Data Model

```typescript
interface Budget {
  /** Unique budget identifier (UUIDv4). */
  id: string;
  /** Human-readable name (e.g. "Weekly Claude spend"). */
  name: string;
  /** API key scope — null = all keys (global budget). */
  keyId: string | null;
  /** Maximum spend in USD (must be > 0). */
  limitUsd: number;
  /** Threshold percentages that trigger alerts (e.g. [50, 80, 100]). */
  thresholds: number[];
  /** Time window for evaluation. */
  window: BudgetWindow;
  /** Channels to notify (at least one required). */
  channels: NotificationChannel[];
  /** Whether this budget is active. */
  enabled: boolean;
  /** ISO 8601 — when the budget was created. */
  createdAt: string;
  /** ISO 8601 — last modification time. */
  updatedAt: string;
  /** ISO 8601 — last evaluation time (null if never evaluated). */
  lastEvaluatedAt: string | null;
}

interface BudgetWindow {
  /** "rolling" = last N hours/days; "calendar" = resets at period boundary. */
  kind: "rolling" | "calendar";
  /** Window size in hours (1–720, i.e. up to 30 days). */
  hours: number;
}

type NotificationChannel =
  | { type: "telegram"; chatId: number }
  | { type: "webhook"; url: string }
  | { type: "log" }; // StructuredLogger only — for testing
```

**Key design choices:**
- `keyId: null` means global scope (all API keys). This supports both single-key solo devs and multi-key setups.
- Thresholds are percentage-based arrays, not a single value. This enables multi-stage alerts (warn → critical → breach).
- `NotificationChannel` is a tagged union for extensibility (Discord/Slack can be added later without schema changes).
- Window supports both rolling (last 24h) and calendar (daily/weekly/monthly reset) models.

### 2. API Endpoints

All endpoints require Bearer auth (admin role). Base path: `/v1/budgets`.

#### `POST /v1/budgets` — Create budget

```json
// Request
{
  "name": "Weekly Claude spend",
  "keyId": null,
  "limitUsd": 50.00,
  "thresholds": [50, 80, 100],
  "window": { "kind": "rolling", "hours": 168 },
  "channels": [{ "type": "telegram", "chatId": 123456789 }],
  "enabled": true
}

// Response 201
{
  "budget": { /* full Budget object */ }
}
```

Validation:
- `name`: required, 1–128 chars
- `limitUsd`: required, > 0, max 1_000_000
- `thresholds`: required, 1–10 items, each 1–200 (allow >100 for overage alerts), sorted ascending, no duplicates
- `window.kind`: "rolling" | "calendar"
- `window.hours`: 1–720
- `channels`: required, 1–10 items, validated per type
- `enabled`: optional, defaults to true

#### `GET /v1/budgets` — List budgets

```
GET /v1/budgets?keyId=<optional>&enabled=<optional>
```

```json
// Response 200
{
  "budgets": [ /* Budget[] */ ],
  "total": 5
}
```

Supports optional filters: `keyId` (exact match or `null` for global), `enabled` (boolean).

#### `GET /v1/budgets/:budgetId` — Get single budget

```json
// Response 200
{ "budget": { /* Budget */ } }

// Response 404
{ "code": "NOT_FOUND", "message": "Budget not found" }
```

#### `PATCH /v1/budgets/:budgetId` — Update budget

Partial update. All fields from the create request are mutable except `id` and `createdAt`.

```json
// Request
{ "limitUsd": 75.00, "thresholds": [50, 75, 90, 100] }

// Response 200
{ "budget": { /* updated Budget */ } }
```

`updatedAt` is auto-set. If `enabled` changes from `false` to `true`, `lastEvaluatedAt` is reset to `null`.

#### `DELETE /v1/budgets/:budgetId` — Delete budget

```json
// Response 204 (no body)
```

Irreversible. Does not delete historical alert events (they reference the budget ID for audit).

#### `POST /v1/budgets/:budgetId/evaluate` — Manual evaluation trigger

Forces an immediate evaluation cycle for a specific budget. Useful for testing alert setup.

```json
// Response 200
{
  "budgetId": "...",
  "windowStart": "2026-05-18T09:00:00Z",
  "windowEnd": "2026-05-25T09:00:00Z",
  "currentSpendUsd": 32.50,
  "limitUsd": 50.00,
  "percentUsed": 65.0,
  "triggeredThresholds": [50],
  "alertsSent": 1
}
```

### 3. Persistence

**Storage:** `JsonFileStore` at `~/.aegis/budgets.json`.

```json
{
  "version": 1,
  "budgets": [
    { /* Budget */ },
    { /* Budget */ }
  ]
}
```

**Rationale:** Aegis already uses `JsonFileStore` for keys, settings, and hooks. No new infra. Budgets are low-volume (expected 1–10 per instance), so file-based is fine.

**Migration:** No migration needed — file is created on first write. Absence of the file means zero budgets.

### 4. Evaluation Strategy

#### Aggregation

Evaluation sums `costUsd` from `MeteringRecord` entries within the budget's time window, filtered by `keyId` (or all keys if global).

```
currentSpendUsd = SUM(metering.records WHERE
  timestamp >= windowStart AND timestamp < windowEnd
  AND (budget.keyId IS NULL OR record.keyId = budget.keyId)
).costUsd
```

#### Window calculation

- **Rolling:** `windowStart = now - window.hours * 3600 * 1000`
- **Calendar:** Aligned to natural boundaries:
  - `hours=24` → daily reset at midnight local (or UTC)
  - `hours=168` → weekly reset on Monday 00:00
  - `hours=720` → monthly reset on 1st of month

#### Evaluation trigger

Budgets are evaluated:
1. **On a timer** — every `N` minutes (configurable, default 5 min, min 1 min). Only evaluates budgets whose `enabled=true`.
2. **On demand** — via `POST /v1/budgets/:id/evaluate`.
3. **After metering write** — optional fast-path: after each `MeteringRecord` write, check if any budget's highest threshold might be breached. This avoids alert latency for rapid spend.

**Threshold deduplication:** Each `(budgetId, threshold)` pair can only fire once per window cycle. Track fired thresholds in memory (reset on window rollover). Persist in `~/.aegis/budgets-state.json`:

```json
{
  "version": 1,
  "evaluations": {
    "<budgetId>": {
      "windowStart": "2026-05-18T09:00:00Z",
      "firedThresholds": [50, 80],
      "lastAlertAt": "2026-05-24T14:32:00Z"
    }
  }
}
```

### 5. Telemetry Events

```typescript
// Emitted via StructuredLogger
budgetCreated      // { budgetId, name, limitUsd, window }
budgetUpdated      // { budgetId, changedFields }
budgetDeleted      // { budgetId }
budgetEvaluated    // { budgetId, currentSpendUsd, percentUsed, windowStart, windowEnd }
thresholdApproaching // { budgetId, threshold, currentSpendUsd, limitUsd }
thresholdExceeded    // { budgetId, threshold, currentSpendUsd, limitUsd }
alertSent          // { budgetId, threshold, channel, success }
alertFailed        // { budgetId, threshold, channel, error }
```

These events are also written to the existing audit log for compliance.

### 6. Notification Content

**Telegram:**
```
⚠️ Budget Alert: "Weekly Claude spend"
65% used ($32.50 / $50.00)
Window: rolling 168h (resets Mon 00:00)
Threshold: 50%
```

**Webhook:** JSON POST with budget metadata, current spend, threshold, and timestamp.

### 7. Test Plan

| Test | Description |
|------|-------------|
| CRUD happy path | Create, read, update, delete budget; verify persistence |
| Validation | Missing fields, invalid thresholds, empty channels |
| Scope filtering | Global vs key-scoped budgets; list with filters |
| Rolling window | Add metering records, verify correct aggregation |
| Calendar window | Verify alignment to period boundaries |
| Threshold firing | Spend crosses 50%, 80%, 100% — alerts sent |
| Dedup | Same threshold doesn't fire twice in same window |
| Window rollover | New period resets fired thresholds |
| Disable/enable | Disabled budget skips evaluation; re-enable resets state |
| Delete | Budget deleted; state cleaned; no orphan alerts |
| Unauthorized | Non-admin cannot access budget endpoints |
| Manual evaluate | POST evaluate returns correct state |
| Notification | Telegram + webhook + log channels receive alerts |

### 8. Backward Compatibility

- New endpoint, no breaking changes to existing APIs.
- `metering.jsonl` format unchanged — budgets only read from it.
- No config changes required — budgets default to empty (no budgets defined = no cost alerts).
- The evaluation timer is only started when at least one `enabled=true` budget exists.

### 9. Future Extensions (Out of Scope for v0.7.0)

- **Per-model budgets:** Add `modelPattern` to Budget for per-model spend limits.
- **Budget actions:** Auto-kill sessions or revoke keys on breach (currently alert-only).
- **Multi-tenant budgets:** Tenant-scoped budgets (Phase 4).
- **Dashboard UI:** Visual budget bars in the dashboard (Daedalus).
- **Budget history:** Historical spend vs budget over time.

## Consequences

- Solo devs get proactive cost visibility without checking the dashboard.
- The design reuses existing metering data and JsonFileStore — zero new infra.
- Alert-only (no auto-actions) keeps it safe for v0.7.0. Budget actions can be added later with a feature flag.
- The tagged union `NotificationChannel` is extensible for Discord, Slack, email without schema migration.
