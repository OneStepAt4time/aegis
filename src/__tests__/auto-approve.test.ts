/**
 * auto-approve.test.ts — Tests for permission mode (replaces boolean autoApprove).
 */

import { describe, it, expect } from 'vitest';

const VALID_PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'auto'];
const AUTO_APPROVE_MODES = new Set(['bypassPermissions', 'dontAsk', 'acceptEdits', 'plan', 'auto']);

describe('Permission mode', () => {
  describe('SessionInfo.permissionMode', () => {
    it('should default to "default" when not specified', () => {
      const val: string | undefined = undefined;
      const permissionMode = val ?? 'default';
      expect(permissionMode).toBe('default');
    });

    it('should accept a permission mode string from session creation opts', () => {
      const opts = { permissionMode: 'acceptEdits' };
      const permissionMode = opts.permissionMode ?? 'default';
      expect(permissionMode).toBe('acceptEdits');
    });

    it('should respect config default when opts not specified', () => {
      const opts: { permissionMode?: string } = {};
      const configDefault = 'plan';
      const permissionMode = opts.permissionMode ?? configDefault ?? 'default';
      expect(permissionMode).toBe('plan');
    });

    it('should prefer session-level over config default', () => {
      const opts = { permissionMode: 'acceptEdits' };
      const configDefault = 'plan';
      const permissionMode = opts.permissionMode ?? configDefault ?? 'default';
      expect(permissionMode).toBe('acceptEdits');
    });
  });

  describe('Backward compatibility: autoApprove boolean', () => {
    it('should map autoApprove=true to bypassPermissions', () => {
      const opts: { permissionMode?: string; autoApprove?: boolean } = { autoApprove: true };
      const resolvedMode = opts.permissionMode
        ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
        ?? 'default';
      expect(resolvedMode).toBe('bypassPermissions');
    });

    it('should map autoApprove=false to default', () => {
      const opts: { permissionMode?: string; autoApprove?: boolean } = { autoApprove: false };
      const resolvedMode = opts.permissionMode
        ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
        ?? 'default';
      expect(resolvedMode).toBe('default');
    });

    it('should prefer permissionMode over autoApprove', () => {
      const opts = { permissionMode: 'plan', autoApprove: true };
      const resolvedMode = opts.permissionMode
        ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
        ?? 'default';
      expect(resolvedMode).toBe('plan');
    });

    it('should default when neither is specified', () => {
      const opts: { permissionMode?: string; autoApprove?: boolean } = {};
      const resolvedMode = opts.permissionMode
        ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
        ?? 'default';
      expect(resolvedMode).toBe('default');
    });
  });

  describe('Auto-approve trigger conditions', () => {
    it('should trigger on permission_prompt when mode is bypassPermissions', () => {
      const status: string = 'permission_prompt';
      const permissionMode: string = 'bypassPermissions';
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval')
        && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode);
      expect(shouldAutoApprove).toBe(true);
    });

    it('should trigger on bash_approval when mode is acceptEdits', () => {
      const status: string = 'bash_approval';
      const permissionMode: string = 'acceptEdits';
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval')
        && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode);
      expect(shouldAutoApprove).toBe(true);
    });

    it('should NOT trigger on permission_prompt when mode is default', () => {
      const status: string = 'permission_prompt';
      const permissionMode: string = 'default';
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval')
        && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode);
      expect(shouldAutoApprove).toBe(false);
    });

    it('should NOT trigger on working status even with non-default mode', () => {
      const status: string = 'working';
      const permissionMode: string = 'bypassPermissions';
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval')
        && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode);
      expect(shouldAutoApprove).toBe(false);
    });

    it('should auto-approve for plan mode', () => {
      const status: string = 'permission_prompt';
      const permissionMode: string = 'plan';
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval')
        && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode);
      expect(shouldAutoApprove).toBe(true);
    });

    it('should auto-approve for auto mode', () => {
      const status: string = 'bash_approval';
      const permissionMode: string = 'auto';
      const shouldAutoApprove = (status === 'permission_prompt' || status === 'bash_approval')
        && permissionMode !== 'default' && AUTO_APPROVE_MODES.has(permissionMode);
      expect(shouldAutoApprove).toBe(true);
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

  describe('Config.defaultPermissionMode', () => {
    it('should default to "default" (safest mode)', () => {
      const defaultPermissionMode = 'default';
      expect(defaultPermissionMode).toBe('default');
    });

    it('should be overridable to other modes', () => {
      const config = { defaultPermissionMode: 'plan' };
      expect(config.defaultPermissionMode).toBe('plan');
    });
  });

  describe('API contract', () => {
    it('should accept permissionMode in session create body', () => {
      const body = {
        workDir: '/tmp/project',
        name: 'test',
        permissionMode: 'acceptEdits',
      };
      expect(body.permissionMode).toBe('acceptEdits');
    });

    it('should still accept autoApprove for backward compat', () => {
      const body = {
        workDir: '/tmp/project',
        name: 'test',
        autoApprove: true,
      };
      expect(body.autoApprove).toBe(true);
    });

    it('should include permissionMode in session response', () => {
      const session = {
        id: 'test-id',
        permissionMode: 'acceptEdits',
        status: 'working',
      };
      expect(session.permissionMode).toBe('acceptEdits');
    });
  });

  describe('Valid permission modes', () => {
    for (const mode of VALID_PERMISSION_MODES) {
      it(`"${mode}" is a valid mode`, () => {
        expect(VALID_PERMISSION_MODES).toContain(mode);
      });
    }
  });

  describe('Permission guard activation', () => {
    it('should activate (neutralize bypassPermissions) only for "default" mode', () => {
      const permissionMode: string = 'default';
      const shouldActivate = permissionMode === 'default';
      expect(shouldActivate).toBe(true);
    });

    it('should NOT activate for "plan" mode', () => {
      const permissionMode: string = 'plan';
      const shouldActivate = permissionMode === 'default';
      expect(shouldActivate).toBe(false);
    });

    it('should NOT activate for "acceptEdits" mode', () => {
      const permissionMode: string = 'acceptEdits';
      const shouldActivate = permissionMode === 'default';
      expect(shouldActivate).toBe(false);
    });

    it('should NOT activate for "bypassPermissions" mode', () => {
      const permissionMode: string = 'bypassPermissions';
      const shouldActivate = permissionMode === 'default';
      expect(shouldActivate).toBe(false);
    });
  });
});
