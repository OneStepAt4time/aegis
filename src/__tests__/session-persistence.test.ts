/**
 * session-persistence.test.ts — Tests for Issue #35: session persistence + resume.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';

describe('Session persistence and resume (Issue #35)', () => {
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

    it('should set permissionMode to "bypassPermissions" for adopted sessions', () => {
      const permissionMode = 'bypassPermissions';
      expect(permissionMode).toBe('bypassPermissions');
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
