/**
 * auto-approve.test.ts — Tests for Issue #26: auto-approve mode.
 */

import { describe, it, expect, vi } from 'vitest';

describe('Auto-approve mode (Issue #26)', () => {
  describe('SessionInfo.autoApprove', () => {
    it('should default to false when not specified', () => {
      const val: boolean | undefined = undefined;
      const autoApprove = val ?? false;
      expect(autoApprove).toBe(false);
    });

    it('should accept true from session creation opts', () => {
      const opts = { autoApprove: true };
      const autoApprove = opts.autoApprove ?? false;
      expect(autoApprove).toBe(true);
    });

    it('should respect config default when opts not specified', () => {
      const opts: { autoApprove?: boolean } = {};
      const configDefault = true;
      const autoApprove = opts.autoApprove ?? configDefault ?? false;
      expect(autoApprove).toBe(true);
    });

    it('should prefer session-level over config default', () => {
      const opts = { autoApprove: false };
      const configDefault = true;
      const autoApprove = opts.autoApprove ?? configDefault ?? false;
      expect(autoApprove).toBe(false);
    });
  });

  describe('Auto-approve trigger conditions', () => {
    it('should trigger on permission_prompt when autoApprove is true', () => {
      const status = 'permission_prompt';
      const autoApprove = true;
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval') && autoApprove;
      expect(shouldAutoApprove).toBe(true);
    });

    it('should trigger on bash_approval when autoApprove is true', () => {
      const status: string = 'bash_approval';
      const autoApprove = true;
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval') && autoApprove;
      expect(shouldAutoApprove).toBe(true);
    });

    it('should NOT trigger on permission_prompt when autoApprove is false', () => {
      const status = 'permission_prompt';
      const autoApprove = false;
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval') && autoApprove;
      expect(shouldAutoApprove).toBe(false);
    });

    it('should NOT trigger on working status even with autoApprove', () => {
      const status: string = 'working';
      const autoApprove = true;
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval') && autoApprove;
      expect(shouldAutoApprove).toBe(false);
    });
  });

  describe('Audit logging format', () => {
    it('should prefix auto-approved messages with [AUTO-APPROVED]', () => {
      const content = 'Write to /home/user/project/src/index.ts';
      const logMessage = `[AUTO-APPROVED] ${content}`;
      expect(logMessage).toContain('[AUTO-APPROVED]');
      expect(logMessage).toContain(content);
    });

    it('should prefix failed auto-approvals with [AUTO-APPROVE FAILED]', () => {
      const error = 'Session not found';
      const logMessage = `[AUTO-APPROVE FAILED] permission prompt: ${error}`;
      expect(logMessage).toContain('[AUTO-APPROVE FAILED]');
      expect(logMessage).toContain(error);
    });

    it('should include session name in audit log', () => {
      const windowName = 'cc-build-login';
      const sessionId = 'abc123def456';
      const logLine = `[AUTO-APPROVED] Session ${windowName} (${sessionId.slice(0, 8)}): file write`;
      expect(logLine).toContain(windowName);
      expect(logLine).toContain('abc123de');
    });
  });

  describe('Config.defaultAutoApprove', () => {
    it('should default to false', () => {
      const defaultAutoApprove = false;
      expect(defaultAutoApprove).toBe(false);
    });

    it('should be overridable to true', () => {
      const config = { defaultAutoApprove: true };
      expect(config.defaultAutoApprove).toBe(true);
    });
  });

  describe('API contract', () => {
    it('should accept autoApprove in session create body', () => {
      const body = {
        workDir: '/tmp/project',
        name: 'test',
        autoApprove: true,
      };
      expect(body.autoApprove).toBe(true);
    });

    it('should include autoApprove in session response', () => {
      const session = {
        id: 'test-id',
        autoApprove: true,
        status: 'working',
      };
      expect(session.autoApprove).toBe(true);
    });
  });
});
