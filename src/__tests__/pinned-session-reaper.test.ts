/**
 * Unit tests for Issue #4027: pinned-session reaper semantics.
 *
 * Tests that the SessionManager correctly stores/retrieves the isPinned field,
 * and that the reaper logic can distinguish pinned vs unpinned sessions.
 */
import { describe, expect, it } from 'vitest';
import { SessionManager } from '../session.js';
import type { Config } from '../config.js';

function makeConfig(stateDir: string): Config {
  return {
    stateDir,
    maxSessionAgeMs: 3600000,
    reaperIntervalMs: 60000,
    stallThresholdMs: 300000,
    permissionStallMs: 300000,
    computeStallThreshold: () => 300000,
    baseUrl: 'http://localhost:9100',
    allowedWorkDirs: ['/tmp'],
  } as unknown as Config;
}

describe('Issue #4027: pinned-session reaper semantics', () => {
  describe('SessionManager.updateSessionMetadata', () => {
    it('sets isPinned on a session', async () => {
      const config = makeConfig('/tmp/test-pinned-' + Date.now());
      const sm = new SessionManager(config);
      await sm.load();

      const session = await sm.createSession({
        workDir: '/tmp',
        name: 'test-pinned',
        permissionMode: 'default',
      });

      const updated = await sm.updateSessionMetadata(session.id, { isPinned: true });
      expect(updated).not.toBeNull();
      expect(updated!.isPinned).toBe(true);

      // Verify in-memory state
      const retrieved = sm.getSession(session.id);
      expect(retrieved!.isPinned).toBe(true);
    });

    it('unpins a session', async () => {
      const config = makeConfig('/tmp/test-unpin-' + Date.now());
      const sm = new SessionManager(config);
      await sm.load();

      const session = await sm.createSession({
        workDir: '/tmp',
        name: 'test-unpin',
        permissionMode: 'default',
      });

      await sm.updateSessionMetadata(session.id, { isPinned: true });
      const unpinned = await sm.updateSessionMetadata(session.id, { isPinned: false });
      expect(unpinned!.isPinned).toBe(false);
    });

    it('returns null for nonexistent session', async () => {
      const config = makeConfig('/tmp/test-nonexist-' + Date.now());
      const sm = new SessionManager(config);
      await sm.load();

      const result = await sm.updateSessionMetadata('nonexistent-id', { isPinned: true });
      expect(result).toBeNull();
    });
  });

  describe('reaper logic', () => {
    it('isPinned sessions are distinguishable from unpinned', async () => {
      const config = makeConfig('/tmp/test-logic-' + Date.now());
      const sm = new SessionManager(config);
      await sm.load();

      const pinned = await sm.createSession({
        workDir: '/tmp',
        name: 'pinned',
        permissionMode: 'default',
      });
      await sm.updateSessionMetadata(pinned.id, { isPinned: true });

      const unpinned = await sm.createSession({
        workDir: '/tmp',
        name: 'unpinned',
        permissionMode: 'default',
      });

      // Simulate reaper logic: filter by isPinned flag
      const allSessions = sm.listSessions();
      const pinnedSessions = allSessions.filter(s => s.isPinned === true);
      const unpinnedSessions = allSessions.filter(s => !s.isPinned);

      expect(pinnedSessions).toHaveLength(1);
      expect(pinnedSessions[0]!.id).toBe(pinned.id);
      expect(unpinnedSessions).toHaveLength(1);
      expect(unpinnedSessions[0]!.id).toBe(unpinned.id);
    });

    it('isPinned defaults to undefined (falsy)', async () => {
      const config = makeConfig('/tmp/test-default-' + Date.now());
      const sm = new SessionManager(config);
      await sm.load();

      const session = await sm.createSession({
        workDir: '/tmp',
        name: 'default-pin',
        permissionMode: 'default',
      });

      expect(session.isPinned).toBeFalsy();
      expect(session.isPinned).not.toBe(true);
    });
  });
});
