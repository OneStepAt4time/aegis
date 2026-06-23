/**
 * Regression tests for scripts/devops/add-cron-timeout-overrides.sh
 *
 * Covers #4808 (Lane B of #4755). The script applies a per-provider
 * `timeoutSeconds` override to the OpenClaw config so non-trivial isolated
 * agentTurn cron payloads don't time out per-provider during the
 * sequential fallback chain.
 *
 * These tests run the actual bash script against fixture OpenClaw config
 * files in a temp directory. They verify:
 *   1. DRY-RUN mode does NOT modify the config
 *   2. APPLY=1 mode sets the timeoutSeconds on each target provider
 *   3. Idempotency: re-running with the same target leaves the config unchanged
 *   4. Skip semantics: providers already at-or-above target are skipped
 *   5. Error path: missing jq, missing config, invalid timeout value
 *
 * Requires `bash` and `jq` on PATH (same as the script itself).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCRIPT_PATH = join(REPO_ROOT, 'scripts/devops/add-cron-timeout-overrides.sh');

interface OpenClawConfigFixture {
  models: {
    mode: string;
    providers: Record<string, Record<string, unknown>>;
  };
}

function makeFixture(
  overrides: Partial<Record<string, Record<string, unknown>>> = {},
): OpenClawConfigFixture {
  return {
    models: {
      mode: 'merge',
      providers: {
        'minimax-portal': { baseUrl: 'https://example.test' },
        kimi: { baseUrl: 'https://example.test' },
        zai: { baseUrl: 'https://example.test' },
        'unrelated-provider': { baseUrl: 'https://example.test' },
        ...overrides,
      },
    },
  };
}

function runScript(params: {
  configPath: string;
  env?: Record<string, string>;
  apply?: boolean;
}): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = {
    ...process.env,
    OPENCLAW_CONFIG: params.configPath,
    ...(params.apply ? { APPLY: '1' } : {}),
    ...(params.env ?? {}),
  };
  try {
    const stdout = execFileSync('bash', [SCRIPT_PATH], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      status: e.status ?? 1,
    };
  }
}

describe('add-cron-timeout-overrides.sh', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'cron-timeout-shim-test-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeFixture(config: OpenClawConfigFixture): string {
    const path = join(workDir, 'openclaw.json');
    writeFileSync(path, JSON.stringify(config, null, 2));
    return path;
  }

  function readConfig(path: string): OpenClawConfigFixture {
    return JSON.parse(readFileSync(path, 'utf8')) as OpenClawConfigFixture;
  }

  it('DRY-RUN mode does not modify the config', () => {
    const configPath = writeFixture(makeFixture());

    const { stdout, status } = runScript({ configPath });

    expect(status).toBe(0);
    expect(stdout).toContain('DRY-RUN');

    const config = readConfig(configPath);
    expect(config.models.providers['minimax-portal'].timeoutSeconds).toBeUndefined();
    expect(config.models.providers.kimi.timeoutSeconds).toBeUndefined();
    expect(config.models.providers.zai.timeoutSeconds).toBeUndefined();
  });

  it('APPLY=1 sets timeoutSeconds on each target provider', () => {
    const configPath = writeFixture(makeFixture());

    const { stdout, status } = runScript({ configPath, apply: true });

    expect(status).toBe(0);
    expect(stdout).toContain('APPLY');

    const config = readConfig(configPath);
    expect(config.models.providers['minimax-portal'].timeoutSeconds).toBe(600);
    expect(config.models.providers.kimi.timeoutSeconds).toBe(600);
    expect(config.models.providers.zai.timeoutSeconds).toBe(600);
  });

  it('APPLY=1 with TIMEOUT_SECONDS uses the override value', () => {
    const configPath = writeFixture(makeFixture());

    const { status } = runScript({
      configPath,
      apply: true,
      env: { TIMEOUT_SECONDS: '900' },
    });

    expect(status).toBe(0);
    const config = readConfig(configPath);
    expect(config.models.providers['minimax-portal'].timeoutSeconds).toBe(900);
    expect(config.models.providers.zai.timeoutSeconds).toBe(900);
  });

  it('idempotent: re-running leaves the config unchanged after first apply', () => {
    const configPath = writeFixture(makeFixture());

    const first = runScript({ configPath, apply: true });
    expect(first.status).toBe(0);

    const afterFirst = readFileSync(configPath, 'utf8');

    const second = runScript({ configPath, apply: true });
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('Already at or above target (skipped): 3');

    const afterSecond = readFileSync(configPath, 'utf8');
    expect(afterSecond).toBe(afterFirst);
  });

  it('skips providers already at or above the target timeout', () => {
    const configPath = writeFixture(
      makeFixture({
        'minimax-portal': { timeoutSeconds: 900 },
      }),
    );

    const { stdout, status } = runScript({ configPath, apply: true });

    expect(status).toBe(0);
    const config = readConfig(configPath);
    expect(config.models.providers['minimax-portal'].timeoutSeconds).toBe(900);
    expect(config.models.providers.kimi.timeoutSeconds).toBe(600);
    expect(config.models.providers.zai.timeoutSeconds).toBe(600);

    expect(stdout).toContain('already has timeoutSeconds=900');
  });

  it('does not touch providers outside TARGET_PROVIDERS', () => {
    const configPath = writeFixture(makeFixture());

    const { status } = runScript({ configPath, apply: true });

    expect(status).toBe(0);
    const config = readConfig(configPath);
    expect(config.models.providers['unrelated-provider'].timeoutSeconds).toBeUndefined();
  });

  it('TARGET_PROVIDERS env var scopes the patch', () => {
    const configPath = writeFixture(makeFixture());

    const { status } = runScript({
      configPath,
      apply: true,
      env: { TARGET_PROVIDERS: 'zai' },
    });

    expect(status).toBe(0);
    const config = readConfig(configPath);
    expect(config.models.providers.zai.timeoutSeconds).toBe(600);
    expect(config.models.providers['minimax-portal'].timeoutSeconds).toBeUndefined();
    expect(config.models.providers.kimi.timeoutSeconds).toBeUndefined();
  });

  it('exits non-zero when config file is missing', () => {
    const missing = join(workDir, 'does-not-exist.json');
    const { status, stderr } = runScript({ configPath: missing });

    expect(status).not.toBe(0);
    expect(stderr).toContain('not found');
  });

  it('exits non-zero when TIMEOUT_SECONDS is invalid', () => {
    const configPath = writeFixture(makeFixture());

    const { status, stderr } = runScript({
      configPath,
      apply: true,
      env: { TIMEOUT_SECONDS: 'not-a-number' },
    });

    expect(status).not.toBe(0);
    expect(stderr).toContain('TIMEOUT_SECONDS must be a positive integer');
  });

  it('exits non-zero when config lacks models.providers object', () => {
    const bogus = join(workDir, 'bogus.json');
    writeFileSync(bogus, JSON.stringify({ meta: { foo: 'bar' } }));

    const { status, stderr } = runScript({ configPath: bogus });

    expect(status).not.toBe(0);
    expect(stderr).toContain('does not have a models.providers object');
  });

  it('reports missing target provider in summary without aborting other updates', () => {
    const fixture: OpenClawConfigFixture = {
      models: {
        mode: 'merge',
        providers: {
          'minimax-portal': { baseUrl: 'https://example.test' },
          zai: { baseUrl: 'https://example.test' },
        },
      },
    };
    const configPath = writeFixture(fixture);

    const { stdout, status } = runScript({ configPath, apply: true });

    expect(status).toBe(0);
    // The script uses an em-dash and 'not found' marker; assert on the stable parts.
    expect(stdout).toMatch(/kimi\s+\S+\s+not found in models\.providers/);
    expect(stdout).toContain('Provider not found in config: 1');

    const config = readConfig(configPath);
    expect(config.models.providers['minimax-portal'].timeoutSeconds).toBe(600);
    expect(config.models.providers.zai.timeoutSeconds).toBe(600);
  });
});
