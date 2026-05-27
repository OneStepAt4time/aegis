/**
 * jsonl-watcher-worker.ts — Worker thread for JSONL file watching.
 *
 * Runs inside a Node worker thread and performs fs.watch + readNewEntries
 * to parse appended JSONL lines and post parsed entries back to the parent.
 */
import { parentPort } from 'worker_threads';
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { readNewEntries, extractTokenDelta } from '../../transcript.js';

type MessageFromParent =
  | { type: 'watch'; sessionId: string; jsonlPath: string; initialOffset: number; debounceMs?: number }
  | { type: 'unwatch'; sessionId: string }
  | { type: 'setOffset'; sessionId: string; offset: number }
  | { type: 'destroy' };

type MessageToParent =
  | { type: 'entries'; sessionId: string; entries: any[]; newOffset: number; truncated: boolean; raw: any[] }
  | { type: 'log'; level: 'info' | 'error' | 'warn'; msg: string }
  | { type: 'ready' };

interface WatchEntry {
  sessionId: string;
  jsonlPath: string;
  fsWatcher: ReturnType<typeof watch> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  offset: number;
}

const entries = new Map<string, WatchEntry>();

function post(msg: MessageToParent) {
  parentPort?.postMessage(msg);
}

async function readAndEmit(entry: WatchEntry) {
  if (!existsSync(entry.jsonlPath)) {
    // file gone
    unwatch(entry.sessionId);
    return;
  }

  try {
    const previousOffset = entry.offset;
    const result = await readNewEntries(entry.jsonlPath, previousOffset);
    entry.offset = result.newOffset;

    if (result.entries.length > 0 || result.newOffset < previousOffset) {
      const truncated = result.newOffset < previousOffset;
      post({ type: 'entries', sessionId: entry.sessionId, entries: result.entries, newOffset: result.newOffset, truncated, raw: result.raw });
    }
  } catch (err) {
    post({ type: 'log', level: 'error', msg: `readAndEmit failed for ${entry.sessionId}: ${(err as Error).message}` });
  }
}

function scheduleRead(sessionId: string, debounceMs = 100) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void readAndEmit(entry);
  }, debounceMs);
}

function watchFile(sessionId: string, jsonlPath: string, initialOffset: number, debounceMs = 100) {
  // if already watching, close first
  if (entries.has(sessionId)) {
    const old = entries.get(sessionId)!;
    if (old.fsWatcher) old.fsWatcher.close();
    entries.delete(sessionId);
  }

  if (!existsSync(jsonlPath)) return;

  const fsWatcher = watch(jsonlPath, (eventType) => {
    if (eventType === 'rename') {
      if (!existsSync(jsonlPath)) {
        unwatch(sessionId);
        return;
      }
      scheduleRead(sessionId, debounceMs);
      return;
    }
    scheduleRead(sessionId, debounceMs);
  });

  fsWatcher.on('error', (err) => {
    post({ type: 'log', level: 'error', msg: `fs.watch error for ${jsonlPath}: ${err.message}` });
    // best-effort: try to re-watch after a short delay
    setTimeout(() => {
      try {
        fsWatcher.close();
      } catch {}
      watchFile(sessionId, jsonlPath, entries.get(sessionId)?.offset ?? initialOffset, debounceMs);
    }, 500);
  });

  entries.set(sessionId, { sessionId, jsonlPath, fsWatcher, debounceTimer: null, offset: initialOffset });
}

function unwatch(sessionId: string) {
  const entry = entries.get(sessionId);
  if (!entry) return;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.fsWatcher) entry.fsWatcher.close();
  entries.delete(sessionId);
}

parentPort?.on('message', (msg: MessageFromParent) => {
  switch (msg.type) {
    case 'watch':
      watchFile(msg.sessionId, msg.jsonlPath, msg.initialOffset, msg.debounceMs ?? 100);
      break;
    case 'unwatch':
      unwatch(msg.sessionId);
      break;
    case 'setOffset': {
      const e = entries.get(msg.sessionId);
      if (e) e.offset = msg.offset;
      break;
    }
    case 'destroy': {
      for (const k of Array.from(entries.keys())) unwatch(k);
      parentPort?.close();
      break;
    }
  }
});

post({ type: 'ready' });
