import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const {
  execFileMock,
  execFileBridge,
  secureFilePermissionsMock,
  detectUIStateMock,
} = vi.hoisted(() => {
  const execMock = vi.fn();
  const bridge: any = (...args: unknown[]) => execMock(...args);
  bridge[Symbol.for('nodejs.util.promisify.custom')] = (
    file: string,
    args: readonly string[],
    options: Record<string, unknown>,
  ) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execMock(
      file,
      args,
      options,
      (error: Error | null, stdoutData?: string, stderrData?: string) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: stdoutData ?? '', stderr: stderrData ?? '' });
      },
    );
  });

  return {
    execFileMock: execMock,
    execFileBridge: bridge,
    secureFilePermissionsMock: vi.fn(),
    detectUIStateMock: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  execFile: execFileBridge,
}));

vi.mock('../file-utils.js', () => ({
  secureFilePermissions: secureFilePermissionsMock,
}));

vi.mock('../terminal-parser.js', () => ({
  detectUIState: detectUIStateMock,
}));

import { TmuxManager, TmuxTimeoutError } from '../tmux.js';

let sandboxDir = '';

function setupSandbox(testName: string): string {
  const slug = testName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const dir = join(process.cwd(), '.tmux-core-1616', `${slug}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  sandboxDir = dir;
  return dir;
}

async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original });
  }
}

function installExecSuccess(stdout: string = '', stderr: string = ''): void {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null, stdoutData: string, stderrData: string) => void,
    ) => callback(null, stdout, stderr),
  );
}

describe('Issue #1616 tmux.ts core coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installExecSuccess();
    secureFilePermissionsMock.mockResolvedValue(undefined);
    detectUIStateMock.mockImplementation((text: string) => {
      if (text.includes('WORKING')) return 'working';
      if (text.includes('PERMISSION')) return 'permission_prompt';
      if (text.includes('ASK')) return 'ask_question';
      if (text.includes('IDLE')) return 'idle';
      return 'unknown';
    });
  });

  afterEach(() => {
    if (sandboxDir) {
      rmSync(sandboxDir, { recursive: true, force: true });
      sandboxDir = '';
    }
  });

  it('wraps tmux command execution and timeout conversion', async () => {
    const tmux = new TmuxManager('cov-session', 'cov-socket');

    installExecSuccess(' output \n');
    await expect((tmux as unknown as { tmuxInternal: (...args: string[]) => Promise<string> })
      .tmuxInternal('list-sessions')).resolves.toBe('output');

    const killedError = Object.assign(new Error('killed'), { killed: true });
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdoutData: string, stderrData: string) => void,
      ) => callback(killedError, '', ''),
    );
    await expect((tmux as unknown as { tmuxInternal: (...args: string[]) => Promise<string> })
      .tmuxInternal('list-sessions')).rejects.toBeInstanceOf(TmuxTimeoutError);
  });

  it('handles ensureSession/listWindows/windowExists/listPanePid/getWindowHealth branches', async () => {
    const tmux = new TmuxManager('cov-session', 'cov-socket');
    const tmuxInternalSpy = vi.spyOn(tmux as unknown as {
      tmuxInternal: (...args: string[]) => Promise<string>;
    }, 'tmuxInternal');

    tmuxInternalSpy.mockImplementation(async (...args: string[]) => {
      const [command, ...rest] = args;
      if (command === 'has-session') {
        throw new Error('missing');
      }
      if (command === 'kill-session') return '';
      if (command === 'new-session') return '';
      if (command === 'list-windows' && rest.includes('#{window_id}')) return '@1';
      if (command === 'list-windows') {
        return '@1\t_bridge_main\tC:\\repo\tpwsh\t0\n@2\tcc-live\tC:\\repo\tclaude\t0';
      }
      if (command === 'list-panes') return '5000';
      return '';
    });

    await tmux.ensureSession();
    const windows = await tmux.listWindows();
    expect(windows).toEqual([{
      windowId: '@2',
      windowName: 'cc-live',
      cwd: 'C:\\repo',
      paneCommand: 'claude',
      paneDead: false,
    }]);

    await expect(tmux.windowExists('@2')).resolves.toBe(true);
    await expect(tmux.windowExists('@2')).resolves.toBe(true);
    await expect(tmux.listPanePid('@2')).resolves.toBe(5000);
    await expect(tmux.getWindowHealth('@2')).resolves.toMatchObject({
      windowExists: true,
      paneCommand: 'claude',
      claudeRunning: true,
    });
  });

  it('creates windows with retry, duplicate-name recovery, and launch command wiring', async () => {
    const baseDir = setupSandbox('create-window');
    const workDir = join(baseDir, 'workspace');
    mkdirSync(workDir, { recursive: true });

    const tmux = new TmuxManager('cov-session', 'cov-socket');
    vi.spyOn(tmux as unknown as { ensureSessionInternal: () => Promise<void> }, 'ensureSessionInternal').mockResolvedValue(undefined);
    vi.spyOn(tmux as unknown as { resolveAvailableWindowName: (baseName: string) => Promise<string> }, 'resolveAvailableWindowName')
      .mockResolvedValueOnce('cc-work')
      .mockResolvedValueOnce('cc-work-2');
    vi.spyOn(tmux as unknown as { tmuxShellBatch: (...commands: string[][]) => Promise<void> }, 'tmuxShellBatch').mockResolvedValue(undefined);
    vi.spyOn(tmux as unknown as { pollUntil: (condition: () => Promise<boolean>, intervalMs: number, timeoutMs: number) => Promise<boolean> }, 'pollUntil').mockResolvedValue(true);
    vi.spyOn(tmux as unknown as { setEnvSecureDirect: (windowId: string, env: Record<string, string>) => Promise<void> }, 'setEnvSecureDirect').mockResolvedValue(undefined);
    vi.spyOn(tmux, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(tmux, 'listWindows').mockResolvedValue([{
      windowId: '@22',
      windowName: 'cc-work-2',
      cwd: workDir,
      paneCommand: 'claude',
      paneDead: false,
    }]);

    let duplicateAttempted = false;
    vi.spyOn(tmux as unknown as { tmuxInternal: (...args: string[]) => Promise<string> }, 'tmuxInternal')
      .mockImplementation(async (...args: string[]) => {
        const [command, ...rest] = args;
        if (command === 'list-windows') {
          if (rest.includes('#{window_id}\t#{window_name}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_dead}')) {
            return '@22\tcc-work-2\tC:\\repo\tclaude\t0';
          }
          return '@1';
        }
        if (command === 'new-window') {
          if (!duplicateAttempted) {
            duplicateAttempted = true;
            throw new Error('duplicate window');
          }
          return '';
        }
        if (command === 'display-message') return '@22';
        if (command === 'has-session') return '';
        if (command === 'kill-window') return '';
        if (command === 'new-session') return '';
        return '';
      });

    const result = await tmux.createWindow({
      workDir,
      windowName: 'cc-work',
      permissionMode: 'bypassPermissions',
      autoApprove: true,
      env: { SAFE_ENV: 'ok' },
      resumeSessionId: 'resume-1',
    });

    expect(result.windowId).toBe('@22');
    expect(result.windowName).toBe('cc-work-2');
    expect(result.freshSessionId).toBeUndefined();
    expect(tmux.sendKeys).toHaveBeenCalledWith(
      '@22',
      expect.stringContaining('--resume resume-1'),
      true,
    );
  });

  it('covers secure env injection paths on linux and windows', async () => {
    const tmux = new TmuxManager('cov-session', 'cov-socket');
    vi.spyOn(tmux as unknown as { pollUntil: (condition: () => Promise<boolean>, intervalMs: number, timeoutMs: number) => Promise<boolean> }, 'pollUntil').mockResolvedValue(true);
    vi.spyOn(tmux as unknown as { sendKeysDirectInternal: (windowId: string, text: string, enter?: boolean) => Promise<void> }, 'sendKeysDirectInternal').mockResolvedValue(undefined);
    vi.spyOn(tmux, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockResolvedValue('');
    vi.spyOn(tmux as unknown as { tmuxInternal: (...args: string[]) => Promise<string> }, 'tmuxInternal').mockResolvedValue('');

    await withPlatform('linux', async () => {
      await (tmux as unknown as { setEnvSecureDirect: (windowId: string, env: Record<string, string>) => Promise<void> })
        .setEnvSecureDirect('@1', { SAFE_KEY: "hello'world" });
      await expect((tmux as unknown as { setEnvSecure: (windowId: string, env: Record<string, string>) => Promise<void> })
        .setEnvSecure('@1', { invalid: 'x' }))
        .rejects.toThrow('Invalid env var key');
    });

    await withPlatform('win32', async () => {
      await (tmux as unknown as { setEnvSecure: (windowId: string, env: Record<string, string>) => Promise<void> })
        .setEnvSecure('@1', { SAFE_WIN: 'v' });
      await (tmux as unknown as { setEnvSecureDirect: (windowId: string, env: Record<string, string>) => Promise<void> })
        .setEnvSecureDirect('@1', { SAFE_WIN_DIRECT: 'v2' });
      expect((tmux as unknown as { tmux: (...args: string[]) => Promise<string> }).tmux)
        .toHaveBeenCalledWith('set-environment', '-t', 'cov-session', 'SAFE_WIN', 'v');
    });
  });

  it('handles send/read/delivery helpers and retry behavior', async () => {
    const tmux = new TmuxManager('cov-session', 'cov-socket');
    vi.spyOn(tmux, 'windowExists').mockResolvedValue(true);
    const pollUntilSpy = vi.spyOn(
      tmux as unknown as { pollUntil: (condition: () => Promise<boolean>, intervalMs: number, timeoutMs: number) => Promise<boolean> },
      'pollUntil',
    ).mockResolvedValue(true);
    vi.spyOn(tmux, 'capturePaneDirect').mockResolvedValue('! prompt');
    const tmuxCall = vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockResolvedValue('');

    await tmux.sendKeys('@1', '!echo hello', true);
    await tmux.sendKeys('@1', 'plain text', false);
    expect(tmuxCall).toHaveBeenCalledWith('send-keys', '-t', 'cov-session:@1', '-l', '!');

    vi.spyOn(tmux, 'capturePane').mockResolvedValueOnce('WORKING').mockResolvedValueOnce('IDLE');
    await expect(tmux.verifyDelivery('@1', 'hello text', 'idle')).resolves.toBe(true);
    await expect(tmux.verifyDelivery('@1', 'short', 'idle')).resolves.toBe(false);
    vi.spyOn(tmux, 'capturePane')
      .mockResolvedValueOnce('UNKNOWN TRANSITION')
      .mockResolvedValueOnce('IDLE hello text visible')
      .mockResolvedValueOnce('UNKNOWN');
    await expect(tmux.verifyDelivery('@1', 'hello text', 'idle')).resolves.toBe(true);
    await expect(tmux.verifyDelivery('@1', 'hello text', 'working')).resolves.toBe(true);
    await expect(tmux.verifyDelivery('@1', 'something else', 'working')).resolves.toBe(true);

    vi.spyOn(tmux, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(tmux, 'capturePane').mockResolvedValue('IDLE');
    vi.spyOn(tmux, 'verifyDelivery').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    pollUntilSpy.mockImplementation(async (condition: () => Promise<boolean>) => condition());
    const result = await tmux.sendKeysVerified('@1', 'retry me', 3);
    expect(result).toEqual({ delivered: true, attempts: 2 });
  });

  it('covers edge branches for pane pid, health fallbacks, and missing windows', async () => {
    const tmux = new TmuxManager('cov-session', 'cov-socket');
    vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockRejectedValueOnce(new Error('missing window'));
    await expect(tmux.listPanePid('@404')).resolves.toBeNull();

    vi.spyOn(tmux, 'listWindows').mockResolvedValueOnce([]);
    await expect(tmux.getWindowHealth('@404')).resolves.toEqual({
      windowExists: false,
      paneCommand: null,
      claudeRunning: false,
      paneDead: false,
    });

    vi.spyOn(tmux, 'listWindows').mockRejectedValueOnce(new Error('tmux unavailable'));
    await expect(tmux.getWindowHealth('@404')).resolves.toEqual({
      windowExists: false,
      paneCommand: null,
      claudeRunning: false,
      paneDead: false,
    });

    vi.spyOn(tmux, 'windowExists').mockResolvedValueOnce(false);
    await expect(tmux.sendKeys('@404', 'nope', true)).rejects.toThrow('does not exist');

    await withPlatform('linux', async () => {
      expect(tmux.isPidAlive(process.pid)).toBe(true);
      expect(tmux.isPidAlive(999_999_999)).toBe(false);
    });

    const pollSpy = vi.spyOn(
      tmux as unknown as { pollUntil: (condition: () => Promise<boolean>, intervalMs: number, timeoutMs: number) => Promise<boolean> },
      'pollUntil',
    ).mockImplementation(async (condition: () => Promise<boolean>) => condition());
    vi.spyOn(tmux, 'windowExists').mockResolvedValue(true);
    vi.spyOn(tmux, 'capturePaneDirect').mockRejectedValueOnce(new Error('capture failed'));
    vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockResolvedValue('');
    await tmux.sendKeys('@1', '!branch', true);
    pollSpy.mockRestore();

    const verifiedPoll = vi.spyOn(
      tmux as unknown as { pollUntil: (condition: () => Promise<boolean>, intervalMs: number, timeoutMs: number) => Promise<boolean> },
      'pollUntil',
    ).mockImplementation(async (condition: () => Promise<boolean>) => condition());
    vi.spyOn(tmux, 'capturePane').mockResolvedValue('WORKING');
    vi.spyOn(tmux, 'verifyDelivery').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const sendSpy = vi.spyOn(tmux, 'sendKeys').mockResolvedValue(undefined);
    const retried = await tmux.sendKeysVerified('@1', 'already working', 2);
    expect(retried).toEqual({ delivered: true, attempts: 2 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    verifiedPoll.mockRestore();
  });

  it('covers capture/send direct helpers, kill operations, and polling timeout', async () => {
    const tmux = new TmuxManager('cov-session', 'cov-socket');

    installExecSuccess('first line\n\x1bP1j\x1b\\hidden\n');
    await expect(tmux.capturePaneDirect('@1')).resolves.toContain('first line');

    const connRefused = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdoutData: string, stderrData: string) => void,
      ) => callback(connRefused, '', ''),
    );
    await expect((tmux as unknown as { capturePaneDirectInternal: (windowId: string) => Promise<string> })
      .capturePaneDirectInternal('@1')).resolves.toBe('');

    const killedError = Object.assign(new Error('timeout'), { killed: true });
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdoutData: string, stderrData: string) => void,
      ) => callback(killedError, '', ''),
    );
    await expect((tmux as unknown as { capturePaneDirectInternal: (windowId: string) => Promise<string> })
      .capturePaneDirectInternal('@1')).rejects.toBeInstanceOf(TmuxTimeoutError);
    execFileMock.mockImplementationOnce(
      (
        _file: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdoutData: string, stderrData: string) => void,
      ) => callback(new Error('boom'), '', ''),
    );
    await expect((tmux as unknown as { capturePaneDirectInternal: (windowId: string) => Promise<string> })
      .capturePaneDirectInternal('@1')).rejects.toThrow('boom');

    installExecSuccess();
    const queuedTmux = vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockResolvedValue('');
    await tmux.sendSpecialKey('@1', 'Escape');
    const pane = await tmux.capturePane('@1');
    expect(pane).not.toContain('\x1bP');
    await tmux.resizePane('@1', 120, 40);
    expect(queuedTmux).toHaveBeenCalledWith('resize-pane', '-t', 'cov-session:@1', '-x', '120', '-y', '40');

    await tmux.sendKeysDirect('@1', 'direct-enter', true);
    await tmux.sendKeysDirect('@1', 'direct-no-enter', false);

    (tmux as unknown as { _creatingCount: number })._creatingCount = 1;
    const serializeSpy = vi.spyOn(tmux as unknown as { serialize: <T>(fn: () => Promise<T>) => Promise<T> }, 'serialize');
    await tmux.sendKeysDirect('@1', 'queued', true);
    expect(serializeSpy).toHaveBeenCalled();

    vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockRejectedValueOnce(new Error('gone'));
    await tmux.killWindow('@1');
    vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockResolvedValue('');
    await tmux.killSession('cov-session');
    vi.spyOn(tmux as unknown as { tmux: (...args: string[]) => Promise<string> }, 'tmux').mockRejectedValueOnce(new Error('missing session'));
    await tmux.killSession('cov-session');

    const pollResult = await (tmux as unknown as {
      pollUntil: (condition: () => Promise<boolean>, intervalMs: number, timeoutMs: number) => Promise<boolean>;
    }).pollUntil(async () => false, 5, 15);
    expect(pollResult).toBe(false);
    await sleep(1);
  });
});
