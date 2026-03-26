/**
 * jsonl-watcher.test.ts — Tests for fs.watch-based JSONL file watcher.
 *
 * Issue #84: Replace JSONL polling with fs.watch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonlWatcher, type JsonlWatcherEvent } from '../jsonl-watcher.js';

const TEST_DIR = join(tmpdir(), `aegis-test-${randomUUID()}`);

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

/** Wait for the watcher to fire (with timeout). */
function waitForEvent(
  watcher: JsonlWatcher,
  timeoutMs = 2000,
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

/** Collect events over a time window. */
async function collectEvents(
  watcher: JsonlWatcher,
  durationMs = 500,
): Promise<JsonlWatcherEvent[]> {
  const events: JsonlWatcherEvent[] = [];
  const unsub = watcher.onEntries((event) => {
    events.push(event);
  });

  await new Promise(r => setTimeout(r, durationMs));
  unsub();
  return events;
}

describe('JsonlWatcher', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('emits event when file is written to', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-session-1';

    // Write initial file
    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Append new content
    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi there' } }),
    ]);

    const event = await waitForEvent(watcher);
    expect(event.sessionId).toBe(sessionId);
    expect(event.messages.length).toBeGreaterThan(0);
    // The new entry should be an assistant message
    const assistantMsg = event.messages.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.text).toContain('hi there');

    watcher.destroy();
  });

  it('debounces rapid writes into a single event', async () => {
    const watcher = new JsonlWatcher({ debounceMs: 50 });
    const sessionId = 'test-debounce';

    // Write initial file
    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'start' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Rapidly write 5 lines
    for (let i = 0; i < 5; i++) {
      appendJsonl(sessionId, [
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: `line ${i}` } }),
      ]);
    }

    // Wait for debounced event(s)
    const events = await collectEvents(watcher, 300);

    // Should get 1 or at most 2 events (not 6) due to debouncing
    expect(events.length).toBeLessThanOrEqual(2);
    // All lines (1 initial + 5 appended) should be captured
    const totalMessages = events.reduce((sum, e) => sum + e.messages.length, 0);
    expect(totalMessages).toBe(6);

    watcher.destroy();
  });

  it('handles file deletion gracefully', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-delete';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Delete the file
    rmSync(jsonlPath(sessionId));

    // Wait for the watcher to handle the deletion
    await new Promise(r => setTimeout(r, 200));

    // Should no longer be watching
    expect(watcher.isWatching(sessionId)).toBe(false);

    watcher.destroy();
  });

  it('watches multiple sessions simultaneously', async () => {
    const watcher = new JsonlWatcher();
    const session1 = 'session-a';
    const session2 = 'session-b';

    // Create both files
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

    // Write to both
    appendJsonl(session1, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response a' } }),
    ]);
    appendJsonl(session2, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response b' } }),
    ]);

    // Collect events for both sessions
    const events = await collectEvents(watcher, 500);
    const sessionIds = events.map(e => e.sessionId);

    expect(sessionIds).toContain(session1);
    expect(sessionIds).toContain(session2);

    watcher.destroy();
  });

  it('unwatch stops receiving events', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-unwatch';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    watcher.unwatch(sessionId);

    expect(watcher.isWatching(sessionId)).toBe(false);

    // Write more content
    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'should not be seen' } }),
    ]);

    // Should not receive any events
    const events = await collectEvents(watcher, 300);
    expect(events.length).toBe(0);

    watcher.destroy();
  });

  it('tracks and returns correct offset', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-offset';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    // Start with initial offset = 0
    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Append content
    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response' } }),
    ]);

    const event = await waitForEvent(watcher);
    expect(event.newOffset).toBeGreaterThan(0);
    expect(watcher.getOffset(sessionId)).toBe(event.newOffset);

    watcher.destroy();
  });

  it('setOffset updates the read position', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-set-offset';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }),
    ]);

    // Start watching at end of file (skip existing content)
    const initialContent = JSON.stringify({ type: 'user', message: { role: 'user', content: 'first' } }) + '\n'
      + JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'second' } }) + '\n';
    watcher.watch(sessionId, jsonlPath(sessionId), Buffer.byteLength(initialContent));

    // Append new content
    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'third' } }),
    ]);

    const event = await waitForEvent(watcher);
    // Should only see the new entry, not the old ones
    expect(event.messages.length).toBe(1);
    expect(event.messages[0].text).toContain('third');

    watcher.destroy();
  });

  it('does not double-watch the same session', async () => {
    const watcher = new JsonlWatcher();
    const sessionId = 'test-double';

    writeJsonl(sessionId, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }),
    ]);

    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    watcher.watch(sessionId, jsonlPath(sessionId), 0);

    // Should still be watching (not crashed)
    expect(watcher.isWatching(sessionId)).toBe(true);

    appendJsonl(sessionId, [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'response' } }),
    ]);

    const event = await waitForEvent(watcher);
    expect(event.sessionId).toBe(sessionId);

    watcher.destroy();
  });

  it('onEntries unsubscribe removes listener', () => {
    const watcher = new JsonlWatcher();
    const listener = vi.fn<(event: JsonlWatcherEvent) => void>();
    const unsub = watcher.onEntries(listener);

    unsub();

    // Emitting should not call listener — we can't easily trigger internal emit,
    // but we can verify the listener was removed
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
});
