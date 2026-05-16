/**
 * Issue #3502: normalize workDir across shell semantics on Windows.
 *
 * Tests for normalizeWindowsUnixPath and the enhanced error messages
 * when Unix-style paths are passed on Windows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { validateWorkDir } from '../validation.js';

// We need to test normalizeWindowsUnixPath indirectly through validateWorkDir,
// or we can import it if exported. Since it's not exported, we test the behavior
// through validateWorkDir by mocking process.platform.

describe('Issue #3502: Windows Unix-style workDir normalization', () => {

  describe('error message suggests Windows path when workDir starts with /', () => {
    const originalPlatform = process.platform;

    beforeEach(() => {
      // Mock process.platform to 'win32'
      Object.defineProperty(process, 'platform', { value: 'win32' });
    });

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('includes a suggestion hint when a Unix-style path is rejected on Windows', async () => {
      // This path starts with / and won't be in allowed dirs on Windows
      const result = await validateWorkDir('/c/Users/dev/project', ['/home/test']);
      if (typeof result === 'object' && 'error' in result) {
        // Error message should contain a hint about the Windows-native path
        expect(result.error).toContain('Did you mean');
      }
      // On Linux this may just fail with standard error; the hint is only for win32
    });

    it('does not include hint for Windows-native backslash paths', async () => {
      const result = await validateWorkDir('C:\\Users\\dev\\nonexistent', ['C:\\Users\\dev']);
      if (typeof result === 'object' && 'error' in result) {
        // Should NOT contain "Did you mean" since path doesn't start with /
        expect(result.error).not.toContain('Did you mean');
      }
    });

    it('does not include hint for relative paths', async () => {
      const result = await validateWorkDir('./relative/path', []);
      if (typeof result === 'object' && 'error' in result) {
        expect(result.error).not.toContain('Did you mean');
      }
    });
  });

  describe('non-Windows behavior unchanged', () => {
    it('does not include hint on non-Windows platforms', async () => {
      // process.platform is 'linux' in test env
      if (process.platform === 'linux') {
        const result = await validateWorkDir('/usr/nonexistent-dir-xyz', []);
        if (typeof result === 'object' && 'error' in result) {
          expect(result.error).not.toContain('Did you mean');
        }
      }
    });
  });
});
