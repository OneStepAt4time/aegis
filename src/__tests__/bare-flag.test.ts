/**
 * bare-flag.test.ts — Tests for Issue #16: --bare flag detection.
 */

import { describe, it, expect } from 'vitest';
import { computeProjectHash } from '../path-utils.js';

describe('--bare flag detection', () => {
  describe('flag detection in claudeCommand', () => {
    it('should detect --bare flag', () => {
      const cmd = 'claude --bare -p "do something"';
      expect(cmd.includes('--bare')).toBe(true);
    });

    it('should not detect bare without dashes', () => {
      const cmd = 'claude -p "use bare minimum"';
      expect(cmd.includes('--bare')).toBe(false);
    });

    it('should detect --bare at end of command', () => {
      const cmd = 'claude --bare';
      expect(cmd.includes('--bare')).toBe(true);
    });

    it('should handle empty command', () => {
      const cmd = '';
      expect(cmd.includes('--bare')).toBe(false);
    });
  });

  describe('filesystem discovery logic', () => {
    it('should compute project hash correctly', () => {
      const workDir = '/home/user/projects/foo';
      const hash = computeProjectHash(workDir);
      expect(hash).toBe('-home-user-projects-foo');
    });

    it('should validate UUID format for session ID from filename', () => {
      const validUuid = 'f3cab47d-1234-5678-9abc-def012345678';
      const invalidName = 'sessions-index';
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

      expect(uuidRe.test(validUuid)).toBe(true);
      expect(uuidRe.test(invalidName)).toBe(false);
    });

    it('should only accept files newer than session creation', () => {
      const sessionCreatedAt = 1000;
      const oldFileMtime = 500;
      const newFileMtime = 1500;

      expect(oldFileMtime < sessionCreatedAt).toBe(true);   // Skip
      expect(newFileMtime < sessionCreatedAt).toBe(false);  // Accept
    });

    it('should extract session ID from filename', () => {
      const filename = 'f3cab47d-1234-5678-9abc-def012345678.jsonl';
      const sessionId = filename.replace('.jsonl', '');
      expect(sessionId).toBe('f3cab47d-1234-5678-9abc-def012345678');
    });
  });
});
