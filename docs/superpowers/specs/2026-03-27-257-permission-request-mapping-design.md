# Fix #257: PermissionRequest Hook Event Mapped to Wrong Status

## Problem

`PermissionRequest` hook events are mapped to `'ask_question'` instead of `'permission_prompt'` in two locations. This breaks auto-approve fallback, permission stall detection, and status broadcasts for sessions using hook-driven status.

## Root Cause

Two independent status detection paths exist:
- **Hook-driven:** `hooks.ts` → `session.ts` (incorrect mapping)
- **Terminal-driven:** `terminal-parser.ts` → `session.ts` (correct mapping)

The hook-driven path maps `PermissionRequest` → `'ask_question'`. The terminal parser correctly returns `'permission_prompt'` for the same state. When a hook event arrives, it can overwrite the terminal parser's correct status via a race condition.

## Fix

Change the mapping in two source files from `'ask_question'` to `'permission_prompt'`:

1. `src/session.ts:427` — `updateStatusFromHook` method
2. `src/hooks.ts:87` — `hookToUIState` function

Update test expectations in three test files:

3. `src/__tests__/hooks.test.ts:27,286` — mock mapping and assertion
4. `src/__tests__/hook-permission-approval.test.ts:52` — mock mapping

No other changes needed. The downstream consumers (`monitor.ts` auto-approve, stall detection, channel broadcasts) already handle `'permission_prompt'` correctly.

## Verification

- `npx tsc --noEmit` — type check passes
- `npm test` — all tests pass with updated expectations
- `npm run build` — production build succeeds
