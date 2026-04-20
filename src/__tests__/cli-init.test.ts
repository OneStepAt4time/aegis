import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { runCli } from '../cli.js';

class CaptureStream extends Writable {
  private chunks: string[] = [];

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

describe('ag init', () => {
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    projectDir = mkdtempSync(join(tmpdir(), 'aegis-cli-init-'));
    stateDir = join(projectDir, 'state');
    process.chdir(projectDir);

    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AEGIS_') || key.startsWith('MANUS_')) {
        delete process.env[key];
      }
    }

    process.env.AEGIS_STATE_DIR = stateDir;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(projectDir, { recursive: true, force: true });
  });

  async function runInit(argv: string[], answers?: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(argv, { stdin, stdout, stderr });
    setImmediate(() => {
      if (answers !== undefined) {
        stdin.end(`${answers}\n`);
      } else {
        stdin.end();
      }
    });

    const code = await runPromise;
    return { code, stdout: stdout.text(), stderr: stderr.text() };
  }

  it('bootstraps .aegis/config.yaml from interactive answers', async () => {
    const result = await runInit(['init'], [
      'y',
      'http://127.0.0.1:9200',
      'y',
      'https://openrouter.example/api/anthropic',
      'test-byo-token',
      'claude-sonnet-4',
      '',
      '25000',
      'n',
    ].join('\n'));

    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const keysPath = join(stateDir, 'keys.json');

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(existsSync(configPath)).toBe(true);
    expect(existsSync(keysPath)).toBe(true);

    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      baseUrl?: string;
      clientAuthToken?: string;
      dashboardEnabled?: boolean;
      defaultSessionEnv?: Record<string, string>;
    };
    expect(config.baseUrl).toBe('http://127.0.0.1:9200');
    expect(config.dashboardEnabled).toBe(false);
    expect(config.clientAuthToken?.startsWith('aegis_')).toBe(true);
    expect(config.defaultSessionEnv).toMatchObject({
      ANTHROPIC_BASE_URL: 'https://openrouter.example/api/anthropic',
      ANTHROPIC_AUTH_TOKEN: 'test-byo-token',
      ANTHROPIC_DEFAULT_MODEL: 'claude-sonnet-4',
      API_TIMEOUT_MS: '25000',
    });

    const keyStore = JSON.parse(readFileSync(keysPath, 'utf-8')) as {
      keys: Array<{ name: string; role?: string }>;
    };
    expect(keyStore.keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ag-init-admin', role: 'admin' }),
      ]),
    );

    expect(result.stdout).toContain('Next steps:');
    expect(result.stdout).toContain('Dashboard:  disabled in config');
    expect(result.stdout).toContain('Session:    ag create "Describe your first task" --cwd .');
    expect(result.stdout).toContain(config.clientAuthToken!);
  });

  it('supports non-interactive --yes bootstrap', async () => {
    const result = await runInit(['init', '--yes']);
    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      baseUrl?: string;
      clientAuthToken?: string;
      dashboardEnabled?: boolean;
      defaultSessionEnv?: Record<string, string>;
    };

    expect(result.code).toBe(0);
    expect(config.baseUrl).toBe('http://127.0.0.1:9100');
    expect(config.dashboardEnabled).toBe(true);
    expect(config.clientAuthToken?.startsWith('aegis_')).toBe(true);
    expect(config.defaultSessionEnv).toBeUndefined();
    expect(result.stdout).toContain('Created admin API token');
  });

  it('does not overwrite an existing config without confirmation', async () => {
    const firstRun = await runInit(['init', '--yes']);
    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const initialConfig = readFileSync(configPath, 'utf-8');

    expect(firstRun.code).toBe(0);

    const secondRun = await runInit(['init'], [
      'n',
      'http://127.0.0.1:9300',
      'n',
      'y',
      'n',
    ].join('\n'));

    expect(secondRun.code).toBe(0);
    expect(readFileSync(configPath, 'utf-8')).toBe(initialConfig);
    expect(secondRun.stdout).toContain('Using existing');
  });
});
