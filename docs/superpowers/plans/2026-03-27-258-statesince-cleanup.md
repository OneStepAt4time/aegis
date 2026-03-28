# Fix stateSince Cleanup on Non-Idle Transitions (#258)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear `stateSince` and `stallNotified` entries when a session transitions away from `permission_prompt`/`bash_approval`/`unknown` — not just when transitioning to `idle`.

**Architecture:** The bug is in `checkForStalls()` in `src/monitor.ts`. The `${session.id}:permission` and `${session.id}:unknown` entries in `stateSince` (plus their stall notification guards in `stallNotified`) are only cleaned when the session reaches `idle` (lines 302-318). When a session oscillates between states (e.g., `permission_prompt` → `working` → `permission_prompt`), the stale entries cause premature stall/timeout detection. The fix adds cleanup logic that runs on every stall check: if the current status is NOT a given special state, delete that state's tracking entries.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing tests for permission state cleanup on non-idle transitions

**Files:**
- Test: `src/__tests__/monitor-fixes.test.ts`

- [ ] **Step 1: Add the failing test**

Append this `describe` block to `src/__tests__/monitor-fixes.test.ts`:

```typescript
describe('#258: stateSince entries cleaned on non-idle transitions', () => {
  it('should NOT clean permission state when still in permission_prompt', () => {
    // Simulate the cleanup logic we'll add: if NOT in permission state, clean it
    const currentStatus = 'permission_prompt';
    const sessionId = 'sess-1';

    const stateSince = new Map<string, number>();
    stateSince.set(`${sessionId}:permission`, 1000);

    // Only clean when NOT in permission state
    if (currentStatus !== 'permission_prompt' && currentStatus !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
    }

    expect(stateSince.has(`${sessionId}:permission`)).toBe(true);
  });

  it('should clean permission state when transitioning to working', () => {
    const currentStatus = 'working';
    const sessionId = 'sess-1';

    const stateSince = new Map<string, number>();
    stateSince.set(`${sessionId}:permission`, 1000);

    if (currentStatus !== 'permission_prompt' && currentStatus !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
    }

    expect(stateSince.has(`${sessionId}:permission`)).toBe(false);
  });

  it('should clean permission state when transitioning to unknown', () => {
    const currentStatus = 'unknown';
    const sessionId = 'sess-1';

    const stateSince = new Map<string, number>();
    stateSince.set(`${sessionId}:permission`, 1000);

    if (currentStatus !== 'permission_prompt' && currentStatus !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
    }

    expect(stateSince.has(`${sessionId}:permission`)).toBe(false);
  });

  it('should clean unknown state when transitioning away from unknown', () => {
    const currentStatus = 'working';
    const sessionId = 'sess-1';

    const stateSince = new Map<string, number>();
    stateSince.set(`${sessionId}:unknown`, 1000);

    if (currentStatus !== 'unknown') {
      stateSince.delete(`${sessionId}:unknown`);
    }

    expect(stateSince.has(`${sessionId}:unknown`)).toBe(false);
  });

  it('should NOT clean unknown state when still in unknown', () => {
    const currentStatus = 'unknown';
    const sessionId = 'sess-1';

    const stateSince = new Map<string, number>();
    stateSince.set(`${sessionId}:unknown`, 1000);

    if (currentStatus !== 'unknown') {
      stateSince.delete(`${sessionId}:unknown`);
    }

    expect(stateSince.has(`${sessionId}:unknown`)).toBe(true);
  });

  it('should reset stallNotified for permission when leaving permission state', () => {
    const currentStatus = 'working';
    const sessionId = 'sess-1';

    const stallNotified = new Set<string>();
    stallNotified.add(`${sessionId}:perm-stall-notified`);
    stallNotified.add(`${sessionId}:perm-timeout`);

    if (currentStatus !== 'permission_prompt' && currentStatus !== 'bash_approval') {
      stallNotified.delete(`${sessionId}:perm-stall-notified`);
      stallNotified.delete(`${sessionId}:perm-timeout`);
    }

    expect(stallNotified.has(`${sessionId}:perm-stall-notified`)).toBe(false);
    expect(stallNotified.has(`${sessionId}:perm-timeout`)).toBe(false);
  });

  it('should reset stallNotified for unknown when leaving unknown state', () => {
    const currentStatus = 'working';
    const sessionId = 'sess-1';

    const stallNotified = new Set<string>();
    stallNotified.add(`${sessionId}:unknown-stall-notified`);

    if (currentStatus !== 'unknown') {
      stallNotified.delete(`${sessionId}:unknown-stall-notified`);
    }

    expect(stallNotified.has(`${sessionId}:unknown-stall-notified`)).toBe(false);
  });

  it('should allow fresh permission stall after permission_prompt → working → permission_prompt', () => {
    // Simulate full oscillation cycle
    const sessionId = 'sess-1';
    const stateSince = new Map<string, number>();
    const stallNotified = new Set<string>();

    // Phase 1: permission_prompt
    const status1 = 'permission_prompt';
    if (status1 !== 'permission_prompt' && status1 !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
      stallNotified.delete(`${sessionId}:perm-stall-notified`);
      stallNotified.delete(`${sessionId}:perm-timeout`);
    }
    stateSince.set(`${sessionId}:permission`, 1000);
    stallNotified.add(`${sessionId}:perm-stall-notified`);

    // Phase 2: working (should clean permission entries)
    const status2 = 'working';
    if (status2 !== 'permission_prompt' && status2 !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
      stallNotified.delete(`${sessionId}:perm-stall-notified`);
      stallNotified.delete(`${sessionId}:perm-timeout`);
    }

    expect(stateSince.has(`${sessionId}:permission`)).toBe(false);
    expect(stallNotified.has(`${sessionId}:perm-stall-notified`)).toBe(false);

    // Phase 3: back to permission_prompt (fresh start)
    const status3 = 'permission_prompt';
    if (status3 !== 'permission_prompt' && status3 !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
      stallNotified.delete(`${sessionId}:perm-stall-notified`);
      stallNotified.delete(`${sessionId}:perm-timeout`);
    }
    stateSince.set(`${sessionId}:permission`, 5000);

    // Fresh timestamp, no stale notification guard
    expect(stateSince.get(`${sessionId}:permission`)).toBe(5000);
    expect(stallNotified.has(`${sessionId}:perm-stall-notified`)).toBe(false);
  });

  it('should not affect other session entries when cleaning', () => {
    const stateSince = new Map<string, number>();
    const stallNotified = new Set<string>();

    // Two sessions, only s1 transitions away from permission
    stateSince.set('s1:permission', 1000);
    stateSince.set('s2:permission', 1000);
    stallNotified.add('s1:perm-stall-notified');
    stallNotified.add('s2:perm-stall-notified');

    const currentStatus = 'working';
    const sessionId = 's1';

    if (currentStatus !== 'permission_prompt' && currentStatus !== 'bash_approval') {
      stateSince.delete(`${sessionId}:permission`);
      stallNotified.delete(`${sessionId}:perm-stall-notified`);
      stallNotified.delete(`${sessionId}:perm-timeout`);
    }

    expect(stateSince.has('s1:permission')).toBe(false);
    expect(stateSince.has('s2:permission')).toBe(true);
    expect(stallNotified.has('s1:perm-stall-notified')).toBe(false);
    expect(stallNotified.has('s2:perm-stall-notified')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they pass**

These tests validate the cleanup logic in isolation. They should all pass since they test the logic directly.

Run: `npx vitest run src/__tests__/monitor-fixes.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Commit the tests**

```bash
git add src/__tests__/monitor-fixes.test.ts
git commit -m "test: add tests for #258 stateSince cleanup on non-idle transitions

Generated by Hephaestus (Aegis dev agent)"
```

---

### Task 2: Implement the cleanup logic in `checkForStalls()`

**Files:**
- Modify: `src/monitor.ts:170-319` (`checkForStalls` method)

- [ ] **Step 1: Add cleanup for permission state entries when not in permission state**

In `src/monitor.ts`, in the `checkForStalls` method, add the following block **after** the Type 3 (unknown stall) block (after line 280) and **before** the Type 4 (extended stall) block (before line 282):

```typescript
      // Issue #258: Clean up state-specific tracking when transitioning AWAY
      // from that state. Without this, stale timestamps persist across
      // non-idle transitions (e.g., permission_prompt → working → permission_prompt),
      // causing premature stall notifications and auto-rejection.
      if (currentStatus !== 'permission_prompt' && currentStatus !== 'bash_approval') {
        this.stateSince.delete(`${session.id}:permission`);
        this.stallNotified.delete(`${session.id}:perm-stall-notified`);
        this.stallNotified.delete(`${session.id}:perm-timeout`);
      }
      if (currentStatus !== 'unknown') {
        this.stateSince.delete(`${session.id}:unknown`);
        this.stallNotified.delete(`${session.id}:unknown-stall-notified`);
      }
```

The insertion point is between the closing of the `if (currentStatus === 'unknown')` block (line 280) and the `// --- Type 4` comment (line 282).

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit the fix**

```bash
git add src/monitor.ts
git commit -m "fix: clean stateSince entries on non-idle state transitions (#258)

Clear ${session.id}:permission and ${session.id}:unknown entries from
stateSince when transitioning away from those states, not just when
reaching idle. Also clears associated stallNotified guards so fresh
stall/timeout detection starts correctly on re-entry.

Generated by Hephaestus (Aegis dev agent)"
```
