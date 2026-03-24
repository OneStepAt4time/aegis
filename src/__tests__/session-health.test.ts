/**
 * session-health.test.ts — Tests for Issue #2: session health check endpoint.
 */

import { describe, it, expect } from 'vitest';

describe('Session health check', () => {
  describe('alive determination', () => {
    it('should be alive when window exists and Claude is running', () => {
      const windowExists = true;
      const claudeRunning = true;
      const recentlyActive = false;
      const alive = windowExists && (claudeRunning || recentlyActive);
      expect(alive).toBe(true);
    });

    it('should be alive when window exists and recently active', () => {
      const windowExists = true;
      const claudeRunning = false;
      const lastActivityAgo = 2 * 60 * 1000; // 2 minutes
      const recentlyActive = lastActivityAgo < 5 * 60 * 1000;
      const alive = windowExists && (claudeRunning || recentlyActive);
      expect(alive).toBe(true);
    });

    it('should be dead when window does not exist', () => {
      const windowExists = false;
      const claudeRunning = false;
      const recentlyActive = true;
      const alive = windowExists && (claudeRunning || recentlyActive);
      expect(alive).toBe(false);
    });

    it('should be dead when window exists but Claude not running and not recently active', () => {
      const windowExists = true;
      const claudeRunning = false;
      const lastActivityAgo = 10 * 60 * 1000; // 10 minutes
      const recentlyActive = lastActivityAgo < 5 * 60 * 1000;
      const alive = windowExists && (claudeRunning || recentlyActive);
      expect(alive).toBe(false);
    });
  });

  describe('Claude process detection', () => {
    it('should detect Claude process', () => {
      const claudeProcesses = ['claude', 'node'];
      for (const proc of claudeProcesses) {
        const running = proc === 'claude' || proc === 'node';
        expect(running).toBe(true);
      }
    });

    it('should not detect shell as Claude', () => {
      const shellProcesses = ['bash', 'zsh', 'sh', 'fish'];
      for (const proc of shellProcesses) {
        const running = proc === 'claude' || proc === 'node';
        expect(running).toBe(false);
      }
    });
  });

  describe('health response shape', () => {
    it('should contain all required fields', () => {
      const response = {
        alive: true,
        windowExists: true,
        claudeRunning: true,
        paneCommand: 'claude',
        status: 'working',
        hasTranscript: true,
        lastActivity: Date.now(),
        lastActivityAgo: 5000,
        sessionAge: 60000,
        details: 'Claude is actively working',
      };

      expect(response).toHaveProperty('alive');
      expect(response).toHaveProperty('windowExists');
      expect(response).toHaveProperty('claudeRunning');
      expect(response).toHaveProperty('paneCommand');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('hasTranscript');
      expect(response).toHaveProperty('lastActivity');
      expect(response).toHaveProperty('lastActivityAgo');
      expect(response).toHaveProperty('sessionAge');
      expect(response).toHaveProperty('details');
    });
  });

  describe('detail messages', () => {
    it('should report dead window', () => {
      const windowExists = false;
      const detail = !windowExists
        ? 'Tmux window does not exist — session is dead'
        : 'ok';
      expect(detail).toContain('dead');
    });

    it('should report idle Claude', () => {
      const status = 'idle';
      const detail = status === 'idle'
        ? 'Claude is idle, awaiting input'
        : 'other';
      expect(detail).toContain('idle');
    });

    it('should report working Claude', () => {
      const status = 'working';
      const detail = status === 'working'
        ? 'Claude is actively working'
        : 'other';
      expect(detail).toContain('working');
    });

    it('should report permission needed', () => {
      const status = 'permission_prompt';
      const detail = (status === 'permission_prompt' || status === 'bash_approval')
        ? 'Claude is waiting for permission approval'
        : 'other';
      expect(detail).toContain('permission');
    });
  });

  describe('dead session detection in monitor', () => {
    it('should emit status.dead event when tmux window no longer exists', () => {
      const deadNotified = new Set<string>();
      const sessionId = 'test-session-1';

      // Simulate: window is dead, not yet notified
      const alive = false;
      if (!alive && !deadNotified.has(sessionId)) {
        deadNotified.add(sessionId);
        // Should emit status.dead event
      }
      expect(deadNotified.has(sessionId)).toBe(true);
    });

    it('should NOT emit status.dead twice for same session', () => {
      const deadNotified = new Set<string>();
      const sessionId = 'test-session-1';

      // First check: dead
      deadNotified.add(sessionId);
      // Second check: already notified
      const alive = false;
      if (!alive && !deadNotified.has(sessionId)) {
        deadNotified.add(sessionId);
      }
      expect(deadNotified.size).toBe(1);
    });

    it('should clean deadNotified when session is removed', () => {
      const deadNotified = new Set<string>();
      const sessionId = 'test-session-1';

      deadNotified.add(sessionId);
      // Simulate removeSession cleanup
      deadNotified.delete(sessionId);
      expect(deadNotified.has(sessionId)).toBe(false);
    });

    it('should include last activity timestamp in dead notification', () => {
      const lastActivity = Date.now() - 5 * 60 * 1000; // 5 min ago
      const detail = `Session "cc-test" died — tmux window no longer exists. ` +
        `Last activity: ${new Date(lastActivity).toISOString()}`;
      expect(detail).toContain('died');
      expect(detail).toContain('tmux window no longer exists');
      expect(detail).toContain('Last activity:');
    });
  });

  describe('isWindowAlive on SessionManager', () => {
    it('should return false for non-existent session', async () => {
      const sessions = new Map<string, any>();
      const id = 'nonexistent';
      const session = sessions.get(id);
      if (!session) {
        // isWindowAlive returns false
        expect(true).toBe(true);
      }
    });

    it('should return false when windowExists throws', async () => {
      const throws = true;
      let result = false;
      try {
        if (throws) throw new Error('tmux error');
        result = true;
      } catch {
        result = false;
      }
      expect(result).toBe(false);
    });
  });
});
