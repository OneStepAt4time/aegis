/**
 * auth/per-agent-apps.test.ts — Structure tests for per-agent App identity scripts (#4665 §B+§C).
 *
 * Verifies script structure, permission enforcement, and security properties
 * WITHOUT requiring live App credentials. Tests skip cleanly in CI where
 * scripts are absent (outside repo checkout).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const SCRIPTS_DIR = resolve(homedir(), '.openclaw/workspace/infra/github-apps');

// CI compatibility: skip all tests when infra scripts are not present
const scriptsAvailable = existsSync(SCRIPTS_DIR);

const ROLES = ['hermes', 'argus', 'hephaestus'] as const;

// ADR-0030 permission matrix
const PERMISSION_MATRIX: Record<string, string[]> = {
  hermes: ['contents:write', 'issues:write', 'pull_requests:write', 'workflows:write', 'releases:write'],
  argus: ['contents:read', 'issues:read', 'pull_requests:read', 'reviews:write'],
  hephaestus: ['contents:write', 'issues:write', 'pull_requests:write'],
};

describe.skipIf(!scriptsAvailable)('Per-agent App identity scripts (#4665 §B)', () => {
  for (const role of ROLES) {
    describe(`aegis-${role}`, () => {
      const scriptPath = resolve(SCRIPTS_DIR, `get-installation-token-${role}.sh`);

      it('token-mint script exists and is executable', () => {
        expect(existsSync(scriptPath)).toBe(true);
        const stat = statSync(scriptPath);
        expect(stat.mode & 0o111).toBeTruthy();
      });

      it('script references correct PEM file', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        expect(content).toContain(`aegis-${role}.pem`);
      });

      it('script checks PEM file mode 600', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        expect(content).toMatch(/600|permissions/);
      });

      it('script does NOT contain hardcoded App ID or installation ID', () => {
        const content = readFileSync(scriptPath, 'utf-8');
        expect(content).toMatch(/APP_ID=""/);
        expect(content).toMatch(/INSTALLATION_ID=""/);
      });

      it('script has valid bash syntax', () => {
        // execFileSync avoids shell injection — no string interpolation through shell
        execFileSync('bash', ['-n', scriptPath], { encoding: 'utf-8' });
      });
    });
  }
});

describe.skipIf(!scriptsAvailable)('manage-aegis-apps.sh permission-matrix guard (#4665 §C)', () => {
  const manageScript = resolve(SCRIPTS_DIR, 'manage-aegis-apps.sh');

  it('script exists and is executable', () => {
    expect(existsSync(manageScript)).toBe(true);
    const stat = statSync(manageScript);
    expect(stat.mode & 0o111).toBeTruthy();
  });

  it('contains the ADR-0030 permission matrix for all 3 roles', () => {
    const content = readFileSync(manageScript, 'utf-8');
    for (const [_role, perms] of Object.entries(PERMISSION_MATRIX)) {
      for (const perm of perms) {
        expect(content).toContain(perm);
      }
    }
  });

  it('enforces known-good permission matrix', () => {
    const content = readFileSync(manageScript, 'utf-8');
    expect(content).toMatch(/ALLOWED_PERMISSIONS|known-good|matrix/i);
  });

  it('check command runs and reports PEMs as pending', () => {
    const result = execFileSync(manageScript, ['check'], { encoding: 'utf-8' });
    expect(result).toContain('aegis-hermes');
    expect(result).toContain('aegis-argus');
    expect(result).toContain('aegis-hephaestus');
    expect(result).toMatch(/not registered|awaiting/i);
  });

  it('audit command runs and shows legacy fallback', () => {
    const result = execFileSync(manageScript, ['audit'], { encoding: 'utf-8' });
    expect(result).toContain('aegis-gh-agent');
    expect(result).toMatch(/LEGACY|FALLBACK/);
  });

  it('mint command rejects unknown roles', () => {
    // Expect non-zero exit for invalid role — execFileSync throws on non-zero exit
    expect(() => {
      execFileSync(manageScript, ['mint', 'unknown-role'], { encoding: 'utf-8' });
    }).toThrow();
  });
});
