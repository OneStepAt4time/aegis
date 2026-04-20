// aegis:allow-credential-scan
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const {
  ALLOW_CREDENTIAL_SCAN_MARKER,
  scanContentForCredentials,
  scanTrackedFilesForCredentials,
} = require('../../scripts/hygiene-check.cjs') as {
  ALLOW_CREDENTIAL_SCAN_MARKER: string;
  scanContentForCredentials: (filePath: string, content: string) => string[];
  scanTrackedFilesForCredentials: (rootDir?: string) => string[];
};

function initTempRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), 'aegis-hygiene-1905-'));
  execFileSync('git', ['init', '-q'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Aegis Test'], { cwd: repoDir });
  writeFileSync(join(repoDir, 'SECURITY.md'), '# security\n');
  execFileSync('git', ['add', 'SECURITY.md'], { cwd: repoDir });
  return repoDir;
}

describe('hygiene-check credential scan (Issue #1905)', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects an Anthropic auth token assignment', () => {
    const findings = scanContentForCredentials(
      'config.json',
      '{"ANTHROPIC_AUTH_TOKEN":"319875494edc4cb39dd7d79b14e262a8.AfHVUkl0vrDrlLeH"}',
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('Anthropic credential assignment');
  });

  it('ignores placeholders and env substitutions', () => {
    const findings = scanContentForCredentials(
      'docs.md',
      [
        'Authorization: Bearer <token>',
        'Authorization: Bearer $AEGIS_AUTH_TOKEN',
        'ANTHROPIC_AUTH_TOKEN: "sk-test-123"',
      ].join('\n'),
    );

    expect(findings).toEqual([]);
  });

  it('skips files with the explicit allow marker', () => {
    const findings = scanContentForCredentials(
      'fixture.ts',
      `// ${ALLOW_CREDENTIAL_SCAN_MARKER}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz12345`,
    );

    expect(findings).toEqual([]);
  });

  it('detects credential-like content in tracked files only', () => {
    const repoDir = initTempRepo();
    tempDirs.push(repoDir);

    writeFileSync(
      join(repoDir, 'tracked.txt'),
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz12345\n',
    );
    writeFileSync(
      join(repoDir, 'untracked.txt'),
      '{"ANTHROPIC_AUTH_TOKEN":"319875494edc4cb39dd7d79b14e262a8.AfHVUkl0vrDrlLeH"}\n',
    );
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repoDir });

    const findings = scanTrackedFilesForCredentials(repoDir);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('tracked.txt:1');
  });

  it('detects AWS access key ids in tracked files', () => {
    const repoDir = initTempRepo();
    tempDirs.push(repoDir);

    writeFileSync(join(repoDir, 'keys.env'), 'AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF\n');
    execFileSync('git', ['add', 'keys.env'], { cwd: repoDir });

    const findings = scanTrackedFilesForCredentials(repoDir);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('AWS access key id');
  });

  describe('ANTHROPIC_BASE_URL value detection', () => {
    it('detects ANTHROPIC_BASE_URL with embedded credentials', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=https://user:sk-ant-api03-abc123@api.anthropic.com/v1',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Anthropic base URL with embedded credentials or internal host');
    });

    it('detects ANTHROPIC_BASE_URL with internal IP (10.x)', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=http://10.0.8.42:8080/v1',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Anthropic base URL with embedded credentials or internal host');
    });

    it('detects ANTHROPIC_BASE_URL with internal IP (192.168.x)', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=http://192.168.1.100:9000/v1',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Anthropic base URL with embedded credentials or internal host');
    });

    it('detects ANTHROPIC_BASE_URL with localhost', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=http://localhost:8080/v1',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Anthropic base URL with embedded credentials or internal host');
    });

    it('detects ANTHROPIC_BASE_URL with internal hostname', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=http://ai-internal.internal/v1',
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('Anthropic base URL with embedded credentials or internal host');
    });

    it('ignores ANTHROPIC_BASE_URL pointing to public Anthropic API', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=https://api.anthropic.com/v1',
      );

      expect(findings).toEqual([]);
    });

    it('ignores ANTHROPIC_BASE_URL with env var substitution', () => {
      const findings = scanContentForCredentials(
        'config.env',
        'ANTHROPIC_BASE_URL=$AEGIS_BASE_URL',
      );

      expect(findings).toEqual([]);
    });

    it('ignores ANTHROPIC_BASE_URL placeholder values', () => {
      const findings = scanContentForCredentials(
        'docs.md',
        [
          'ANTHROPIC_BASE_URL=https://api.anthropic.com/v1  # your endpoint',
          'ANTHROPIC_BASE_URL: example.anthropic.com',
          'ANTHROPIC_BASE_URL: <your-internal-endpoint>',
        ].join('\n'),
      );

      expect(findings).toEqual([]);
    });
  });
});