/**
 * jsonl-watcher-worker.test.ts — Tests for the worker-based JSONL watcher.
 *
 * Issue #4230: Verifies watcher API compatibility, streaming parsing,
 * offset tracking, and bounded memory usage.
 *
 * Tests exercise the existing JsonlWatcher (same public API as the bridge).
 * Bridge-specific Worker spawn tests belong in integration tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { JsonlWatcher } from '../jsonl-watcher.js';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'jsonl-worker-test-'));
}

function makeJsonlLine(role: string, text: string): string {
  return JSON.stringify({
    type: role,
    message: {
      role,
      content: [{ type: 'text', text }],
    },
    timestamp: new Date().toISOString(),
  });
}

/** Wait for fs.watch debounce + event loop tick. */
const waitForWatch = (ms = 500) => new Promise((resolve) => setTimeout(resolve, ms));

describe('JsonlWatcher (worker-ready API)', () => {
  let tempDir: string;
  let watcher: JsonlWatcher;

  beforeEach(() => {
    tempDir = makeTempDir();
    watcher = new JsonlWatcher();
  });

  afterEach(() => {
    watcher.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('emits entries when JSONL file changes', async () => {
    const jsonlPath = join(tempDir, 'session.jsonl');
    writeFileSync(jsonlPath, '');

    const events: Array<{ sessionId: string; messages: unknown[] }> = [];
    watcher.onEntries((event) => events.push(event));

    watcher.watch('test-session', jsonlPath, 0);

    // Append new content after watch is established
    appendFileSync(jsonlPath, makeJsonlLine('user', 'hello') + '\n');
    await waitForWatch();

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].sessionId).toBe('test-session');
  });

  it('tracks offset correctly', async () => {
    const jsonlPath = join(tempDir, 'session.jsonl');
    writeFileSync(jsonlPath, '');

    watcher.watch('offset-test', jsonlPath, 0);

    appendFileSync(jsonlPath, makeJsonlLine('user', 'hello') + '\n');
    await waitForWatch();

    const offset = watcher.getOffset('offset-test');
    expect(offset).toBeDefined();
    expect(offset!).toBeGreaterThan(0);
  });

  it('isWatching returns true for watched session', () => {
    const jsonlPath = join(tempDir, 'session.jsonl');
    writeFileSync(jsonlPath, '');

    watcher.watch('watching-test', jsonlPath, 0);
    expect(watcher.isWatching('watching-test')).toBe(true);
    expect(watcher.isWatching('nonexistent')).toBe(false);
  });

  it('unwatch removes session', () => {
    const jsonlPath = join(tempDir, 'session.jsonl');
    writeFileSync(jsonlPath, '');

    watcher.watch('unwatch-test', jsonlPath, 0);
    expect(watcher.isWatching('unwatch-test')).toBe(true);

    watcher.unwatch('unwatch-test');
    expect(watcher.isWatching('unwatch-test')).toBe(false);
  });

  it('setOffset updates tracked offset', () => {
    const jsonlPath = join(tempDir, 'session.jsonl');
    writeFileSync(jsonlPath, '');

    watcher.watch('setoffset-test', jsonlPath, 0);
    watcher.setOffset('setoffset-test', 42);

    expect(watcher.getOffset('setoffset-test')).toBe(42);
  });

  it('handles non-existent file gracefully', () => {
    // Should not throw
    watcher.watch('no-file', join(tempDir, 'nonexistent.jsonl'), 0);
    expect(watcher.isWatching('no-file')).toBe(false);
  });

  it('handles file truncation (offset > file size)', async () => {
    const jsonlPath = join(tempDir, 'truncated.jsonl');
    const longLine = makeJsonlLine('user', 'original content that is long enough to have a big offset');
    writeFileSync(jsonlPath, longLine + '\n');

    const events: Array<{ truncated: boolean }> = [];
    watcher.onEntries((event) => events.push(event));
    watcher.watch('trunc-test', jsonlPath, 0);
    await waitForWatch();

    // Truncate: write shorter content, then manually set offset high
    writeFileSync(jsonlPath, makeJsonlLine('user', 'short') + '\n');
    // Force the watcher to think it had a high offset so truncation is detected
    watcher.setOffset('trunc-test', 99999);
    appendFileSync(jsonlPath, makeJsonlLine('user', 'after-trunc') + '\n');

    await waitForWatch(700);

    const hadTruncation = events.some((e) => e.truncated);
    expect(hadTruncation).toBe(true);
  });

  it('streams large fixture without unbounded memory', async () => {
    const jsonlPath = join(tempDir, 'large.jsonl');
    writeFileSync(jsonlPath, '');

    const lineCount = 2000;
    let totalMessages = 0;
    watcher.onEntries((event) => {
      totalMessages += event.messages.length;
    });

    watcher.watch('large-test', jsonlPath, 0);

    // Write in chunks to trigger multiple fs.watch events
    const chunkSize = 200;
    for (let i = 0; i < lineCount; i += chunkSize) {
      const chunk: string[] = [];
      for (let j = i; j < Math.min(i + chunkSize, lineCount); j++) {
        chunk.push(makeJsonlLine('user', `Line ${j} content`));
      }
      appendFileSync(jsonlPath, chunk.join('\n') + '\n');
    }

    await waitForWatch(1000);

    expect(totalMessages).toBeGreaterThan(0);

    // Memory check
    const mem = process.memoryUsage();
    expect(mem.heapUsed).toBeLessThan(200 * 1024 * 1024); // <200MB
  });

  it('resume from offset skips already-read entries', async () => {
    const jsonlPath = join(tempDir, 'resume.jsonl');
    writeFileSync(jsonlPath, '');

    // First watch: read initial content, capture offset
    const w1 = new JsonlWatcher();
    let offset1 = 0;
    w1.onEntries((event) => { offset1 = event.newOffset; });
    w1.watch('resume-test', jsonlPath, 0);

    appendFileSync(jsonlPath, makeJsonlLine('user', 'first') + '\n');
    await waitForWatch();
    w1.destroy();

    expect(offset1).toBeGreaterThan(0);

    // Second watch from offset — start watching BEFORE appending
    const w2 = new JsonlWatcher();
    let secondBatch = 0;
    w2.onEntries((event) => { secondBatch += event.messages.length; });
    w2.watch('resume-test', jsonlPath, offset1);

    // Now append new content — fs.watch will fire
    appendFileSync(jsonlPath, makeJsonlLine('assistant', 'second') + '\n');
    await waitForWatch(700);
    w2.destroy();

    expect(secondBatch).toBeGreaterThanOrEqual(1);
  });

  it('destroy cleans up all watches', () => {
    const jsonlPath = join(tempDir, 'destroy.jsonl');
    writeFileSync(jsonlPath, '');

    watcher.watch('d1', jsonlPath, 0);
    watcher.watch('d2', jsonlPath, 0);
    expect(watcher.isWatching('d1')).toBe(true);

    watcher.destroy();
    expect(watcher.isWatching('d1')).toBe(false);
    expect(watcher.isWatching('d2')).toBe(false);
  });
});
