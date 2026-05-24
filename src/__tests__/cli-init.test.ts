import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock("../utils/claude-installer.js", () => ({
  ensureClaudeInstalled: vi.fn(),
  checkClaudeInstalled: vi.fn(() => Promise.resolve({ installed: true })),
  installClaudeCli: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../utils/detect-free-port.js', () => ({
  detectFreePort: vi.fn(async () => 9100),
  isPortAvailable: vi.fn(async () => true),
}));

vi.mock('../utils/detect-running.js', () => ({
  detectRunningInstance: vi.fn(async () => null),
}));

vi.mock('open', () => ({
  default: vi.fn(async () => {}),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => ({ unref: vi.fn(), pid: 12345 })),
  };
});
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
    const result = await runInit(['init', '--no-start'], [
      '',               // name (empty)
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

  it('supports non-interactive --yes bootstrap (zero-config on localhost)', async () => {
    const result = await runInit(['init', '--yes', '--no-start']);
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
    // #3496: localhost defaults to zero-config — no token created
    expect(config.clientAuthToken).toBeFalsy();
    expect(config.defaultSessionEnv).toBeUndefined();
    expect(result.stdout).toContain('zero-config');
  });

  it('does not overwrite an existing config without confirmation', async () => {
    const firstRun = await runInit(['init', '--yes', '--no-start']);
    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const initialConfig = readFileSync(configPath, 'utf-8');

    expect(firstRun.code).toBe(0);

    const secondRun = await runInit(['init', '--no-start'], [
      '',               // name (empty)
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

describe('ag init --model flag', () => {
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    projectDir = mkdtempSync(join(tmpdir(), 'aegis-cli-init-model-'));
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

  it('sets default model via --model flag in non-interactive mode', async () => {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(['init', '--yes', '--no-start', '--model', 'claude-opus-4'], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());

    const code = await runPromise;
    expect(code).toBe(0);

    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      defaultSessionEnv?: Record<string, string>;
    };
    expect(config.defaultSessionEnv?.ANTHROPIC_DEFAULT_MODEL).toBe('claude-opus-4');
  });

  it('scaffolds identity.md with --name flag', async () => {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(['init', '--yes', '--no-start', '--name', 'Ada'], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());

    const code = await runPromise;
    expect(code).toBe(0);

    const identityPath = join(projectDir, '.aegis', 'identity.md');
    expect(existsSync(identityPath)).toBe(true);

    const content = readFileSync(identityPath, 'utf-8');
    expect(content).toContain('Ada');
    expect(content).toContain('# Identity');
    expect(stdout.text()).toContain('identity file');
  });

  it('scaffolds identity.md from interactive name prompt', async () => {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(['init', '--no-start'], { stdin, stdout, stderr });
    setImmediate(() => {
      stdin.end([
        'Grace',           // name
        'y',               // create token
        'http://127.0.0.1:9200',
        'n',               // no BYO-LLM
        'y',               // dashboard
      ].join('\n'));
    });

    const code = await runPromise;
    expect(code).toBe(0);

    const identityPath = join(projectDir, '.aegis', 'identity.md');
    expect(existsSync(identityPath)).toBe(true);

    const content = readFileSync(identityPath, 'utf-8');
    expect(content).toContain('Grace');
  });

  it('does not scaffold identity.md when name is empty', async () => {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());

    const code = await runPromise;
    expect(code).toBe(0);

    const identityPath = join(projectDir, '.aegis', 'identity.md');
    expect(existsSync(identityPath)).toBe(false);
  });

  it('combines --name and --model flags', async () => {
    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();

    const runPromise = runCli(['init', '--yes', '--no-start', '--name', 'Turing', '--model', 'gpt-5'], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());

    const code = await runPromise;
    expect(code).toBe(0);

    // Identity file
    const identityPath = join(projectDir, '.aegis', 'identity.md');
    expect(existsSync(identityPath)).toBe(true);
    expect(readFileSync(identityPath, 'utf-8')).toContain('Turing');

    // Config with model
    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
      defaultSessionEnv?: Record<string, string>;
    };
    expect(config.defaultSessionEnv?.ANTHROPIC_DEFAULT_MODEL).toBe('gpt-5');
  });

  it('replaces existing admin key on --force (issue #3351)', async () => {
    // First init with --force creates a key (even on localhost)
    let stdin = new PassThrough();
    let stdout = new CaptureStream();
    let stderr = new CaptureStream();
    let runPromise = runCli(['init', '--yes', '--no-start', '--force'], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());
    let code = await runPromise;
    expect(code).toBe(0);

    // Read first token
    const configPath = join(projectDir, '.aegis', 'config.yaml');
    const config1 = parseYaml(readFileSync(configPath, 'utf-8')) as { clientAuthToken: string };
    const token1 = config1.clientAuthToken;
    expect(token1).toBeTruthy();

    // Second init with --force should replace the key, not crash
    stdin = new PassThrough();
    stdout = new CaptureStream();
    stderr = new CaptureStream();
    runPromise = runCli(['init', '--yes', '--no-start', '--force'], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());
    code = await runPromise;
    expect(code).toBe(0);

    // Verify new token is different
    const config2 = parseYaml(readFileSync(configPath, 'utf-8')) as { clientAuthToken: string };
    const token2 = config2.clientAuthToken;
    expect(token2).toBeTruthy();
    expect(token2).not.toBe(token1);
  });

  describe('#3496 — zero-config localhost', () => {
    it('skips token creation on localhost with --yes (zero-config)', async () => {
      process.env.AEGIS_HOST = '127.0.0.1';
      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      const out = stdout.text();
      // Should show zero-config message
      expect(out).toContain('zero-config');
      // Should NOT have created a token
      const configPath = join(projectDir, '.aegis', 'config.yaml');
      const config = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      expect(config.clientAuthToken).toBeFalsy();
      // No auth-token file
      const authTokenPath = join(
        process.env.HOME || '/tmp',
        '.aegis',
        'auth-token',
      );
      // (auth-token file may exist from other tests, so we don't assert its absence globally)
    });

    it('creates token on public host with --yes', async () => {
      process.env.AEGIS_HOST = '0.0.0.0';
      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      const configPath = join(projectDir, '.aegis', 'config.yaml');
      const config = parseYaml(readFileSync(configPath, 'utf-8')) as { clientAuthToken: string };
      expect(config.clientAuthToken).toBeTruthy();
    });

    it('creates token on localhost with --force (explicit override)', async () => {
      process.env.AEGIS_HOST = '127.0.0.1';
      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start', '--force'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      const configPath = join(projectDir, '.aegis', 'config.yaml');
      const config = parseYaml(readFileSync(configPath, 'utf-8')) as { clientAuthToken: string };
      // --force should still create a token even on localhost
      expect(config.clientAuthToken).toBeTruthy();
    });

    it('skips token creation on localhost with hostname "localhost"', async () => {
      process.env.AEGIS_HOST = 'localhost';
      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      const configPath = join(projectDir, '.aegis', 'config.yaml');
      const config = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      expect(config.clientAuthToken).toBeFalsy();
    });

    it('skips token creation on IPv6 localhost ::1', async () => {
      process.env.AEGIS_HOST = '::1';
      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      const configPath = join(projectDir, '.aegis', 'config.yaml');
      const config = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
      expect(config.clientAuthToken).toBeFalsy();
    });
  });

  describe('#3888 — project-local stateDir for new configs', () => {
    it('creates stateDir next to new config when no AEGIS_STATE_DIR env', async () => {
      // Remove AEGIS_STATE_DIR so the fix activates
      delete process.env.AEGIS_STATE_DIR;
      process.env.AEGIS_HOST = '0.0.0.0'; // non-localhost to trigger token creation

      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start', '--force'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      // Config at project-local .aegis/config.yaml
      const configPath = join(projectDir, '.aegis', 'config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // State dir should be project-local (.aegis/), not HOME
      const config = parseYaml(readFileSync(configPath, 'utf-8')) as {
        stateDir?: string;
        clientAuthToken?: string;
      };

      // stateDir should be set to the .aegis/ directory under project
      expect(config.stateDir).toBe(join(projectDir, '.aegis'));

      // --force creates a new token, so keys.json should be in project-local .aegis/
      const keysPath = join(projectDir, '.aegis', 'keys.json');
      expect(existsSync(keysPath)).toBe(true);

      // Verify the state directory message shows project-local path
      expect(stdout.text()).toContain(join(projectDir, '.aegis'));
    });

    it('respects AEGIS_STATE_DIR env even for new configs', async () => {
      // Set explicit state dir
      process.env.AEGIS_STATE_DIR = stateDir;
      process.env.AEGIS_HOST = '0.0.0.0';

      const stdin = new PassThrough();
      const stdout = new CaptureStream();
      const stderr = new CaptureStream();
      const runPromise = runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });
      setImmediate(() => stdin.end());
      const code = await runPromise;
      expect(code).toBe(0);

      // Keys should be in the env-overridden state dir
      const keysPath = join(stateDir, 'keys.json');
      expect(existsSync(keysPath)).toBe(true);
    });
  });
});
// Issue #4100: --start server flow tests (mocks already set up at top of file)
describe('ag init --start (#4100)', () => {
  let projectDir: string;
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let stateDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    projectDir = mkdtempSync(join(tmpdir(), 'aegis-start-init-'));
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

  it('re-run detects already running instance (exit code 2)', async () => {
    // Simulate Aegis already running: detectRunningInstance returns URL
    const { detectRunningInstance } = await import('../utils/detect-running.js');
    (detectRunningInstance as ReturnType<typeof vi.fn>).mockResolvedValueOnce('http://127.0.0.1:9100');

    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    setImmediate(() => stdin.end());

    const code = await runCli(['init', '--yes', '--start'], { stdin, stdout, stderr });

    // Should exit with code 2 (already running) and print the URL
    expect(code).toBe(2);
    expect(stdout.text()).toContain('already running');
    expect(stdout.text()).toContain('http://127.0.0.1:9100');
  });

  it('--no-start does not call spawn', async () => {
    const { spawn } = await import('node:child_process');
    (spawn as ReturnType<typeof vi.fn>).mockClear();

    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    setImmediate(() => stdin.end());

    await runCli(['init', '--yes', '--no-start'], { stdin, stdout, stderr });

    expect(spawn).not.toHaveBeenCalled();
  });

  it('detectFreePort mock returns 9100', async () => {
    const { detectFreePort } = await import('../utils/detect-free-port.js');
    const port = await detectFreePort();
    expect(port).toBe(9100);
  });

  it('detectRunningInstance mock returns null (no server)', async () => {
    const { detectRunningInstance } = await import('../utils/detect-running.js');
    const result = await detectRunningInstance(9100);
    expect(result).toBeNull();
  });

  it('re-run with --no-open skips browser but still detects running', async () => {
    const { detectRunningInstance } = await import('../utils/detect-running.js');
    (detectRunningInstance as ReturnType<typeof vi.fn>).mockResolvedValueOnce('http://127.0.0.1:9100');

    const openModule = await import('open');
    (openModule.default as ReturnType<typeof vi.fn>).mockClear();

    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    setImmediate(() => stdin.end());

    const code = await runCli(['init', '--yes', '--start', '--no-open'], { stdin, stdout, stderr });

    expect(code).toBe(2);
    expect(openModule.default).not.toHaveBeenCalled();
  });
});
