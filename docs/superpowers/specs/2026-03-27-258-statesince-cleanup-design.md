# Fix: stateSince entries not cleaned on non-idle transitions (#258)

## Problem

When a session transitions between non-idle states (e.g., `permission_prompt` → `working` → `permission_prompt`), `stateSince` entries from the first state persist. The `${session.id}:permission` timestamp from the first prompt is reused by the second prompt, causing:

- Premature stall notifications (5min threshold hit immediately)
- Premature auto-rejection of valid permissions (10min timeout hit immediately)

## Root Cause

`checkForStalls()` (lines 302-318) only cleans `stateSince` entries when `currentStatus === 'idle'`. No cleanup runs when transitioning away from `permission_prompt`, `bash_approval`, or `unknown` to another non-idle state.

## Design

### Approach: Clean on exit from specific states

When the current status changes away from a stalling state, clean that state's `stateSince` entry and associated `stallNotified` flags.

### Changes (src/monitor.ts only)

1. **Read `prevStatus` in `checkForStalls`** — Get the previous status from `this.lastStatus` (already tracked per session by `checkSession`).

2. **Clean permission tracking on exit** — When `prevStatus` was `permission_prompt` or `bash_approval` and `currentStatus` is different:
   - Delete `${session.id}:permission` from `stateSince`
   - Delete `${session.id}:perm-stall-notified` and `${session.id}:perm-timeout` from `stallNotified`

3. **Clean unknown tracking on exit** — When `prevStatus` was `unknown` and `currentStatus` is different:
   - Delete `${session.id}:unknown` from `stateSince`
   - Delete `${session.id}:unknown-stall-notified` from `stallNotified`

4. **Existing idle cleanup unchanged** — The catch-all idle block (lines 302-318) remains as-is for full cleanup when a session returns to idle.

### What stays the same

- Idle cleanup block (lines 302-318)
- `broadcastStatusChange` and `checkSession`
- Stall detection thresholds and notification logic
- Auto-reject logic
- No new data structures

### Testing

- Add test cases to the monitor tests covering:
  - `permission_prompt` → `working` → `permission_prompt` resets the permission timestamp
  - `bash_approval` → `working` → `bash_approval` resets the permission timestamp
  - `unknown` → `working` → `unknown` resets the unknown timestamp
  - Direct `permission_prompt` → `permission_prompt` (same state) does NOT reset
