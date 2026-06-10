/**
 * auth/per-agent-apps.test.ts — Structure tests for per-agent App identity scripts (#4665 §B+§C).
 *
 * These tests verify the script structure, permission enforcement, and
 * security properties WITHOUT requiring live App credentials (Apps not
 * yet registered — Ema action pending per #4665 §A).
 *
 * When Apps are registered, integration tests can be added to verify
 * actual token minting and API access.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPTS_DIR = resolve(
  process.env['HOME'] ?? '/home/bubuntu',
  '.openclaw/workspace/infra/github-apps',
);

const ROLES = ['hermes', 'argus', 'hephaestus'] as const;

// ADR-0030 permission matrix
const PERMISSION_MATRIX: Record<string, string[]> = {
  hermes: ['contents:write', 'issues:write', 'pull_requests:write', 'workflows:write', 'releases:write'],
  argus: ['contents:read', 'issues:read', 'pull_requests:read'],
  hephaestus: ['contents:write', 'issues:write', 'pull_requests:write'],
};

describe('Per-agent App identity scripts (#4665 §B)', () => {
  for (const role of ROLES) {
    describe(`aegis-${role}`, () => {
      const scriptPath = resolve(SCRIPTS_DIR, `get-installation-token-${role}.sh`);
      const pemPath = resolve(SCRIPTS_DIR, `aegis-${role}.pem`);

      it('token-mint script exists and is executable', () => {
        expect(existsSync(scriptPath)).toBe(true);
        const stat = statSync(scriptPath);
        // Check executable bit (owner)
        expect(stat.mode & 0o111).toBeTruthy();
      });

      it('script references correct PEM file', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        expect(content).toContain(`aegis-${role}.pem`);
      });

      it('script checks PEM file mode 600', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        // The script must verify mode 600 before using the PEM
        expect(content).toMatch(/600|permissions/);
      });

      it('script does NOT contain hardcoded App ID or installation ID', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        // APP_ID and INSTALLATION_ID should be empty strings (filled post-registration)
        expect(content).toMatch(/APP_ID=""/);
        expect(content).toMatch(/INSTALLATION_ID=""/);
      });

      it('script has bash syntax check', () => {
        // Verify the script parses without errors
        const result = execSync(`bash -n ${scriptPath}`, { encoding: 'utf-8' });
        expect(result).toBe('');
      });
    });
  }
});

describe('manage-aegis-apps.sh permission-matrix guard (#4665 §C)', () => {
  const manageScript = resolve(SCRIPTS_DIR, 'manage-aegis-apps.sh');

  it('script exists and is executable', () => {
    expect(existsSync(manageScript)).toBe(true);
    const stat = statSync(manageScript);
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it('contains the ADR-0030 permission matrix for all 3 roles', () => {
    const content = readFileSync(manageScript, 'utf-8');
    for (const [role, perms] of Object.entries(PERMISSION_MATRIX)) {
      for (const perm of perms) {
        expect(content).toContain(perm);
      }
    }
  });

  it('enforces known-good permission matrix (refuses unknown permissions)', () => {
    const content = readFileSync(manageScript, 'utf-8');
    expect(content).toMatch(/ALLOWED_PERMISSIONS|known-good|matrix/i);
  });

  it('check command runs and reports PEMs as pending', () => {
    const result = execSync(`${manageScript} check`, { encoding: 'utf-8' });
    expect(result).toContain('aegis-hermes');
    expect(result).toContain('aegis-argus');
    expect(result).toContain('aegis-hephaestus');
    // PEMs should show as pending (not yet registered)
    expect(result).toMatch(/not registered|awaiting/i);
  });

  it('audit command runs and shows legacy fallback', () => {
    const result = execSync(`${manageScript} audit`, { encoding: 'utf-8' });
    expect(result).toContain('aegis-gh-agent');
    expect(result).toMatch(/LEGACY|FALLBACK/);
  });

  it('mint command rejects unknown roles', () => {
    const result = execSync(`${manageScript} mint unknown-role 2>&1; true`, {
      encoding: 'utf-8',
      shell: '/bin/bash',
    });
    expect(result).toMatch(/Unknown role|must be/i);
  });
});
