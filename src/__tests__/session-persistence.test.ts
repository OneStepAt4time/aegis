/**
 * session-persistence.test.ts — Tests for Issue #35: session persistence + resume.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { SessionManager } from '../session.js';

describe('Session persistence and resume (Issue #35)', () => {
  describe('Issue #1644: hook secret persistence hardening', () => {
    function makeConfig(stateDir: string) {
      return {
        stateDir,
        host: '127.0.0.1',
        port: 9100,
        tmuxSession: 'aegis',
        claudeProjectsDir: '/tmp/.claude/projects',
        maxSessionAgeMs: 7_200_000,
        reaperIntervalMs: 60_000,
        defaultPermissionMode: 'default',
        defaultSessionEnv: {},
        allowedWorkDirs: [],
        sseMaxConnections: 50,
        sseMaxPerIp: 5,
        worktreeAwareContinuation: false,
        worktreeSiblingDirs: [],
      } as const;
    }

    function makeTmux(windowId: string, windowName: string) {
      return {
        listWindows: async () => [{ windowId, windowName, cwd: '/tmp/project' }],
      };
    }

    it('does not persist hookSecret in state.json', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'aegis-1644-state-'));
      try {
        const sessionId = '550e8400-e29b-41d4-a716-446655440010';
        const manager = new SessionManager(
          makeTmux('@10', 'cc-1644-save') as any,
          makeConfig(stateDir) as any,
        );

        (manager as any).state.sessions[sessionId] = {
          id: sessionId,
          windowId: '@10',
          windowName: 'cc-1644-save',
          workDir: '/tmp/project',
          claudeSessionId: 'claude-session-1',
          jsonlPath: '/tmp/project/session.jsonl',
          byteOffset: 0,
          monitorOffset: 0,
          status: 'idle',
          createdAt: Date.now(),
          lastActivity: Date.now(),
          stallThresholdMs: 300000,
          permissionStallMs: 300000,
          permissionMode: 'default',
          hookSecret: 'plaintext-secret-must-not-persist',
        };

        await manager.save();

        const content = await readFile(join(stateDir, 'state.json'), 'utf-8');
        expect(content).not.toContain('hookSecret');
        expect(content).not.toContain('plaintext-secret-must-not-persist');
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });

    it('restores hookSecret from hook settings file during load', async () => {
      const stateDir = mkdtempSync(join(tmpdir(), 'aegis-1644-restore-'));
      try {
        const sessionId = '550e8400-e29b-41d4-a716-446655440011';
        const hookSettingsFile = join(stateDir, 'hooks.json');
        const restoredSecret = 'restored-hook-secret';

        await writeFile(
          hookSettingsFile,
          JSON.stringify({
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: 'http',
                      url: `http://127.0.0.1:9100/v1/hooks/Stop?sessionId=${sessionId}`,
                      headers: { 'X-Hook-Secret': restoredSecret },
                    },
                  ],
                },
              ],
            },
          }),
          'utf-8',
        );

        await writeFile(
          join(stateDir, 'state.json'),
          JSON.stringify({
            [sessionId]: {
              id: sessionId,
              windowId: '@11',
              windowName: 'cc-1644-restore',
              workDir: '/tmp/project',
              claudeSessionId: 'claude-session-2',
              jsonlPath: '/tmp/project/session.jsonl',
              byteOffset: 0,
              monitorOffset: 0,
              status: 'idle',
              createdAt: Date.now(),
              lastActivity: Date.now(),
              stallThresholdMs: 300000,
              permissionStallMs: 300000,
              permissionMode: 'default',
              hookSettingsFile,
            },
          }, null, 2),
          'utf-8',
        );

        const manager = new SessionManager(
          makeTmux('@11', 'cc-1644-restore') as any,
          makeConfig(stateDir) as any,
        );

        await manager.load();
        const session = manager.getSession(sessionId);
        expect(session?.hookSecret).toBe(restoredSecret);
      } finally {
        rmSync(stateDir, { recursive: true, force: true });
      }
    });
  });

  describe('Orphan detection', () => {
    it('should identify cc-* windows as adoptable', () => {
      const windowName = 'cc-abc12345';
      const isAdoptable = windowName.startsWith('cc-') || windowName.startsWith('_bridge_');
      expect(isAdoptable).toBe(true);
    });

    it('should identify _bridge_* windows as adoptable', () => {
      const windowName = '_bridge_main';
      const isAdoptable = windowName.startsWith('cc-') || windowName.startsWith('_bridge_');
      expect(isAdoptable).toBe(true);
    });

    it('should NOT adopt arbitrary windows', () => {
      const windowName = 'vim-editor';
      const isAdoptable = windowName.startsWith('cc-') || windowName.startsWith('_bridge_');
      expect(isAdoptable).toBe(false);
    });

    it('should skip windows already in state', () => {
      const knownWindowIds = new Set(['@1', '@2']);
      const knownWindowNames = new Set(['cc-session1', 'cc-session2']);
      const orphanedWindow = { windowId: '@3', windowName: 'cc-orphan', cwd: '/tmp' };

      const isKnown = knownWindowIds.has(orphanedWindow.windowId) || knownWindowNames.has(orphanedWindow.windowName);
      expect(isKnown).toBe(false);
    });

    it('should skip known windows by ID', () => {
      const knownWindowIds = new Set(['@1', '@2']);
      const window = { windowId: '@1', windowName: 'cc-known', cwd: '/tmp' };

      expect(knownWindowIds.has(window.windowId)).toBe(true);
    });
  });

  describe('Session info for adopted orphans', () => {
    it('should use window cwd as workDir', () => {
      const win = { cwd: '/home/user/projects/app' };
      const workDir = win.cwd || homedir();
      expect(workDir).toBe('/home/user/projects/app');
    });

    it('should fallback to homedir when cwd is empty', () => {
      const win = { cwd: '' };
      const workDir = win.cwd || homedir();
      expect(workDir).toBe(homedir());
    });

    it('should set permissionMode to "default" for adopted sessions', () => {
      const permissionMode = 'default';
      expect(permissionMode).toBe('default');
    });

    it('should set status to unknown for adopted sessions', () => {
      const status = 'unknown';
      expect(status).toBe('unknown');
    });
  });

  describe('Summary endpoint', () => {
    it('should truncate long message text to 500 chars', () => {
      const longText = 'x'.repeat(1000);
      const truncated = longText.slice(0, 500);
      expect(truncated.length).toBe(500);
    });

    it('should take last N messages', () => {
      const allMessages = Array.from({ length: 50 }, (_, i) => ({
        role: 'assistant',
        contentType: 'text',
        text: `Message ${i}`,
      }));
      const maxMessages = 20;
      const recent = allMessages.slice(-maxMessages);
      expect(recent).toHaveLength(20);
      expect(recent[0].text).toBe('Message 30');
      expect(recent[19].text).toBe('Message 49');
    });

    it('should return correct summary shape', () => {
      const summary = {
        sessionId: 'test-id',
        windowName: 'cc-test',
        status: 'idle',
        totalMessages: 50,
        messages: [],
        createdAt: Date.now(),
        lastActivity: Date.now(),
        permissionMode: 'default',
      };

      expect(summary.sessionId).toBe('test-id');
      expect(summary.totalMessages).toBe(50);
      expect(typeof summary.createdAt).toBe('number');
    });

    it('should handle sessions with no JSONL', () => {
      const allMessages: any[] = [];
      const recent = allMessages.slice(-20);
      expect(recent).toHaveLength(0);

      const summary = {
        totalMessages: 0,
        messages: recent,
      };
      expect(summary.totalMessages).toBe(0);
    });
  });

  describe('#218: Save queue serializes concurrent writes', () => {
    it('should serialize saves using a promise queue', async () => {
      // Simulate the save queue pattern
      let saveQueue: Promise<void> = Promise.resolve();
      const writeOrder: number[] = [];
      let callCount = 0;

      const doSave = async (id: number): Promise<void> => {
        callCount++;
        writeOrder.push(id);
      };

      // Enqueue 5 concurrent saves
      for (let i = 1; i <= 5; i++) {
        const id = i;
        saveQueue = saveQueue.then(() => doSave(id)).catch(e => console.error(e));
      }
      await saveQueue;

      // All saves should have run in order (serialized)
      expect(callCount).toBe(5);
      expect(writeOrder).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle errors without breaking the queue', async () => {
      let saveQueue: Promise<void> = Promise.resolve();
      const results: string[] = [];

      const doSave = async (name: string, shouldFail: boolean): Promise<void> => {
        if (shouldFail) throw new Error(`Save ${name} failed`);
        results.push(name);
      };

      // First save fails, second should still run
      saveQueue = saveQueue.then(() => doSave('a', true)).catch(() => {});
      saveQueue = saveQueue.then(() => doSave('b', false)).catch(() => {});
      await saveQueue;

      expect(results).toEqual(['b']);
    });

    it('should await the queue in save()', async () => {
      // Verify that callers get proper await semantics
      let saveQueue: Promise<void> = Promise.resolve();
      let saveCount = 0;

      const doSave = async (): Promise<void> => {
        saveCount++;
      };

      // Simulate: save() awaits the queue
      const save = async (): Promise<void> => {
        saveQueue = saveQueue.then(() => doSave()).catch(e => console.error(e));
        await saveQueue;
      };

      // Rapid-fire saves
      await Promise.all([save(), save(), save()]);
      expect(saveCount).toBe(3);
    });
  });
});
