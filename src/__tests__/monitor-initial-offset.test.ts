import { expect, test } from 'vitest';
import { SessionMonitor, DEFAULT_MONITOR_CONFIG } from '../monitor.js';

test('monitor passes numeric initial offset to JsonlWatcher.watch when session.monitorOffset is undefined', async () => {
  // sessions stub: returns one session with undefined monitorOffset
  const sessionObj = { id: 'sess-1', jsonlPath: '/tmp/fake-session.jsonl', monitorOffset: undefined } as any;
  const sessionsStub = {
    listSessions: () => [sessionObj],
    readMessagesForMonitor: async (_id: string) => ({ messages: [], status: 'idle', statusText: null, interactiveContent: null }),
  } as any;

  const channelsStub = { statusChange: async (_: any) => {} } as any;

  let capturedOffset: any = undefined;
  const watcherStub = {
    entries: {} as Record<string, boolean>,
    watch(sessionId: string, jsonlPath: string, initialOffset: any) {
      this.entries[sessionId] = true;
      capturedOffset = initialOffset;
    },
    unwatch(sessionId: string) { delete this.entries[sessionId]; },
    isWatching(sessionId: string) { return !!this.entries[sessionId]; },
    onEntries(_listener: any) { return () => {}; },
  } as any;

  const monitor = new SessionMonitor(sessionsStub, channelsStub, DEFAULT_MONITOR_CONFIG);
  monitor.setJsonlWatcher(watcherStub);

  // Prevent health/stall/dead checks from running in this unit test run
  (monitor as any).lastTmuxHealthCheck = Date.now();
  (monitor as any).lastStallCheck = Date.now();
  (monitor as any).lastDeadCheck = Date.now();

  // Call the internal poll once
  await (monitor as any).poll();

  // After poll, watcher.watch should have been invoked with numeric offset 0
  expect(capturedOffset).toBe(0);
});
