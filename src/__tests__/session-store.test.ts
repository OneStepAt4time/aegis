/**
 * session-store.test.ts — Tests for Issue #1937: pluggable SessionStore interface.
 *
 * Tests the StateStore interface, JsonFileStore, and store-factory.
 * PostgresStore tests are integration-level and skipped without a running Postgres.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileStore } from '../services/state/JsonFileStore.js';
import { createStateStore } from '../services/state/store-factory.js';
import type { StateStore, SerializedSessionInfo, SerializedPipelineEntry, SerializedPipelineState } from '../services/state/state-store.js';

/** Minimal valid SerializedSessionInfo for tests. */
function makeSession(id: string, overrides: Partial<SerializedSessionInfo> = {}): SerializedSessionInfo {
  return {
    id,
    windowId: `@${id.slice(0, 4)}`,
    windowName: `cc-${id.slice(0, 8)}`,
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

describe('JsonFileStore (Issue #1937)', () => {
  let stateDir: string;
  let store: JsonFileStore;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'aegis-store-test-'));
    store = new JsonFileStore({ stateDir });
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  describe('start()', () => {
    it('creates the state directory if it does not exist', async () => {
      const newDir = join(stateDir, 'nested', 'dir');
      const nestedStore = new JsonFileStore({ stateDir: newDir });
      await nestedStore.start();
      expect(existsSync(newDir)).toBe(true);
    });
  });

  describe('load()', () => {
    it('returns empty state when no state file exists', async () => {
      await store.start();
      const state = await store.load();
      expect(Object.keys(state.sessions)).toHaveLength(0);
    });

    it('loads sessions from state.json', async () => {
      const session = makeSession('aaa-001');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        join(stateDir, 'state.json'),
        JSON.stringify({ sessions: { 'aaa-001': session } }),
      );

      await store.start();
      const state = await store.load();
      expect(state.sessions['aaa-001']).toBeDefined();
      expect(state.sessions['aaa-001']!.windowName).toBe(`cc-aaa-001`);
    });

    it('falls back to backup when state.json is corrupted', async () => {
      const session = makeSession('bbb-002');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(stateDir, 'state.json'), 'not valid json');
      await writeFile(
        join(stateDir, 'state.json.bak'),
        JSON.stringify({ sessions: { 'bbb-002': session } }),
      );

      await store.start();
      const state = await store.load();
      expect(state.sessions['bbb-002']).toBeDefined();
    });
  });

  describe('save()', () => {
    it('writes sessions to state.json', async () => {
      await store.start();
      const session = makeSession('ccc-003');
      await store.save({ sessions: { 'ccc-003': session } });

      const raw = readFileSync(join(stateDir, 'state.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.sessions['ccc-003']).toBeDefined();
    });

    it('overwrites previous state on save', async () => {
      await store.start();
      await store.save({ sessions: { 'old': makeSession('old') } });
      await store.save({ sessions: { 'new': makeSession('new') } });

      const state = await store.load();
      expect(state.sessions['old']).toBeUndefined();
      expect(state.sessions['new']).toBeDefined();
    });
  });

  describe('getSession()', () => {
    it('returns a single session by ID', async () => {
      await store.start();
      const session = makeSession('ddd-004');
      await store.save({ sessions: { 'ddd-004': session } });

      const result = await store.getSession('ddd-004');
      expect(result).toBeDefined();
      expect(result!.windowName).toBe('cc-ddd-004');
    });

    it('returns undefined for unknown ID', async () => {
      await store.start();
      const result = await store.getSession('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('putSession()', () => {
    it('adds a new session', async () => {
      await store.start();
      const session = makeSession('eee-005');
      await store.putSession('eee-005', session);

      const state = await store.load();
      expect(state.sessions['eee-005']).toBeDefined();
    });
  });

  describe('deleteSession()', () => {
    it('removes a session', async () => {
      await store.start();
      await store.save({ sessions: { 'fff-006': makeSession('fff-006') } });
      await store.deleteSession('fff-006');

      const state = await store.load();
      expect(state.sessions['fff-006']).toBeUndefined();
    });
  });

  describe('listSessionIds()', () => {
    it('returns all session IDs', async () => {
      await store.start();
      await store.save({
        sessions: {
          'ggg-007': makeSession('ggg-007'),
          'ggg-008': makeSession('ggg-008'),
        },
      });

      const ids = await store.listSessionIds();
      expect(ids).toContain('ggg-007');
      expect(ids).toContain('ggg-008');
      expect(ids).toHaveLength(2);
    });
  });

  describe('health()', () => {
    it('reports healthy when state dir exists', async () => {
      await store.start();
      const h = await store.health();
      expect(h.healthy).toBe(true);
    });
  });

  // ── Pipeline methods (Issue #1938) ──────────────────────────────────

  function makePipelineEntry(id: string, name: string, overrides: Partial<SerializedPipelineEntry['state']> = {}): SerializedPipelineEntry {
    return {
      state: {
        id,
        name,
        currentStage: 'plan',
        status: 'running',
        retryCount: 0,
        maxRetries: 3,
        stageHistory: [{ stage: 'plan', enteredAt: Date.now() }],
        stages: [{ name: 'A', status: 'pending', dependsOn: [] }],
        createdAt: Date.now(),
        ...overrides,
      },
      config: {
        name,
        workDir: '/app',
        stages: [{ name: 'A', prompt: 'run a', dependsOn: [] }],
      },
    };
  }

  describe('pipeline methods (Issue #1938)', () => {
    it('loadPipelines returns empty state when no pipelines exist', async () => {
      await store.start();
      const state = await store.loadPipelines();
      expect(Object.keys(state.pipelines)).toHaveLength(0);
    });

    it('putPipeline + getPipeline round-trip', async () => {
      await store.start();
      const entry = makePipelineEntry('p-001', 'test-pipeline');
      await store.putPipeline('p-001', entry);

      const result = await store.getPipeline('p-001');
      expect(result).toBeDefined();
      expect(result!.state.name).toBe('test-pipeline');
      expect(result!.config).toBeDefined();
      expect(result!.config!.stages[0].prompt).toBe('run a');
    });

    it('savePipelines + loadPipelines round-trip', async () => {
      await store.start();
      const entry = makePipelineEntry('p-002', 'batch-test');
      await store.savePipelines({ pipelines: { 'p-002': entry } });

      const state = await store.loadPipelines();
      expect(state.pipelines['p-002']).toBeDefined();
      expect(state.pipelines['p-002']!.state.name).toBe('batch-test');
    });

    it('deletePipeline removes a pipeline', async () => {
      await store.start();
      const entry = makePipelineEntry('p-003', 'delete-me');
      await store.putPipeline('p-003', entry);

      await store.deletePipeline('p-003');
      const result = await store.getPipeline('p-003');
      expect(result).toBeUndefined();
    });

    it('listPipelineIds returns all IDs', async () => {
      await store.start();
      await store.putPipeline('p-004', makePipelineEntry('p-004', 'a'));
      await store.putPipeline('p-005', makePipelineEntry('p-005', 'b'));

      const ids = await store.listPipelineIds();
      expect(ids).toContain('p-004');
      expect(ids).toContain('p-005');
      expect(ids).toHaveLength(2);
    });

    it('savePipelines with empty map cleans up', async () => {
      await store.start();
      await store.putPipeline('p-006', makePipelineEntry('p-006', 'cleanup'));
      await store.savePipelines({ pipelines: {} });

      const ids = await store.listPipelineIds();
      expect(ids).toHaveLength(0);
    });

    it('loadPipelines reads legacy array format from pipelines.json', async () => {
      await store.start();
      const { writeFile: writeFn } = await import('node:fs/promises');
      // Write legacy array format (pre-#1938)
      await writeFn(
        join(stateDir, 'pipelines.json'),
        JSON.stringify([
          {
            id: 'legacy-001',
            name: 'legacy-pipeline',
            status: 'running',
            stages: [{ name: 'A', status: 'running', dependsOn: [] }],
            stageHistory: [],
            createdAt: Date.now(),
            currentStage: 'execute',
            retryCount: 0,
            maxRetries: 3,
            _config: { name: 'legacy-pipeline', workDir: '/app', stages: [{ name: 'A', prompt: 'build', dependsOn: [] }] },
          },
        ]),
      );

      const state = await store.loadPipelines();
      expect(state.pipelines['legacy-001']).toBeDefined();
      expect(state.pipelines['legacy-001']!.state.name).toBe('legacy-pipeline');
      expect(state.pipelines['legacy-001']!.config).toBeDefined();
    });

    it('getPipeline returns undefined for unknown ID', async () => {
      await store.start();
      const result = await store.getPipeline('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  // ── Concurrency / TOCTOU (Issue #2450) ────────────────────────────────

  describe('concurrent session writes (Issue #2450)', () => {
    it('does not lose sessions under concurrent putSession calls', async () => {
      await store.start();

      const count = 20;
      const ids = Array.from({ length: count }, (_, i) => `concurrent-${i}`);
      await Promise.all(ids.map(id => store.putSession(id, makeSession(id))));

      const finalState = await store.load();
      for (const id of ids) {
        expect(finalState.sessions[id]).toBeDefined();
        expect(finalState.sessions[id]!.windowName).toBe(`cc-${id.slice(0, 8)}`);
      }
      expect(Object.keys(finalState.sessions)).toHaveLength(count);
    });

    it('does not lose sessions when put and delete run concurrently', async () => {
      await store.start();
      // Seed 10 sessions
      const seedIds = Array.from({ length: 10 }, (_, i) => `seed-${i}`);
      for (const id of seedIds) {
        await store.putSession(id, makeSession(id));
      }

      // Concurrently: add new sessions and delete some seeded ones
      const ops: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        ops.push(store.putSession(`new-${i}`, makeSession(`new-${i}`)));
        ops.push(store.deleteSession(`seed-${i}`));
      }
      await Promise.all(ops);

      const finalState = await store.load();
      // All seed sessions should be gone
      for (const id of seedIds) {
        expect(finalState.sessions[id]).toBeUndefined();
      }
      // All new sessions should exist
      for (let i = 0; i < 10; i++) {
        expect(finalState.sessions[`new-${i}`]).toBeDefined();
      }
    });

    it('does not lose pipelines under concurrent putPipeline calls', async () => {
      await store.start();

      const count = 15;
      const ids = Array.from({ length: count }, (_, i) => `pl-${i}`);
      await Promise.all(ids.map(id => store.putPipeline(id, makePipelineEntry(id, `pipeline-${id}`))));

      const idsList = await store.listPipelineIds();
      expect(idsList).toHaveLength(count);
      for (const id of ids) {
        const entry = await store.getPipeline(id);
        expect(entry).toBeDefined();
        expect(entry!.state.name).toBe(`pipeline-${id}`);
      }
    });
  });
});

describe('store-factory (Issue #1937)', () => {
  it('creates JsonFileStore for file backend', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'aegis-factory-'));
    try {
      const store = await createStateStore({
        stateStore: 'file',
        stateDir,
      } as any);
      expect(store).toBeInstanceOf(JsonFileStore);
      await store.stop(AbortSignal.timeout(1000));
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('creates JsonFileStore as default', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'aegis-factory-default-'));
    try {
      const store = await createStateStore({
        stateStore: '',
        stateDir,
      } as any);
      expect(store).toBeInstanceOf(JsonFileStore);
      await store.stop(AbortSignal.timeout(1000));
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it('throws for unknown backend', async () => {
    await expect(
      createStateStore({ stateStore: 'unknown' } as any),
    ).rejects.toThrow("Unknown state store backend: 'unknown'");
  });

  it('throws for postgres without URL', async () => {
    await expect(
      createStateStore({ stateStore: 'postgres', postgresUrl: '' } as any),
    ).rejects.toThrow('PostgresStore requires AEGIS_POSTGRES_URL');
  });
});
