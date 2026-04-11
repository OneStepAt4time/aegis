import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface HookModule {
  main: () => void;
  install: () => void;
  buildHookCommand: (scriptPath: string, nodeExecutable?: string, platform?: NodeJS.Platform) => string;
}

const fsMock = vi.hoisted(() => ({
  readFileSync: vi.fn<(path: number | string) => string>(),
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
  mkdirSync: vi.fn<(path: string, options?: { recursive?: boolean }) => string | undefined>(),
  existsSync: vi.fn<(path: string) => boolean>(),
  renameSync: vi.fn<(oldPath: string, newPath: string) => void>(),
  lstatSync: vi.fn<(path: string) => { isSymbolicLink: () => boolean }>(),
  openSync: vi.fn<(path: string, flags: string) => number>(),
  closeSync: vi.fn<(fd: number) => void>(),
  unlinkSync: vi.fn<(path: string) => void>(),
}));

const childMock = vi.hoisted(() => ({
  execFileSync: vi.fn<(file: string, args: string[], options: { encoding: string }) => string>(),
}));

vi.mock('node:fs', () => fsMock);
vi.mock('node:child_process', () => childMock);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: () => '/tmp/aegis-home',
  };
});

function makeExitError(code: number | undefined): Error {
  return new Error(`HOOK_EXIT:${code ?? 0}`);
}

describe('Issue #1652: hook.ts coverage hardening', () => {
  const originalArgv = [...process.argv];
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };

    fsMock.readFileSync.mockImplementation((pathValue) => (pathValue === 0 ? '{}' : '{}'));
    fsMock.writeFileSync.mockImplementation(() => undefined);
    fsMock.mkdirSync.mockImplementation(() => undefined);
    fsMock.existsSync.mockImplementation((pathValue) => pathValue.includes('.aegis'));
    fsMock.renameSync.mockImplementation(() => undefined);
    fsMock.lstatSync.mockImplementation(() => ({ isSymbolicLink: () => false }));
    fsMock.openSync.mockImplementation(() => 1);
    fsMock.closeSync.mockImplementation(() => undefined);
    fsMock.unlinkSync.mockImplementation(() => undefined);
    childMock.execFileSync.mockImplementation(() => 'team:1:dev-window');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
  });

  async function importFreshHook(): Promise<HookModule> {
    vi.resetModules();
    return import('../hook.js') as Promise<HookModule>;
  }

  function trapProcessExit(): ReturnType<typeof vi.spyOn> {
    return vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: string | number | null): never => {
        throw makeExitError(typeof code === 'number' ? code : 0);
      }) as typeof process.exit);
  }

  it('handles non-object stdin payloads by exiting cleanly', async () => {
    fsMock.readFileSync.mockImplementation((pathValue) => (pathValue === 0 ? '[]' : '{}'));
    const exitSpy = trapProcessExit();

    const hook = await importFreshHook();
    expect(() => hook.main()).toThrow('HOOK_EXIT:0');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('handles StopFailure events and writes stop signal payload', async () => {
    fsMock.readFileSync.mockImplementation((pathValue) => {
      if (pathValue === 0) {
        return JSON.stringify({
          session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          hook_event_name: 'StopFailure',
          error: 'rate_limited',
          stop_reason: 'rate_limit',
        });
      }
      return '{}';
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    trapProcessExit();

    const hook = await importFreshHook();
    expect(() => hook.main()).toThrow('HOOK_EXIT:0');
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    const writePayload = fsMock.writeFileSync.mock.calls[0]?.[1] ?? '';
    expect(writePayload).toContain('StopFailure');
    expect(writePayload).toContain('rate_limit');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('rejects invalid SessionStart UUIDs', async () => {
    fsMock.readFileSync.mockImplementation((pathValue) => {
      if (pathValue === 0) {
        return JSON.stringify({
          session_id: 'bad-uuid',
          hook_event_name: 'SessionStart',
          cwd: '/tmp',
        });
      }
      return '{}';
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    trapProcessExit();

    const hook = await importFreshHook();
    expect(() => hook.main()).toThrow('HOOK_EXIT:0');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid session_id'));
  });

  it('requires TMUX_PANE for valid SessionStart payloads', async () => {
    process.env.TMUX_PANE = '';
    fsMock.readFileSync.mockImplementation((pathValue) => {
      if (pathValue === 0) {
        return JSON.stringify({
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          hook_event_name: 'SessionStart',
          cwd: '/tmp',
        });
      }
      return '{}';
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    trapProcessExit();

    const hook = await importFreshHook();
    expect(() => hook.main()).toThrow('HOOK_EXIT:0');
    expect(errorSpy).toHaveBeenCalledWith('TMUX_PANE not set');
  });

  it('writes session map entries after tmux lookup succeeds', async () => {
    process.env.TMUX_PANE = '%7';
    fsMock.readFileSync.mockImplementation((pathValue) => {
      if (pathValue === 0) {
        return JSON.stringify({
          session_id: '123e4567-e89b-12d3-a456-426614174000',
          hook_event_name: 'SessionStart',
          cwd: '/tmp/project',
          source: 'startup',
        });
      }
      return '{}';
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = await importFreshHook();
    hook.main();

    expect(childMock.execFileSync).toHaveBeenCalledWith(
      'tmux',
      ['display-message', '-t', '%7', '-p', '#{session_name}:#{window_id}:#{window_name}'],
      { encoding: 'utf-8' },
    );
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    const payloadText = fsMock.writeFileSync.mock.calls[0]?.[1] ?? '';
    expect(payloadText).toContain('123e4567-e89b-12d3-a456-426614174000');
    expect(payloadText).toContain('dev-window');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Aegis hook: mapped team:1 -> 123e4567-e89b-12d3-a456-426614174000'),
    );
  });

  it('install registers SessionStart, Stop, and StopFailure hook entries', async () => {
    fsMock.existsSync.mockImplementation(() => false);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const hook = await importFreshHook();
    hook.install();

    expect(fsMock.writeFileSync).toHaveBeenCalled();
    const installPayload = fsMock.writeFileSync.mock.calls[0]?.[1] ?? '';
    expect(installPayload).toContain('SessionStart');
    expect(installPayload).toContain('Stop');
    expect(installPayload).toContain('StopFailure');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Aegis hook installed in'));
  });

  it('buildHookCommand rejects unsafe command paths', async () => {
    const hook = await importFreshHook();

    expect(() => hook.buildHookCommand('/tmp/hook.js\n', '/usr/bin/node', 'linux')).toThrow(
      /control characters/,
    );
    expect(() => hook.buildHookCommand('D:/hook.js', 'C:/node".exe', 'win32')).toThrow(
      /double quotes/,
    );
  });
});
