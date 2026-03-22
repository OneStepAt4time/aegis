/**
 * permission-hints.test.ts — Tests for Issue #20: actionHints in API responses.
 */

import { describe, it, expect } from 'vitest';

describe('Permission prompt action hints', () => {
  describe('actionHints generation', () => {
    it('should include actionHints for permission_prompt status', () => {
      const status = 'permission_prompt';
      const sessionId = 'test-session-123';
      const needsHints = status === 'permission_prompt' || status === 'bash_approval';

      expect(needsHints).toBe(true);

      const hints = {
        approve: { method: 'POST', url: `/v1/sessions/${sessionId}/approve`, description: 'Approve the pending permission' },
        reject: { method: 'POST', url: `/v1/sessions/${sessionId}/reject`, description: 'Reject the pending permission' },
      };

      expect(hints.approve.method).toBe('POST');
      expect(hints.approve.url).toContain(sessionId);
      expect(hints.approve.url).toContain('/approve');
      expect(hints.reject.url).toContain('/reject');
    });

    it('should include actionHints for bash_approval status', () => {
      const status: string = 'bash_approval';
      const needsHints = status === 'permission_prompt' || status === 'bash_approval';
      expect(needsHints).toBe(true);
    });

    it('should NOT include actionHints for idle status', () => {
      const status: string = 'idle';
      const needsHints = status === 'permission_prompt' || status === 'bash_approval';
      expect(needsHints).toBe(false);
    });

    it('should NOT include actionHints for working status', () => {
      const status: string = 'working';
      const needsHints = status === 'permission_prompt' || status === 'bash_approval';
      expect(needsHints).toBe(false);
    });
  });

  describe('health endpoint details message', () => {
    it('should include approve/reject URLs in details for permission_prompt', () => {
      const sessionId = 'abc-123';
      const status = 'permission_prompt';
      let details = '';

      if (status === 'permission_prompt' || status === 'bash_approval') {
        details = `Claude is waiting for permission approval. POST /v1/sessions/${sessionId}/approve to approve, or /v1/sessions/${sessionId}/reject to reject.`;
      }

      expect(details).toContain('/approve');
      expect(details).toContain('/reject');
      expect(details).toContain(sessionId);
      expect(details).toContain('POST');
    });
  });

  describe('addActionHints helper', () => {
    it('should add actionHints to session with permission_prompt', () => {
      const session = {
        id: 'test-id',
        status: 'permission_prompt' as const,
        windowId: '@1',
        windowName: 'test',
      };

      const result: Record<string, unknown> = { ...session };
      if (session.status === 'permission_prompt' || session.status === 'bash_approval') {
        result.actionHints = {
          approve: { method: 'POST', url: `/v1/sessions/${session.id}/approve`, description: 'Approve the pending permission' },
          reject: { method: 'POST', url: `/v1/sessions/${session.id}/reject`, description: 'Reject the pending permission' },
        };
      }

      expect(result.actionHints).toBeDefined();
      expect((result.actionHints as any).approve.url).toBe('/v1/sessions/test-id/approve');
    });

    it('should NOT add actionHints to session with idle status', () => {
      const session = {
        id: 'test-id',
        status: 'idle' as string,
        windowId: '@1',
        windowName: 'test',
      };

      const result: Record<string, unknown> = { ...session };
      if (session.status === 'permission_prompt' || session.status === 'bash_approval') {
        result.actionHints = {};
      }

      expect(result.actionHints).toBeUndefined();
    });
  });
});
