# Fix: Prompt Delivery Race Condition (#561)

**Status:** Approved
**Date:** 2026-03-30
**Issue:** #561
**Priority:** P1

## Problem

When creating a session with an initial prompt via `POST /v1/sessions`, the API reports `promptDelivery.delivered: true` but the prompt never appears in the Claude Code terminal. CC sits at the empty prompt awaiting input.

## Root Cause

Two interacting bugs:

1. **Weak readiness check** (`session.ts:372`): `waitForReadyAndSend` checks only `paneText.includes('❯')` to determine if CC is ready for input. The production idle detector (`detectUIState` in `terminal-parser.ts`) requires both the `❯` prompt character AND chrome separators (`─────`) to confirm `idle` state. The weaker check matches CC splash/startup output that contains `❯` before the TUI is ready.

2. **False-positive delivery verification** (`tmux.ts:651-652`): `verifyDelivery` returns `true` for `'unknown'` terminal state ("benefit of the doubt"). When CC is still initializing, the pane shows `unknown` state, so a prompt sent during boot gets falsely reported as delivered.

## Design

### Fix 1: Use `detectUIState` for readiness check

**File:** `src/session.ts` — `waitForReadyAndSend` method (lines 351-379)

**Change:** Replace `paneText.includes('❯')` with `detectUIState(paneText) === 'idle'`.

Import `detectUIState` from `terminal-parser.ts`. The polling loop already handles the timeout, so the only change is the condition inside the while loop.

**Before:**
```ts
if (paneText && paneText.includes('❯')) {
    return this.sendMessageDirect(sessionId, prompt);
}
```

**After:**
```ts
if (paneText && detectUIState(paneText) === 'idle') {
    return this.sendMessageDirect(sessionId, prompt);
}
```

### Fix 2: Post-send state transition verification

**File:** `src/session.ts` — `waitForReadyAndSend` method

**Change:** After `sendMessageDirect` returns with `delivered: true`, poll the pane for up to 5 seconds waiting for CC to transition to a recognized active state (`working`, `permission_prompt`, `bash_approval`, `plan_mode`, or `ask_question`). If CC remains in `idle` or `unknown`, report `delivered: false`.

This verification is only applied in `waitForReadyAndSend` (initial prompt path). The `verifyDelivery` function in `tmux.ts` remains unchanged — its "unknown = benefit of doubt" behavior is appropriate for interactive sessions where CC legitimately enters transient states.

**Post-send verification logic:**
```ts
// After sendMessageDirect returns delivered: true
const VERIFY_TIMEOUT_MS = 5000;
const VERIFY_POLL_MS = 500;
const verifyStart = Date.now();
while (Date.now() - verifyStart < VERIFY_TIMEOUT_MS) {
    const paneText = await this.tmux.capturePaneDirect(session.windowId);
    const state = detectUIState(paneText);
    if (state !== 'idle' && state !== 'unknown') {
        return result; // Confirmed: CC is processing the prompt
    }
    await new Promise(r => setTimeout(r, VERIFY_POLL_MS));
}
return { delivered: false, attempts: result.attempts };
```

### Fix 3: Update tests

**File:** `src/__tests__/prompt-delivery.test.ts`

Add test cases:
- Initial prompt waits for `detectUIState === 'idle'` (not just `❯` character)
- Post-send verification rejects `unknown` state as unconfirmed
- Post-send verification confirms delivery when CC transitions to `working`
- Post-send verification times out gracefully, returning `delivered: false`

## Files Changed

| File | Change |
|------|--------|
| `src/session.ts` | Replace readiness check, add post-send verification |
| `src/__tests__/prompt-delivery.test.ts` | New test cases for both fixes |

## Impact

- `verifyDelivery` in `tmux.ts` is **not changed** — interactive sessions unaffected
- `sendMessageDirect` in `session.ts` is **not changed** — only `waitForReadyAndSend` is modified
- Initial prompt delivery will be slightly slower (waits for true idle + post-send verification) but reliable
- No API contract changes — response shape remains `{ delivered: boolean; attempts: number }`
