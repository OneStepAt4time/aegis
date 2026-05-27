/**
 * jsonl-watcher-worker.ts — Worker-thread JSONL transcript parser.
 *
 * Runs inside a Node.js worker_threads Worker. Accepts watch/unwatch/setOffset
 * commands from the main thread and posts parsed JSONL entries back.
 *
 * Issue #4230: Offloads transcript parsing from the main event loop.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { watch, type FSWatcher, existsSync } from 'node:fs';
import { readNewEntries, extractTokenDelta, type ParsedEntry, type TokenUsageDelta, type JsonlEntry } from '../../transcript.js';
import { StructuredLogger } from '../../logger.js';

const log = new StructuredLogger();

// ── Types ────────────────────────────────────────────────────────────────────

export interface WorkerWatchCommand {
  type: 'watch';
  sessionId: string;
  jsonlPath: string;
  initialOffset: number;
}

export interface WorkerUnwatchCommand {
  type: 'unwatch';
  sessionId: string;
}

export interface WorkerSetOffsetCommand {
  type: 'setOffset';
  sessionId: string;
  offset: number;
}

export interface WorkerDestroyCommand {
  type: 'destroy';
}

export type WorkerCommand =
  | WorkerWatchCommand
  | WorkerUnwatchCommand
  | WorkerSetOffsetCommand
  | WorkerDestroyCommand;

export interface WorkerEntriesEvent {
  type: 'entries';
  sessionId: string;
  messages: ParsedEntry[];
  newOffset: number;
  truncated: boolean;
  tokenUsageDelta: TokenUsageDelta;
  rawCount: number;
}

export interface WorkerErrorEvent {
  type: 'error';
  sessionId: string;
  error: string;
}

export type WorkerResponse = WorkerEntriesEvent | WorkerErrorEvent;

// ── Config ───────────────────────────────────────────────────────────────────

interface WorkerConfig {
  debounceMs: number;
  maxRestartAttempts: number;
  restartBaseDelayMs: number;
}

const DEFAULT_CONFIG: WorkerConfig = {
  debounceMs: 100,
  maxRestartAttempts: 5,
  restartBaseDelayMs: 1000,
};

// ── Watch State ──────────────────────────────────────────────────────────────

interface WatchEntry {
  sessionId: string;
  jsonlPath: string;
  fsWatcher: FSWatcher;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  offset: number;
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
}

// ── Worker Implementation ────────────────────────────────────────────────────

const config: WorkerConfig = { ...DEFAULT_CONFIG, ...workerData?.config };
const watches = new Map<string, WatchEntry>();

function post(message: WorkerResponse): void {
  parentPort?.postMessage(message);
}

function scheduleRead(entry: WatchEntry): void {
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void readAndEmit(entry);
  }, config.debounceMs);
}

async function readAndEmit(entry: WatchEntry): Promise<void> {
  if (!watches.has(entry.sessionId)) return;
  if (!existsSync(entry.jsonlPath)) {
    removeWatch(entry.sessionId);
    return;
  }

  try {
    const prevOffset = entry.offset;
    const result = await readNewEntries(entry.jsonlPath, prevOffset);
    entry.offset = result.newOffset;

    if (result.entries.length > 0 || result.newOffset < prevOffset) {
      const truncated = result.newOffset < prevOffset;
      post({
        type: 'entries',
        sessionId: entry.sessionId,
        messages: result.entries,
        newOffset: result.newOffset,
        truncated,
        tokenUsageDelta: extractTokenDelta(result.raw),
        rawCount: result.raw.length,
      });
    }
  } catch (err) {
    post({ type: 'error', sessionId: entry.sessionId, error: String(err) });
  }
}

function scheduleRestart(sessionId: string): void {
  const entry = watches.get(sessionId);
  if (!entry) return;

  if (entry.restartAttempts >= config.maxRestartAttempts) {
    log.error({
      component: 'jsonl-watcher-worker',
      operation: 'maxRestartAttempts',
      attributes: { sessionId, maxAttempts: config.maxRestartAttempts },
    });
    removeWatch(sessionId);
    return;
  }

  const delay = config.restartBaseDelayMs * Math.pow(2, entry.restartAttempts);
  entry.restartAttempts++;

  entry.restartTimer = setTimeout(() => {
    entry.restartTimer = null;
    const currentOffset = entry.offset;
    const path = entry.jsonlPath;
    entry.fsWatcher.close();
    watches.delete(sessionId);
    startWatch(sessionId, path, currentOffset);
    // Preserve restart counter
    const newEntry = watches.get(sessionId);
    if (newEntry) newEntry.restartAttempts = entry.restartAttempts;
  }, delay);
}

function startWatch(sessionId: string, jsonlPath: string, initialOffset: number): void {
  // Clear existing watch if re-watching
  if (watches.has(sessionId)) removeWatch(sessionId);
  if (!existsSync(jsonlPath)) return;

  const fsWatcher = watch(jsonlPath, (eventType) => {
    const e = watches.get(sessionId);
    if (!e) return;
    if (eventType === 'rename' && !existsSync(jsonlPath)) {
      removeWatch(sessionId);
      return;
    }
    scheduleRead(e);
  });

  fsWatcher.on('error', () => {
    scheduleRestart(sessionId);
  });

  watches.set(sessionId, {
    sessionId,
    jsonlPath,
    fsWatcher,
    debounceTimer: null,
    offset: initialOffset,
    restartAttempts: 0,
    restartTimer: null,
  });
}

function removeWatch(sessionId: string): void {
  const entry = watches.get(sessionId);
  if (!entry) return;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  if (entry.restartTimer) clearTimeout(entry.restartTimer);
  entry.fsWatcher.close();
  watches.delete(sessionId);
}

function destroyAll(): void {
  for (const id of watches.keys()) removeWatch(id);
}

// ── Command Handler ──────────────────────────────────────────────────────────

parentPort?.on('message', (cmd: WorkerCommand) => {
  switch (cmd.type) {
    case 'watch':
      startWatch(cmd.sessionId, cmd.jsonlPath, cmd.initialOffset);
      break;
    case 'unwatch':
      removeWatch(cmd.sessionId);
      break;
    case 'setOffset': {
      const e = watches.get(cmd.sessionId);
      if (e) e.offset = cmd.offset;
      break;
    }
    case 'destroy':
      destroyAll();
      break;
  }
});
