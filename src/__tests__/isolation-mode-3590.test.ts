/**
 * isolation-mode-3590.test.ts — Verify isolationMode field on SessionInfo.
 *
 * Issue #3590: Expose bgIsolation mode on SessionInfo for dashboard.
 * - isolationMode detected from CC settings or defaults to 'worktree'
 * - Field preserved in redactSession (API response)
 * - Backward compatible: sessions without field still work
 */

import { describe, it, expect } from 'vitest';
import { redactSession } from '../routes/context.js';

describe('Issue #3590 — isolationMode on SessionInfo', () => {
  describe('redactSession preserves isolationMode', () => {
    it('preserves isolationMode "none"', () => {
      const redacted = redactSession({
        id: 'test-id',
        displayName: 'test',
        isolationMode: 'none',
        hookSecret: 'secret123',
      });
      expect(redacted.isolationMode).toBe('none');
      expect(redacted.hookSecret).toBeUndefined();
    });

    it('preserves isolationMode "worktree"', () => {
      const redacted = redactSession({
        id: 'test-id',
        displayName: 'test',
        isolationMode: 'worktree',
        hookSecret: 'secret123',
      });
      expect(redacted.isolationMode).toBe('worktree');
      expect(redacted.hookSecret).toBeUndefined();
    });

    it('handles session without isolationMode (backward compat)', () => {
      const redacted = redactSession({
        id: 'test-id',
        displayName: 'test',
        hookSecret: 'secret123',
      });
      expect(redacted.isolationMode).toBeUndefined();
      expect(redacted.hookSecret).toBeUndefined();
    });

    it('preserves isolationMode alongside other fields', () => {
      const redacted = redactSession({
        id: 'test-id',
        displayName: 'test',
        status: 'running',
        model: 'claude-sonnet-4-6',
        effort: 'high',
        isolationMode: 'worktree',
        hookSecret: 'secret',
        hookSettingsFile: '/tmp/hooks.json',
      });
      expect(redacted.isolationMode).toBe('worktree');
      expect(redacted.model).toBe('claude-sonnet-4-6');
      expect(redacted.effort).toBe('high');
      expect(redacted.hookSecret).toBeUndefined();
      expect(redacted.hookSettingsFile).toBeUndefined();
    });
  });
});
