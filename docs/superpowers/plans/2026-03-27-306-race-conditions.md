# #306: Dashboard Race Conditions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 confirmed race condition / stale closure bugs across dashboard components.

**Architecture:** Each fix is independent and touches different files. No shared infrastructure needed. Changes are localized to the specific component + store.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest (dashboard tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `dashboard/src/types/index.ts` | Modify | Export `RowHealth` type |
| `dashboard/src/store/useStore.ts` | Modify | Add `healthMap` state + `setSessionsAndHealth` action |
| `dashboard/src/components/overview/SessionTable.tsx` | Modify | Use store for healthMap, parallel fetch |
| `dashboard/src/components/session/TranscriptViewer.tsx` | Modify | Set-backed dedup |
| `dashboard/src/components/Layout.tsx` | Modify | Debounced SSE disconnect |
| `dashboard/src/components/CreateSessionModal.tsx` | Modify | Abort previous on resubmit |
| `dashboard/src/__tests__/store.test.ts` | Create | Unit tests for new store actions |

---

### Task 1: Export RowHealth type

**Files:**
- Modify: `dashboard/src/types/index.ts:62`

- [ ] **Step 1: Add RowHealth interface after SessionHealth**

After the `SessionHealth` interface (line 62), add:

```typescript
export interface RowHealth {
  alive: boolean;
  loading: boolean;
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/types/index.ts
git commit -m "feat(dashboard): export RowHealth type for session health map"
```

---

### Task 2: Add healthMap to Zustand store

**Files:**
- Modify: `dashboard/src/store/useStore.ts`
- Create: `dashboard/src/__tests__/store.test.ts`

- [ ] **Step 1: Write failing tests for setSessionsAndHealth**

Create `dashboard/src/__tests__/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';
import type { SessionInfo, RowHealth } from '../types';

const mockSession: SessionInfo = {
  id: 's1',
  windowId: 'w1',
  windowName: 'test',
  workDir: '/tmp',
  status: 'idle',
  createdAt: Date.now(),
  lastActivity: Date.now(),
  stallThresholdMs: 300000,
  permissionMode: 'default',
};

const mockHealth: RowHealth = { alive: true, loading: false };

describe('useStore', () => {
  beforeEach(() => {
    useStore.setState({
      sessions: [],
      healthMap: {},
    });
  });

  describe('setSessionsAndHealth', () => {
    it('sets sessions and healthMap atomically', () => {
      const healthMap: Record<string, RowHealth> = { s1: mockHealth };

      useStore.getState().setSessionsAndHealth([mockSession], healthMap);

      const state = useStore.getState();
      expect(state.sessions).toEqual([mockSession]);
      expect(state.healthMap).toEqual(healthMap);
    });

    it('replaces previous state entirely', () => {
      const oldSession: SessionInfo = {
        ...mockSession,
        id: 'old',
      };
      useStore.setState({
        sessions: [oldSession],
        healthMap: { old: mockHealth },
      });

      useStore.getState().setSessionsAndHealth([mockSession], { s1: mockHealth });

      const state = useStore.getState();
      expect(state.sessions).toEqual([mockSession]);
      expect(state.healthMap).toEqual({ s1: mockHealth });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npx vitest run src/__tests__/store.test.ts`
Expected: FAIL — `setSessionsAndHealth` does not exist

- [ ] **Step 3: Implement setSessionsAndHealth in the store**

In `dashboard/src/store/useStore.ts`:

1. Add import for `RowHealth`:
```typescript
import type { SessionInfo, GlobalMetrics, ParsedEntry, GlobalSSEEvent, GlobalSSEEventType, RowHealth } from '../types';
```

2. Add to `AppState` interface:
```typescript
  // Session health map (keyed by session ID)
  healthMap: Record<string, RowHealth>;
  setSessionsAndHealth: (sessions: SessionInfo[], healthMap: Record<string, RowHealth>) => void;
```

3. Add to the store implementation (after `setSessions`):
```typescript
  // Session health map
  healthMap: {},
  setSessionsAndHealth: (sessions, healthMap) => set({ sessions, healthMap }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npx vitest run src/__tests__/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/store/useStore.ts dashboard/src/__tests__/store.test.ts
git commit -m "feat(dashboard): add healthMap and setSessionsAndHealth to store"
```

---

### Task 3: Fix SessionTable two-step update

**Files:**
- Modify: `dashboard/src/components/overview/SessionTable.tsx`

- [ ] **Step 1: Refactor SessionTable to use store and parallel fetch**

In `SessionTable.tsx`, make these changes:

1. Remove local `healthMap` state and `useState` import for it:
   - Remove: `const [healthMap, setHealthMap] = useState<Record<string, RowHealth>>({});`
   - Add: `const healthMap = useStore((s) => s.healthMap);`
   - Add: `const setSessionsAndHealth = useStore((s) => s.setSessionsAndHealth);`
   - Add `RowHealth` to the import from types: `import type { SessionInfo } from '../../types';` → `import type { SessionInfo, RowHealth } from '../../types';`

2. Replace `fetchSessions` with parallel fetch + atomic update:
```typescript
  const fetchSessions = useCallback(async () => {
    try {
      const [list, healthResults] = await Promise.all([
        getSessions(),
        getAllSessionsHealth(),
      ]);

      const liveIds = new Set(list.sessions.map((s) => s.id));
      const healthMap: Record<string, RowHealth> = {};
      for (const [id, health] of Object.entries(healthResults)) {
        if (liveIds.has(id)) {
          healthMap[id] = { alive: health.alive, loading: false };
        }
      }

      setSessionsAndHealth(list.sessions, healthMap);
    } catch (e: unknown) {
      addToast('error', 'Failed to fetch sessions', e instanceof Error ? e.message : undefined);
    }
  }, [addToast, setSessionsAndHealth]);
```

3. Remove the local `RowHealth` interface definition (lines 20-23) since it's now in `types/index.ts`.

- [ ] **Step 2: Verify no type errors**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `cd dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/overview/SessionTable.tsx
git commit -m "fix(dashboard): atomic sessions + healthMap update in SessionTable (#306)"
```

---

### Task 4: Fix TranscriptViewer O(n) dedup

**Files:**
- Modify: `dashboard/src/components/session/TranscriptViewer.tsx`

- [ ] **Step 1: Add Set-backed dedup**

In `TranscriptViewer.tsx`, make these changes:

1. Add a `seenTimestamps` ref after the existing refs (after line 30):
```typescript
  const seenTimestamps = useRef<Set<string>>(new Set());
```

2. In the initial fetch effect (lines 33-50), populate the Set when messages load:
```typescript
    getSessionMessages(sessionId)
      .then(data => {
        if (!cancelled) {
          const msgs = data.messages ?? [];
          setMessages(msgs);
          seenTimestamps.current = new Set(
            msgs.map(m => m.timestamp).filter((t): t is string => !!t),
          );
        }
      })
```

3. In the SSE effect (lines 53-71), replace O(n) dedup with O(1):
```typescript
        setMessages(prev => {
          if (data.timestamp && seenTimestamps.current.has(data.timestamp)) return prev;
          if (data.timestamp) seenTimestamps.current.add(data.timestamp);
          return [...prev, data];
        });
```

- [ ] **Step 2: Verify no type errors**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `cd dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/session/TranscriptViewer.tsx
git commit -m "perf(dashboard): O(1) dedup in TranscriptViewer via Set (#306)"
```

---

### Task 5: Fix Layout SSE flicker

**Files:**
- Modify: `dashboard/src/components/Layout.tsx`

- [ ] **Step 1: Add debounced disconnect to Layout**

In `Layout.tsx`, make these changes:

1. Add `useRef` import alongside existing `useEffect`:
```typescript
import { useEffect, useRef } from 'react';
```

2. Add a disconnect timer ref inside the component (after `const token = ...`):
```typescript
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

3. Replace the SSE effect (lines 28-40) with debounced version:
```typescript
  useEffect(() => {
    const unsubscribe = subscribeGlobalSSE((event) => {
      if (!event.sessionId) return;
      addActivity(event);
    }, token, {
      onOpen: () => {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        setSseConnected(true);
      },
      onClose: () => {
        disconnectTimerRef.current = setTimeout(() => {
          setSseConnected(false);
        }, 2000);
      },
    });

    return () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
      unsubscribe();
    };
  }, [setSseConnected, addActivity, token]);
```

- [ ] **Step 2: Verify no type errors**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `cd dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/Layout.tsx
git commit -m "fix(dashboard): debounce SSE disconnect indicator to prevent flicker (#306)"
```

---

### Task 6: Fix CreateSessionModal orphan abort

**Files:**
- Modify: `dashboard/src/components/CreateSessionModal.tsx`

- [ ] **Step 1: Abort previous request on submit**

In `CreateSessionModal.tsx`, in the `handleSubmit` function (line 97), add abort before creating new controller. Change lines 106-108 from:

```typescript
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
```

To:

```typescript
    setLoading(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
```

- [ ] **Step 2: Verify no type errors**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `cd dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/components/CreateSessionModal.tsx
git commit -m "fix(dashboard): abort previous request on double-submit in CreateSessionModal (#306)"
```

---

### Task 7: Final verification and push

- [ ] **Step 1: Run full type check**

Run: `cd dashboard && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `cd dashboard && npx vitest run`
Expected: All tests pass

- [ ] **Step 3: Run dashboard build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds
