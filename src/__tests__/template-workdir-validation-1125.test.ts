/**
 * template-workdir-validation-1125.test.ts — Tests for Issue #1125.
 *
 * Security test: Template workDir must be validated at creation time
 * to prevent storing path-traversal payloads.
 *
 * The POST /v1/templates endpoint must call validateWorkDirWithConfig
 * before persisting the template, following the same pattern as:
 * - POST /v1/sessions (line 803)
 * - POST /v1/sessions/batch (line 1536)
 * - POST /v1/pipelines (line 1575)
 */

import { describe, it, expect } from 'vitest';
import { validateWorkDir, containsTraversalSegment } from '../validation.js';

describe('Issue #1125: Template workDir validation', () => {
  describe('validateWorkDir rejects path traversal payloads', () => {
    it('rejects /tmp/../etc (would escape to /etc)', async () => {
      const result = await validateWorkDir('/tmp/../etc');
      expect(typeof result).toBe('object');
      if (typeof result === 'object') {
        expect(result.code).toBe('INVALID_WORKDIR');
        expect(result.error).toMatch(/\.\./);
      }
    });

    it('rejects relative path traversal ../etc', async () => {
      const result = await validateWorkDir('../etc');
      expect(typeof result).toBe('object');
      if (typeof result === 'object') {
        expect(result.code).toBe('INVALID_WORKDIR');
      }
    });

    it('rejects deeply nested traversal /tmp/a/b/../../../../etc/shadow', async () => {
      const result = await validateWorkDir('/tmp/a/b/../../../../etc/shadow');
      expect(typeof result).toBe('object');
      if (typeof result === 'object') {
        expect(result.code).toBe('INVALID_WORKDIR');
      }
    });

    it('rejects encoded traversal /tmp/%2e%2e/etc', async () => {
      const result = await validateWorkDir('/tmp/%2e%2e/etc');
      expect(typeof result).toBe('object');
      if (typeof result === 'object') {
        expect(result.code).toBe('INVALID_WORKDIR');
      }
    });

    it('rejects mixed-separator traversal tmp\\..\\etc', async () => {
      const result = await validateWorkDir('tmp\\..\\etc');
      expect(typeof result).toBe('object');
      if (typeof result === 'object') {
        expect(result.code).toBe('INVALID_WORKDIR');
      }
    });
  });

  describe('containsTraversalSegment helper catches all forms', () => {
    it('detects literal ".." in path', () => {
      expect(containsTraversalSegment('/tmp/../etc')).toBe(true);
    });

    it('detects URL-encoded ".." (%2e%2e)', () => {
      expect(containsTraversalSegment('/tmp/%2e%2e/etc')).toBe(true);
    });

    it('detects mixed-case encoded ".." (%2E%2E)', () => {
      expect(containsTraversalSegment('/tmp/%2E%2E/etc')).toBe(true);
    });

    it('detects backslash traversal on Windows-style paths', () => {
      expect(containsTraversalSegment('tmp\\..\\etc')).toBe(true);
    });

    it('allows directory names with dots but no traversal', () => {
      expect(containsTraversalSegment('/tmp/project...name')).toBe(false);
      expect(containsTraversalSegment('/tmp/.hidden')).toBe(false);
      expect(containsTraversalSegment('/tmp/v1.2.3')).toBe(false);
    });
  });
});
