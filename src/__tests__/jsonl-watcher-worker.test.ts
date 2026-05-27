import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import JsonlWatcherBridge from '../services/worker/jsonl-watcher-bridge.js';

const TEST_DIR = join(tmpdir(), `aegis-worker-test-${randomUUID()}`);
const WATCH_SETTLE_MS = 100;

function setup() { mkdirSync(TEST_DIR, { recursive: true }); }
function cleanup() { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); }
function jsonlPath(name: string) { return join(TEST_DIR, `${name}.jsonl`); }
function writeJsonl(name: string, lines: string[]) { writeFileSync(jsonlPath(name), lines.join('\n') + '\n'); }
function appendJsonl(name: string, lines: string[]) { writeFileSync(jsonlPath(name), lines.join('\n') + '\n', { flag: 'a' }); }
function settle(ms = WATCH_SETTLE_MS) { return new Promise(r => setTimeout(r, ms)); }

function waitForEvent(watcher: any, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    const unsub = watcher.onEntries((ev: any) => { clearTimeout(timer); unsub(); resolve(ev); });
  });
}

describe('JsonlWatcherBridge (fallback/in-process)', () => {
  beforeEach(setup);
  afterEach(cleanup);

  it('spawn lifecycle and emits entries', async () => {
    const watcher = new JsonlWatcherBridge();
    const sessionId = 'w1';
    writeJsonl(sessionId, [JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } })]);
    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    const p = waitForEvent(watcher);
    await settle();
    appendJsonl(sessionId, [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } })]);
    const ev: any = await p;
    expect(ev.sessionId).toBe(sessionId);
    expect(ev.messages.find((m: any) => m.role === 'assistant')).toBeDefined();
    watcher.destroy();
  });

  it('preserves offset across restart (simulated by re-watching)', async () => {
    const watcher = new JsonlWatcherBridge();
    const sessionId = 'w2';
    writeJsonl(sessionId, [JSON.stringify({ type: 'user', message: { role: 'user', content: 'a' } })]);
    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    const p = waitForEvent(watcher);
    await settle();
    appendJsonl(sessionId, [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'b' } })]);
    const ev: any = await p;
    const saved = ev.newOffset;
    // simulate restart by re-watching
    watcher.unwatch(sessionId);
    watcher.watch(sessionId, jsonlPath(sessionId), saved);
    expect(watcher.getOffset(sessionId)).toBe(saved);
    watcher.destroy();
  });

  it('streams large fixture without unbounded memory growth', async () => {
    const watcher = new JsonlWatcherBridge();
    const sessionId = 'w3';
    const lines: string[] = [];
    for (let i = 0; i < 2000; i++) {
      lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: `line ${i}` } }));
    }
    writeJsonl(sessionId, lines.slice(0, 1000));
    watcher.watch(sessionId, jsonlPath(sessionId), 0);
    await settle();
    const before = process.memoryUsage().heapUsed;
    // append remaining lines in chunks
    for (let i = 1000; i < 2000; i += 50) {
      appendJsonl(sessionId, lines.slice(i, i + 50));
      await settle(10);
    }
    const after = process.memoryUsage().heapUsed;
    // allow some growth but not unbounded (heuristic)
    expect(after - before).toBeLessThan(20 * 1024 * 1024); // <20MB
    watcher.destroy();
  }, 20000);
});
