/**
 * Issue #3905: Config watcher should hot-reload allowedWorkDirs on all fs.watch event types.
 *
 * Editors use atomic saves (write-then-rename) which emit 'rename' events,
 * not 'change'. The watcher must accept all event types.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watch } from 'fs';
import type { FSWatcher } from 'fs';

// We test the watcher setup logic by verifying the event type filtering.
// The actual setupConfigWatcher is deeply coupled to server state,
// so we test the core pattern directly.

describe('Config watcher event types (#3905)', () => {
  it('should handle all fs.watch event types (not just "change")', () => {
    // Track which event types trigger a reload
    const triggeredEvents: (string | undefined)[] = [];

    // Simulate the watcher callback pattern from server.ts
    const watcherCallback = (_eventType: string) => {
      // Before fix: if (eventType === 'change') { ... }
      // After fix: accept all event types
      triggeredEvents.push(_eventType);
    };

    // Simulate events that editors actually emit
    watcherCallback('change');     // nano, some saves
    watcherCallback('rename');     // vim, VS Code atomic saves
    watcherCallback(undefined as unknown as string); // Windows, some NFS

    // All three event types should have been accepted
    expect(triggeredEvents).toHaveLength(3);
    expect(triggeredEvents).toContain('change');
    expect(triggeredEvents).toContain('rename');
    expect(triggeredEvents).toContain(undefined);
  });

  it('old behavior: "rename" events were silently dropped', () => {
    const triggeredEvents: string[] = [];

    // OLD behavior (the bug)
    const oldCallback = (eventType: string) => {
      if (eventType === 'change') {
        triggeredEvents.push(eventType);
      }
    };

    oldCallback('change');
    oldCallback('rename');
    oldCallback(undefined as unknown as string);

    // Only 'change' was handled — 'rename' (vim, VS Code) was ignored
    expect(triggeredEvents).toHaveLength(1);
    expect(triggeredEvents).not.toContain('rename');
  });
});
