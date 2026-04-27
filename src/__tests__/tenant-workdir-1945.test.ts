/**
 * tenant-workdir-1945.test.ts — Tests for Issue #1945: tenant workdir namespacing.
 *
 * Covers:
 *  - Master token (no tenantId) bypasses all restrictions
 *  - Tenant with configured root: path under root is allowed
 *  - Cross-tenant path rejection (path outside root)
 *  - Path traversal attempts (..) are rejected
 *  - Tenant without config falls back to unrestricted
 *  - allowedPaths restricts subdirectories within root
 */

import { describe, it, expect } from 'vitest';
import { validateWorkdirPath } from '../tenant-workdir.js';

describe('Tenant workdir validation (Issue #1945)', () => {
  describe('master token bypass', () => {
    it('allows any path when tenantId is undefined', () => {
      const result = validateWorkdirPath(undefined, '/any/random/path', {
        tenantWorkdirs: {},
      });
      expect(result.allowed).toBe(true);
      expect(result.resolvedPath).toBe('/any/random/path');
    });

    it('allows any path when tenantId is undefined even with tenant config present', () => {
      const result = validateWorkdirPath(undefined, '/etc/passwd', {
        tenantWorkdirs: {
          tenantA: { root: '/tenants/a' },
        },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('tenant without config', () => {
    it('allows any path for tenant with no workdir config (backward compat)', () => {
      const result = validateWorkdirPath('unknown-tenant', '/any/path', {
        tenantWorkdirs: {},
      });
      expect(result.allowed).toBe(true);
    });

    it('allows any path for tenant with no workdir config when other tenants have config', () => {
      const result = validateWorkdirPath('tenantB', '/any/path', {
        tenantWorkdirs: {
          tenantA: { root: '/tenants/a' },
        },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('tenant with configured root', () => {
    const config = {
      tenantWorkdirs: {
        tenantA: { root: '/tenants/a' },
        tenantB: { root: '/tenants/b' },
      },
    };

    it('allows path exactly at tenant root', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a', config);
      expect(result.allowed).toBe(true);
      expect(result.resolvedPath).toBe('/tenants/a');
    });

    it('allows path under tenant root', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a/projects/my-app', config);
      expect(result.allowed).toBe(true);
    });

    it('rejects path in another tenant root', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/b/projects', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside tenant');
      expect(result.reason).toContain('tenantA');
    });

    it('rejects path completely outside any tenant root', () => {
      const result = validateWorkdirPath('tenantA', '/etc/secrets', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('outside tenant');
    });

    it('rejects path traversal attempt with ..', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a/../../../etc/secrets', config);
      expect(result.allowed).toBe(false);
    });
  });

  describe('allowedPaths restriction', () => {
    const config = {
      tenantWorkdirs: {
        tenantA: {
          root: '/tenants/a',
          allowedPaths: ['projects', 'workspace'],
        },
      },
    };

    it('allows path within an allowed subdirectory', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a/projects/my-app', config);
      expect(result.allowed).toBe(true);
    });

    it('allows path within workspace subdirectory', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a/workspace/repo', config);
      expect(result.allowed).toBe(true);
    });

    it('rejects path under root but not in any allowedPaths', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a/forbidden-dir', config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in tenant');
    });

    it('rejects path at root itself when allowedPaths is set', () => {
      const result = validateWorkdirPath('tenantA', '/tenants/a', config);
      expect(result.allowed).toBe(false);
    });
  });

  describe('path normalization', () => {
    const config = {
      tenantWorkdirs: {
        tenantA: { root: '/tenants/a' },
      },
    };

    it('normalizes relative paths to absolute', () => {
      const result = validateWorkdirPath('tenantA', 'relative/path', config);
      // resolve('relative/path') becomes process.cwd() + '/relative/path'
      // This should be rejected since cwd is likely not under /tenants/a
      expect(result.allowed).toBe(false);
    });

    it('handles trailing slashes in root', () => {
      const trailingConfig = {
        tenantWorkdirs: {
          tenantA: { root: '/tenants/a/' },
        },
      };
      const result = validateWorkdirPath('tenantA', '/tenants/a/projects', trailingConfig);
      expect(result.allowed).toBe(true);
    });
  });
});
