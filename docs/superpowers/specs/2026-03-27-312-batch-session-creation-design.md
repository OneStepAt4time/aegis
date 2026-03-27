# Batch Session Creation — Frontend Design (#312)

## Scope

Frontend-only. The backend `POST /v1/sessions/batch` endpoint and the frontend `batchCreateSessions` API wrapper already exist.

## UI Approach: Tabs inside CreateSessionModal

Add a tab bar ("Single" / "Batch") to the top of the existing `CreateSessionModal`. Single mode is unchanged. Batch mode shows a list of session specs.

Modal width: `max-w-md` (single) → `max-w-2xl` (batch).

## Batch Mode Form

- **Shared Prompt** — optional textarea at the top; applies to rows without a per-row override
- **Session Rows** — dynamic list, each row: `workDir` (required), `name` (optional), `prompt` (optional override), remove button (disabled when only 1 row)
- **Add Row** button — max 10 rows
- **Permission Mode** — single select, shared across all rows

## Results Display

After submission, form is replaced by a results summary:
- Created/failed counts
- Links to created sessions (`/sessions/:id`)
- Error list for failed sessions

## Type Fix

Correct `batchCreateSessions` return type from `{ results: SessionInfo[] }` to match backend `BatchResult`: `{ sessions: [...], created: number, failed: number, errors: string[] }`.

## Testing

- Unit tests for batch form logic (add/remove rows, shared prompt override)
- Unit tests for results rendering
- Update `batchCreateSessions` test coverage

## Files to Change

| File | Change |
|------|--------|
| `dashboard/src/api/client.ts` | Fix `batchCreateSessions` return type |
| `dashboard/src/components/CreateSessionModal.tsx` | Add tab bar + batch mode form + results view |
| `dashboard/src/__tests__/CreateSessionModal.test.tsx` | New test file for batch functionality |
