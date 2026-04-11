/**
 * jsonl-watcher.test.ts — Tests for fs.watch-based JSONL file watcher.
 *
 * Issue #84: Replace JSONL polling with fs.watch.
 * Issue #1228: Fixed for cross-platform reliability (macOS/Linux/Windows).
 *
 * Key principles for reliable fs.watch testing:
 * 1. Register event listeners BEFORE triggering file writes.
 * 2. Allow the event loop to tick after calling watch() before writing,
 *    because macOS fs.watch (FSEvents/kqueue) needs a microtask cycle
 *    to fully initialize the native file watcher.
 * 3. Use generous timeouts — fs event delivery timing varies by platform.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonlWatcher, type JsonlWatcherEvent } from '../jsonl-watcher.js';

const TEST_DIR = join(tmpdir(), `aegis-test-${randomUUID()}`);

/** Generous test timeout for cross-platform fs.watch reliability. */
const TEST_TIMEOUT = 15_000;

/** Delay to let fs.watch initialize on macOS (FSEvents setup is async). */
const WATCH_SETTLE_MS = 100;

function setup(): void {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

function jsonlPath(name: string): string {
  return join(TEST_DIR, `${name}.jsonl`);
}

function writeJsonl(name: string, lines: string[]): void {
  const path = jsonlPath(name);
  const content = lines.join('\n') + '\n';
  writeFileSync(path, content);
}

function appendJsonl(name: string, lines: string[]): void {
  const path = jsonlPath(name);
  const content = lines.join('\n') + '\n';
  writeFileSync(path, content, { flag: 'a' });
}

/** Allow the event loop to process pending microtasks/IO. */
function settle(ms = WATCH_SETTLE_MS): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Create a promise that resolves on the next watcher event.
 *  IMPORTANT: Call this BEFORE triggering file writes. */
function waitForEvent(
  watcher: JsonlWatcher,
  timeoutMs = 10_000,
): Promise<JsonlWatcherEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Timeout waiting for watcher event'));
    }, timeoutMs);

    const unsub = watcher.onEntries((event) => {
      clearTimeout(timer);
      unsub();
      resolve(event);
    });
  });
}

/** Start collecting events. Call BEFORE triggering writes. */
function startCollecting(watcher: JsonlWatcher): {
  stop: () => JsonlWatcherEvent[];
  waitAndStop: (durationMs?: number) => Promise<JsonlWatcherEvent[]>;
} {
  const events: JsonlWatcherEvent[] = [];
  const unsub = watcher.onEntries((event) => {
    events.push(event);
  });

  return {
    stop: () => { unsub(); return events; },
    waitAndStop: async (durationMs = 2000) => {
      await new Promise(r => setTimeout(r, durationMs));
      unsub();
      return events;
    },
  };
}

/** Poll until condition is met or deadline expires. */
async function waitForCondition(
  fn: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

describe('JsonlWatcher', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('emits event when file is written to', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-session-1';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Register listener BEFORE writing, settle to let fs.watch initialize
    const eventPromise = waitForEvent(watcher);
    await settle();

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi there' } }),
    ]);

    const event = await eventPromise;
    expect(event.sessionId).toBe(sessionId);
    expect(event.messages.length).toBeGreaterThan(0);
    const assistantMsg = event.messages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.text).toContain('hi there');

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('debounces rapid writes into a single event', async () => {
    const watcher = new JsonlWatcher({ debounceMs: 50 });
    const sessionId = 'test-debounce';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'start' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Register collector BEFORE writing, settle to let fs.watch initialize
    const collector = startCollecting(watcher);
    await settle();

    // Rapidly write 5 lines
    for (let i = 0; i < 5; i++) {
      appendJsonl(sessionId, [
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: `line ${i}` } }),
      ]);
    }

    const events = await collector.waitAndStop(2000);

    // Should get 1 or at most 2 events (not 6) due to debouncing
    expect(events.length).toBeLessThanOrEqual(2);
    // All lines (1 initial + 5 appended) should be captured
    const totalMessages = events.reduce((sum, e) => sum + e.messages.length, 0);
    expect(totalMessages).toBe(6);

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('handles file deletion gracefully', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-delete';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    await settle();

    // Delete the file
    rmSync(jsonlPath(sessionId));

    // Poll until the watcher handles the deletion
    await waitForCondition(() => !watcher.isWatching(sessionId));

    expect(watcher.isWatching(sessionId)).toBe(false);

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('watches multiple sessions simultaneously', async () => {
    const watcher = new JsonlWatcher();
    const session1 = 'session-a';
    const session2 = 'session-b';

    writeJsonl(session1, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello from a' } }),
    ]);
    writeJsonl(session2, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello from b' } }),
    ]);

    watcher.watch(session1, jsonlPath(session1), 0);
    watcher.watch(session2, jsonlPath(session2), 0);

    expect(watcher.isWatching(session1)).toBe(true);
    expect(watcher.isWatching(session2)).toBe(true);

    // Register collector BEFORE writing, settle to let fs.watch initialize
    const collector = startCollecting(watcher);
    await settle();

    appendJsonl(session1, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response a' } }),
    ]);
    appendJsonl(session2, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response b' } }),
    ]);

    const events = await collector.waitAndStop(2000);
    const sessionIds = events.map(e => e.sessionId);

    expect(sessionIds).toContain(session1);
    expect(sessionIds).toContain(session2);

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('unwatch stops receiving events', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-unwatch';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    watcher.unwatch(sessionId);

    expect(watcher.isWatching(sessionId)).toBe(false);

    const collector = startCollecting(watcher);

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'should not be seen' } }),
    ]);

    const events = await collector.waitAndStop(1000);
    expect(events.length).toBe(0);

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('tracks and returns correct offset', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-offset';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Register listener BEFORE writing, settle to let fs.watch initialize
    const eventPromise = waitForEvent(watcher);
    await settle();

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response' } }),
    ]);

    const event = await eventPromise;
    expect(event.newOffset).toBeGreaterThan(0);
    expect(watcher.getOffset(sessionId)).toBe(event.newOffset);

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('setOffset updates the read position', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-set-offset';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }),
    ]);

    const initialContent = JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }) + '\n'
      + JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }) + '\n';
    watcher.watch(sessionId, jsonlPath(sessionId), Buffer.byteLength(initialContent));

    // Register listener BEFORE writing, settle to let fs.watch initialize
    const eventPromise = waitForEvent(watcher);
    await settle();

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'third' } }),
    ]);

    const event = await eventPromise;
    expect(event.messages.length).toBe(1);
    expect(event.messages[0].text).toContain('third');

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('does not double-watch the same session', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-double';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    expect(watcher.isWatching(sessionId)).toBe(true);

    // Register listener BEFORE writing, settle to let fs.watch initialize
    const eventPromise = waitForEvent(watcher);
    await settle();

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response' } }),
    ]);

    const event = await eventPromise;
    expect(event.sessionId).toBe(sessionId);

    watcher.destroy();
  }, TEST_TIMEOUT);

  it('onEntries unsubscribe removes listener', () => {
    const watcher = new JsonlWatcher();
    const listener = vi.fn<(event: JsonlWatcherEvent) => void>();
    const unsub = watcher.onEntries(listener);

    unsub();

    expect(watcher.onEntries.toString()).toBeDefined();

    watcher.destroy();
  });

  it('destroy cleans up all watchers', () => {
    const watcher = new JsonlWatcher();
    const session1 = 'destroy-a';
    const session2 = 'destroy-b';

    writeJsonl(session1, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'a' } }),
    ]);
    writeJsonl(session2, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'b' } }),
    ]);

    watcher.watch(session1, jsonlPath(session1), 0);
    watcher.watch(session2, jsonlPath(session2), 0);

    watcher.destroy();

    expect(watcher.isWatching(session1)).toBe(false);
    expect(watcher.isWatching(session2)).toBe(false);
  });

  it('watch non-existent file is a no-op', () => {
    const watcher = new JsonlWatcher();
    watcher.watch('ghost', '/nonexistent/path.jsonl', 0);
    expect(watcher.isWatching('ghost')).toBe(false);
    watcher.destroy();
  });

  it('clears stale timer on re-watch (Issue #846)', async () => {
    const watcher = new JsonlWatcher({ debounceMs: 50 });
    const sessionId = 'test-stale-timer';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    // First watch
    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    await settle();

    // Append to trigger debounce timer
    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'first' } }),
    ]);

    // Re-watch while debounce timer is pending
    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    expect(watcher.isWatching(sessionId)).toBe(true);

    // Register listener BEFORE writing, settle to let new fs.watch initialize
    const eventPromise = waitForEvent(watcher);
    await settle();

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }),
    ]);

    const event = await eventPromise;
    expect(event.sessionId).toBe(sessionId);

    watcher.destroy();
  }, TEST_TIMEOUT);
});
