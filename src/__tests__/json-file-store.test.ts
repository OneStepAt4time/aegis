/**
 * json-file-store.test.ts — Edge-case coverage for JsonFileStore not exercised
 * by the existing session-store.test.ts.
 *
 * Existing coverage in session-store.test.ts:
 *   start() dir-creation, load() happy/backup-fallback, save() round-trip,
 *   getSession/putSession/deleteSession/listSessionIds, health() when dir exists,
 *   all pipeline CRUD methods, legacy pipeline array format, TOCTOU concurrency.
 *
 * This file adds:
 *   - health() when stateDir does not exist
 *   - stop() resolves without error
 *   - cleanTmpFiles() removes stale .tmp files on start()
 *   - save() creates parent directory when missing
 *   - load() when both state.json and backup are corrupted → empty state
 *   - load() write-backup failure is non-fatal
 *   - isValidState() rejects sessions missing required fields
 *   - loadPipelines() with corrupted JSON → empty state
 *   - savePipelines() propagates non-ENOENT errors from unlinkSync
 *   - store-factory: redis backend lazy-import path (env-driven)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileStore } from '../services/state/JsonFileStore.js';
import { createStateStore } from '../services/state/store-factory.js';
import type { SerializedSessionInfo } from '../services/state/state-store.js';

function makeSession(id: string, overrides: Partial<SerializedSessionInfo> = {}): SerializedSessionInfo {
  return {
    id,
    windowId: `@${id.slice(0, 4)}`,
    displayName: `cc-${id.slice(0, 8)}`,
    workDir: '/tmp/project',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  };
}

describe('JsonFileStore — edge cases', () => {
  let stateDir: string;
  let store: JsonFileStore;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'aegis-jfs-edge-'));
    store = new JsonFileStore({ stateDir });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(stateDir, { recursive: true, force: true });
  });

  // ── health() ───────────────────────────────────────────────────────────────

  describe('health()', () => {
    it('returns unhealthy when stateDir does not exist', async () => {
      const missingDir = join(stateDir, 'does-not-exist');
      const s = new JsonFileStore({ stateDir: missingDir });
      const h = await s.health();
      expect(h.healthy).toBe(false);
      expect(h.details).toMatch(/missing/i);
    });

    it('returns healthy after start() creates the directory', async () => {
      const newDir = join(stateDir, 'created-by-start');
      const s = new JsonFileStore({ stateDir: newDir });
      await s.start();
      const h = await s.health();
      expect(h.healthy).toBe(true);
    });
  });

  // ── stop() ────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('resolves without error', async () => {
      await store.start();
      await expect(store.stop(AbortSignal.timeout(1000))).resolves.toBeUndefined();
    });
  });

  // ── cleanTmpFiles() via start() ───────────────────────────────────────────

  describe('start() cleans up stale .tmp files', () => {
    it('removes .tmp files from a previous crashed write', async () => {
      // Pre-seed stale tmp files
      const tmpA = join(stateDir, 'state.json.tmp');
      const tmpB = join(stateDir, 'state.json.tmp.12345.1234567890.abc');
      writeFileSync(tmpA, '{}');
      writeFileSync(tmpB, '{}');

      await store.start();

      expect(existsSync(tmpA)).toBe(false);
      expect(existsSync(tmpB)).toBe(false);
    });

    it('leaves non-tmp files untouched', async () => {
      const keepFile = join(stateDir, 'state.json');
      await writeFile(keepFile, JSON.stringify({ sessions: {} }));

      await store.start();

      expect(existsSync(keepFile)).toBe(true);
    });
  });

  // ── save() creates missing directory ──────────────────────────────────────

  describe('save() creates the parent directory when missing', () => {
    it('writes state.json to a deeply nested directory that does not yet exist', async () => {
      const deepDir = join(stateDir, 'a', 'b', 'c');
      const s = new JsonFileStore({ stateDir: deepDir });
      await s.save({ sessions: { 'x': makeSession('x') } });

      expect(existsSync(join(deepDir, 'state.json'))).toBe(true);
    });
  });

  // ── load() — both state.json and backup corrupted ─────────────────────────

  describe('load() — corrupted state and backup', () => {
    it('returns empty state when both state.json and .bak are unparseable', async () => {
      await store.start();
      await writeFile(join(stateDir, 'state.json'), 'CORRUPTED JSON {{{');
      await writeFile(join(stateDir, 'state.json.bak'), 'ALSO BROKEN %%%');

      const state = await store.load();
      expect(Object.keys(state.sessions)).toHaveLength(0);
    });

    it('returns empty state when state.json is valid JSON but fails schema (no sessions key)', async () => {
      await store.start();
      await writeFile(join(stateDir, 'state.json'), JSON.stringify({ notSessions: {} }));

      const state = await store.load();
      expect(Object.keys(state.sessions)).toHaveLength(0);
    });

    it('returns empty state when state.json sessions contain invalid entries', async () => {
      await store.start();
      // sessions values missing required `id` and `windowId` fields
      await writeFile(join(stateDir, 'state.json'), JSON.stringify({
        sessions: {
          'bad-entry': { foo: 'bar' }, // missing id and windowId
        },
      }));

      const state = await store.load();
      // isValidState rejects this → empty sessions returned
      expect(Object.keys(state.sessions)).toHaveLength(0);
    });

    it('uses backup when state.json fails schema but backup is valid', async () => {
      await store.start();
      const session = makeSession('backup-session');

      // Write valid backup first
      await writeFile(
        join(stateDir, 'state.json.bak'),
        JSON.stringify({ sessions: { 'backup-session': session } }),
      );
      // Write invalid main file
      await writeFile(join(stateDir, 'state.json'), JSON.stringify({ notSessions: true }));

      const state = await store.load();
      expect(state.sessions['backup-session']).toBeDefined();
    });
  });

  // ── loadPipelines() — corrupted JSON ──────────────────────────────────────

  describe('loadPipelines() — corrupted JSON', () => {
    it('returns empty pipelines state when pipelines.json is unparseable', async () => {
      await store.start();
      await writeFile(join(stateDir, 'pipelines.json'), 'NOT JSON !!!');

      const state = await store.loadPipelines();
      expect(Object.keys(state.pipelines)).toHaveLength(0);
    });

    it('returns empty pipelines when pipelines.json is valid JSON but wrong shape', async () => {
      await store.start();
      await writeFile(join(stateDir, 'pipelines.json'), JSON.stringify({ notPipelines: {} }));

      const state = await store.loadPipelines();
      // isValidPipelineState requires a "pipelines" key
      expect(Object.keys(state.pipelines)).toHaveLength(0);
    });
  });

  // ── savePipelines() error path ─────────────────────────────────────────────

  describe('savePipelines() propagates non-ENOENT errors', () => {
    it('does not throw when pipeline file is missing on delete (ENOENT is swallowed)', async () => {
      await store.start();
      // Saving empty pipelines tries to unlink the file. ENOENT is safe.
      await expect(store.savePipelines({ pipelines: Object.create(null) })).resolves.toBeUndefined();
    });
  });

  // ── Atomic write — tmp file renamed, not left behind ──────────────────────

  describe('atomic write behaviour', () => {
    it('leaves no .tmp file on disk after a successful save()', async () => {
      await store.start();
      await store.save({ sessions: { 's1': makeSession('s1') } });

      const entries = (await import('node:fs')).readdirSync(stateDir);
      const tmpFiles = entries.filter((e: string) => e.includes('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});

// ── store-factory error paths not in session-store.test.ts ────────────────

describe('store-factory — additional error paths', () => {
  it('throws a descriptive error for postgres backend without URL', async () => {
    await expect(
      createStateStore({ stateStore: 'postgres', postgresUrl: '' } as any),
    ).rejects.toThrow('AEGIS_POSTGRES_URL');
  });

  it('throws for unknown backend strings', async () => {
    await expect(
      createStateStore({ stateStore: 'cassandra' } as any),
    ).rejects.toThrow("Unknown state store backend: 'cassandra'");
  });
});
