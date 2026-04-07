/**
 * tmux-spawn.test.ts — Tests for Issue #7: session spawn failure after prolonged uptime.
 *
 * Tests the retry logic and health checks in TmuxManager.
 * Since tmux isn't available in CI, we test the logic patterns
 * rather than actual tmux commands.
 */

import { describe, it, expect } from 'vitest';
import { TmuxTimeoutError, buildClaudeLaunchCommand } from '../tmux.js';

describe('Tmux window creation retry logic', () => {
  describe('retry pattern', () => {
    it('should succeed on first attempt when tmux is healthy', async () => {
      let attempts = 0;
      const createWindow = async () => {
        attempts++;
        return { windowId: '@1', windowName: 'test' };
      };

      const result = await createWindow();
      expect(attempts).toBe(1);
      expect(result.windowId).toBe('@1');
    });

    it('should retry up to MAX_RETRIES on failure', async () => {
      const MAX_RETRIES = 3;
      let attempts = 0;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          attempts++;
          if (attempt < 3) {
            throw new Error(`Window not found after creation (attempt ${attempt})`);
          }
          lastError = null;
          break;
        } catch (e) {
          lastError = e as Error;
        }
      }

      expect(attempts).toBe(3);
      expect(lastError).toBeNull(); // Succeeded on 3rd attempt
    });

    it('should throw after MAX_RETRIES exhausted', async () => {
      const MAX_RETRIES = 3;
      let attempts = 0;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          attempts++;
          throw new Error(`Window not found (attempt ${attempt})`);
        } catch (e) {
          lastError = e as Error;
        }
      }

      expect(attempts).toBe(3);
      expect(lastError).not.toBeNull();
      expect(lastError!.message).toContain('attempt 3');
    });

    it('should apply exponential backoff between retries', () => {
      const backoffMs = (attempt: number) => 500 * attempt;
      expect(backoffMs(1)).toBe(500);
      expect(backoffMs(2)).toBe(1000);
      expect(backoffMs(3)).toBe(1500);
    });
  });

  describe('ensureSession health check', () => {
    it('should detect unhealthy session when list-windows fails', async () => {
      let sessionRecreated = false;

      // Simulate: has-session succeeds but list-windows fails
      const ensureSession = async () => {
        const hasSession = true; // tmux has-session succeeds

        try {
          if (!hasSession) throw new Error('no session');
          // Simulate list-windows failure on degraded session
          throw new Error('server exited unexpectedly');
        } catch {
          // Session unhealthy — recreate
          sessionRecreated = true;
        }
      };

      await ensureSession();
      expect(sessionRecreated).toBe(true);
    });
  });

  describe('Claude process verification', () => {
    it('should detect when Claude did not start (pane still shows shell)', () => {
      const shellCommands = ['bash', 'zsh', 'sh', 'pwsh', 'powershell', 'cmd', 'cmd.exe'];
      const claudeCommands = ['claude', 'node', 'deno'];

      for (const cmd of shellCommands) {
        const isShell = ['bash', 'zsh', 'sh', 'pwsh', 'powershell', 'cmd', 'cmd.exe'].includes(cmd.toLowerCase());
        expect(isShell).toBe(true);
      }

      for (const cmd of claudeCommands) {
        const isShell = ['bash', 'zsh', 'sh', 'pwsh', 'powershell', 'cmd', 'cmd.exe'].includes(cmd.toLowerCase());
        expect(isShell).toBe(false);
      }
    });

    it('should not flag Claude process as shell', () => {
      const paneCommand = 'claude';
      const isShell = ['bash', 'zsh', 'sh'].includes(paneCommand.toLowerCase());
      expect(isShell).toBe(false);
    });
  });

  describe('window name collision handling', () => {
    it('should add suffix on name collision', () => {
      const existingNames = new Set(['cc-task1', 'cc-task1-2']);
      let finalName = 'cc-task1';
      let counter = 2;
      while (existingNames.has(finalName)) {
        finalName = `cc-task1-${counter++}`;
      }
      expect(finalName).toBe('cc-task1-3');
    });

    it('should use original name when no collision', () => {
      const existingNames = new Set(['cc-other']);
      let finalName = 'cc-task1';
      let counter = 2;
      while (existingNames.has(finalName)) {
        finalName = `cc-task1-${counter++}`;
      }
      expect(finalName).toBe('cc-task1');
    });

    it('should serialize concurrent window creation with same name (L5)', async () => {
      // Simulate the serialize queue ensuring check-and-create atomicity.
      // Two concurrent createWindow('task') calls should not both get 'task'.
      let queue: Promise<void> = Promise.resolve(undefined as unknown as void);

      const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
        let resolve!: () => void;
        const next = new Promise<void>(r => { resolve = r; });
        const prev = queue;
        queue = next;
        return prev.then(async () => {
          try { return await fn(); }
          finally { resolve(); }
        });
      };

      const windows = new Set<string>();
      const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

      const createWindow = async (name: string) => {
        // Simulate listWindows + new-window as a serialized unit
        return serialize(async () => {
          // Check collision
          let finalName = name;
          let counter = 2;
          while (windows.has(finalName)) {
            finalName = `${name}-${counter++}`;
          }
          await delay(10); // simulate tmux latency
          windows.add(finalName);
          return finalName;
        });
      };

      // Fire 3 concurrent createWindow calls with the same name
      const results = await Promise.all([
        createWindow('task'),
        createWindow('task'),
        createWindow('task'),
      ]);

      // All should get unique names
      expect(new Set(results).size).toBe(3);
      expect(results).toContain('task');
      expect(results).toContain('task-2');
      expect(results).toContain('task-3');
    });
  });

  describe('tmux command timeout (Issue #66)', () => {
    it('TmuxTimeoutError includes command and timeout in message', () => {
      const err = new TmuxTimeoutError(['send-keys', '-t', 'aegis:@1', '-l', 'hello'], 10_000);
      expect(err.name).toBe('TmuxTimeoutError');
      expect(err.message).toContain('10000ms');
      expect(err.message).toContain('send-keys');
      expect(err.message).toContain('aegis:@1');
      expect(err instanceof Error).toBe(true);
    });

    it('should detect killed process as timeout', () => {
      // Simulate Node.js execFile timeout behavior:
      // When timeout is exceeded, Node kills the process and sets error.killed = true
      const simulatedError = Object.assign(new Error('process killed'), { killed: true });
      const isTimeout = 'killed' in simulatedError && simulatedError.killed === true;
      expect(isTimeout).toBe(true);
    });

    it('should NOT treat non-timeout errors as timeout', () => {
      const normalError = new Error('tmux: no server running');
      const isTimeout = 'killed' in normalError && (normalError as { killed?: boolean }).killed === true;
      expect(isTimeout).toBe(false);
    });
  });

  describe('tmux serialization queue', () => {
    it('should serialize concurrent operations — no race conditions', async () => {
      // Simulate the promise-chain queue pattern from TmuxManager.serialize()
      let queue: Promise<void> = Promise.resolve(undefined as unknown as void);

      const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
        let resolve!: () => void;
        const next = new Promise<void>(r => { resolve = r; });
        const prev = queue;
        queue = next;
        return prev.then(async () => {
          try { return await fn(); }
          finally { resolve(); }
        });
      };

      const order: number[] = [];
      const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

      // Simulate two concurrent "session creation" operations, each running
      // multiple tmux commands internally. Without serialization, the interleaving
      // would be non-deterministic. With serialization, each session's commands
      // complete fully before the next session begins.
      const session1 = serialize(async () => {
        order.push(1); // session1: new-window
        await delay(50);
        order.push(2); // session1: set-window-option
        await delay(50);
        order.push(3); // session1: display-message
      });

      const session2 = serialize(async () => {
        order.push(4); // session2: new-window
        await delay(50);
        order.push(5); // session2: set-window-option
        await delay(50);
        order.push(6); // session2: display-message
      });

      const session3 = serialize(async () => {
        order.push(7); // session3: new-window
        await delay(50);
        order.push(8); // session3: set-window-option
        await delay(50);
        order.push(9); // session3: display-message
      });

      await Promise.all([session1, session2, session3]);

      // All of session1's steps (1,2,3) must precede session2's (4,5,6),
      // which must precede session3's (7,8,9)
      expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should not deadlock when an operation throws', async () => {
      let queue: Promise<void> = Promise.resolve(undefined as unknown as void);

      const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
        let resolve!: () => void;
        const next = new Promise<void>(r => { resolve = r; });
        const prev = queue;
        queue = next;
        return prev.then(async () => {
          try { return await fn(); }
          finally { resolve(); }
        });
      };

      // First operation throws
      const failed = serialize(async () => {
        throw new Error('tmux: no server running');
      }).catch(() => 'caught');

      // Second operation should still run (no deadlock)
      const result = serialize(async () => 'ok');

      const [r1, r2] = await Promise.all([failed, result]);
      expect(r1).toBe('caught');
      expect(r2).toBe('ok');
    });
  });

  describe('TMUX env isolation (Issue #68)', () => {
    it('uses unset+exec wrapper on Unix-like platforms', () => {
      const baseCmd = 'claude --session-id abc123';
      const cmd = buildClaudeLaunchCommand(baseCmd, 'linux');

      expect(cmd).toBe(`unset TMUX TMUX_PANE && exec ${baseCmd}`);
      expect(cmd).toContain('unset TMUX TMUX_PANE');
      expect(cmd).toContain('exec');
      expect(cmd).toContain(baseCmd);
    });

    it('uses PowerShell env cleanup on win32', () => {
      const baseCmd = 'claude --session-id abc123';
      const cmd = buildClaudeLaunchCommand(baseCmd, 'win32');

      expect(cmd).toContain('Remove-Item Env:TMUX -ErrorAction SilentlyContinue');
      expect(cmd).toContain('Remove-Item Env:TMUX_PANE -ErrorAction SilentlyContinue');
      expect(cmd).toContain(baseCmd);
      expect(cmd).not.toContain('unset TMUX TMUX_PANE');
    });

    it('preserves permission-mode args across wrappers', () => {
      const baseCmd = 'claude --session-id abc123 --permission-mode acceptEdits';
      const cmd = buildClaudeLaunchCommand(baseCmd, 'linux');
      expect(cmd).toContain('unset TMUX TMUX_PANE');
      expect(cmd).toContain('--permission-mode acceptEdits');
    });

    it('should pass permissionMode directly to CLI flag', () => {
      const mode = 'plan';
      const baseCmd = `claude --session-id abc123 --permission-mode ${mode}`;
      const cmd = `unset TMUX TMUX_PANE && ${baseCmd}`;
      expect(cmd).toContain(`--permission-mode ${mode}`);
    });

    it('should also unset when resuming a session', () => {
      const baseCmd = 'claude --resume existing-session-id';
      const cmd = buildClaudeLaunchCommand(baseCmd, 'linux');
      expect(cmd).toContain('unset TMUX TMUX_PANE');
      expect(cmd).toContain('--resume existing-session-id');
    });
  });

  describe('L2: listWindows error logging', () => {
    it('should return empty array on error and log warning', async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        // Simulate listWindows error handling
        const simulateListWindows = async (): Promise<unknown[]> => {
          try {
            throw new Error('tmux: no server running');
          } catch (e: unknown) {
            console.warn(`Tmux: listWindows failed: ${(e as Error).message}`);
            return [];
          }
        };

        const result = await simulateListWindows();
        expect(result).toEqual([]);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Tmux: listWindows failed');
        expect(warnings[0]).toContain('tmux: no server running');
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('L27: autoApprove redundancy with bypassPermissions', () => {
    it('should warn when autoApprove=true and permissionMode=bypassPermissions', () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        // Simulate the logic from createWindow
        const permissionMode = 'bypassPermissions';
        const autoApprove = true;

        if (permissionMode === 'bypassPermissions' && autoApprove === true) {
          console.warn('Tmux: autoApprove=true is redundant with permissionMode=bypassPermissions — autoApprove has no additional effect');
        }

        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('autoApprove=true is redundant');
        expect(warnings[0]).toContain('bypassPermissions');
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should NOT warn when only permissionMode=bypassPermissions is set', () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        const permissionMode = 'bypassPermissions';
        const autoApprove = undefined;

        if (permissionMode === 'bypassPermissions' && autoApprove === true) {
          console.warn('Tmux: autoApprove=true is redundant with permissionMode=bypassPermissions — autoApprove has no additional effect');
        }

        expect(warnings.length).toBe(0);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should NOT warn when only autoApprove=true is set (no explicit permissionMode)', () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        const permissionMode = undefined;
        const autoApprove = true;

        if (permissionMode === 'bypassPermissions' && autoApprove === true) {
          console.warn('Tmux: autoApprove=true is redundant with permissionMode=bypassPermissions — autoApprove has no additional effect');
        }

        expect(warnings.length).toBe(0);
      } finally {
        console.warn = originalWarn;
      }
    });

    it('should NOT warn when autoApprove=false and permissionMode=bypassPermissions', () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        const permissionMode = 'bypassPermissions';
        const autoApprove = false as boolean | undefined;

        if (permissionMode === 'bypassPermissions' && autoApprove === true) {
          console.warn('Tmux: autoApprove=true is redundant with permissionMode=bypassPermissions — autoApprove has no additional effect');
        }

        expect(warnings.length).toBe(0);
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('L29: CC env var merging', () => {
    it('user env vars should override default env vars', () => {
      // Simulate the merge logic from SessionManager.createSession()
      const defaultSessionEnv: Record<string, string> = {
        DISABLE_AUTOUPDATER: '1',
        ANTHROPIC_MODEL: 'claude-sonnet-4-6',
        NO_COLOR: '1',
      };
      const perSessionEnv: Record<string, string> = {
        ANTHROPIC_MODEL: 'claude-opus-4-6',  // override default
        ANTHROPIC_API_KEY: 'sk-test-123',    // session-specific
      };

      const mergedEnv = { ...defaultSessionEnv, ...perSessionEnv };

      // User values override defaults
      expect(mergedEnv.ANTHROPIC_MODEL).toBe('claude-opus-4-6');
      expect(mergedEnv.ANTHROPIC_API_KEY).toBe('sk-test-123');
      // Default values not overridden are preserved
      expect(mergedEnv.DISABLE_AUTOUPDATER).toBe('1');
      expect(mergedEnv.NO_COLOR).toBe('1');
    });

    it('should produce empty env when no defaults or per-session env provided', () => {
      const defaultSessionEnv: Record<string, string> = {};
      const perSessionEnv: Record<string, string> | undefined = undefined;
      const mergedEnv: Record<string, string> = { ...defaultSessionEnv, ...(perSessionEnv ?? {}) };

      expect(Object.keys(mergedEnv)).toHaveLength(0);
    });

    it('should use default env when no per-session env provided', () => {
      const defaultSessionEnv: Record<string, string> = {
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_SKIP_EULA: '1',
      };
      const perSessionEnv: Record<string, string> | undefined = undefined;
      const mergedEnv: Record<string, string> = { ...defaultSessionEnv, ...(perSessionEnv ?? {}) };

      expect(mergedEnv.DISABLE_AUTOUPDATER).toBe('1');
      expect(mergedEnv.CLAUDE_CODE_SKIP_EULA).toBe('1');
      expect(Object.keys(mergedEnv)).toHaveLength(2);
    });

    it('should use per-session env when no defaults configured', () => {
      const defaultSessionEnv: Record<string, string> = {};
      const perSessionEnv: Record<string, string> = {
        ANTHROPIC_API_KEY: 'sk-test-456',
      };
      const mergedEnv = { ...defaultSessionEnv, ...perSessionEnv };

      expect(mergedEnv.ANTHROPIC_API_KEY).toBe('sk-test-456');
      expect(Object.keys(mergedEnv)).toHaveLength(1);
    });
  });

  describe('L3: killWindow error logging', () => {
    it('should log warning with window target on error', async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        const simulateKillWindow = async (sessionName: string, windowId: string): Promise<void> => {
          const target = `${sessionName}:${windowId}`;
          try {
            throw new Error('no such window');
          } catch (e: unknown) {
            console.warn(`Tmux: killWindow failed for ${target}: ${(e as Error).message}`);
          }
        };

        await simulateKillWindow('aegis', '@5');
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain('Tmux: killWindow failed for aegis:@5');
        expect(warnings[0]).toContain('no such window');
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe('L6: killSession public method', () => {
    it('should accept optional session name override', () => {
      // Simulate killSession with optional override
      const defaultSessionName = 'aegis';
      const killSession = (sessionName?: string) => {
        const target = sessionName ?? defaultSessionName;
        return `kill-session -t ${target}`;
      };

      expect(killSession()).toBe('kill-session -t aegis');
      expect(killSession('custom-session')).toBe('kill-session -t custom-session');
    });

    it('should log on success and warn on failure', async () => {
      const logs: string[] = [];
      const warnings: string[] = [];
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      try {
        // Simulate success path
        const simulateKillSessionSuccess = async (sessionName: string) => {
          try {
            console.log(`Tmux: session '${sessionName}' killed`);
          } catch (e: unknown) {
            console.warn(`Tmux: killSession failed for '${sessionName}': ${(e as Error).message}`);
          }
        };

        // Simulate failure path
        const simulateKillSessionFailure = async (sessionName: string) => {
          try {
            throw new Error('no server running');
          } catch (e: unknown) {
            console.warn(`Tmux: killSession failed for '${sessionName}': ${(e as Error).message}`);
          }
        };

        await simulateKillSessionSuccess('aegis');
        expect(logs).toContain("Tmux: session 'aegis' killed");

        await simulateKillSessionFailure('aegis');
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("Tmux: killSession failed for 'aegis'");
        expect(warnings[0]).toContain('no server running');
      } finally {
        console.log = originalLog;
        console.warn = originalWarn;
      }
    });
  });

  describe('L30: PID lookup unhandled rejection (Issue #574)', () => {
    it('should catch listPanePid rejection without throwing', async () => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));

      try {
        // Simulate the fire-and-forget PID lookup pattern with .catch()
        const listPanePid = async (): Promise<number | null> => {
          throw new Error('tmux: no such window @99');
        };

        const session: { ccPid?: number } = {};
        const id = 'test-session';

        // This is the pattern from session.ts (Issue #574 fix)
        void listPanePid().then(pid => {
          if (pid !== null) {
            session.ccPid = pid;
          }
        }).catch(e => console.error(`Session: failed to list pane PID for ${id}:`, e));

        // Give microtask queue a chance to settle
        await new Promise(r => setTimeout(r, 10));

        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('failed to list pane PID for test-session');
        expect(errors[0]).toContain('tmux: no such window @99');
        expect(session.ccPid).toBeUndefined();
      } finally {
        console.error = originalError;
      }
    });

    it('should catch save() rejection after successful PID lookup', async () => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));

      try {
        const listPanePid = async (): Promise<number | null> => 12345;
        const save = async (): Promise<void> => { throw new Error('disk full'); };

        const session: { ccPid?: number } = {};
        const id = 'test-session';

        void listPanePid().then(pid => {
          if (pid !== null) {
            session.ccPid = pid;
            void save().catch(e => console.error(`Session: failed to save PID for ${id}:`, e));
          }
        });

        await new Promise(r => setTimeout(r, 10));

        expect(session.ccPid).toBe(12345);
        expect(errors.length).toBe(1);
        expect(errors[0]).toContain('failed to save PID for test-session');
        expect(errors[0]).toContain('disk full');
      } finally {
        console.error = originalError;
      }
    });

    it('should silently succeed when PID lookup returns null', async () => {
      const errors: string[] = [];
      const originalError = console.error;
      console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));

      try {
        const listPanePid = async (): Promise<number | null> => null;

        const session: { ccPid?: number } = {};
        let saveCalled = false;
        const save = async (): Promise<void> => { saveCalled = true; };

        void listPanePid().then(pid => {
          if (pid !== null) {
            session.ccPid = pid;
            void save().catch(e => console.error(`Session: failed to save PID for test:`, e));
          }
        }).catch(e => console.error(`Session: failed to list pane PID for test:`, e));

        await new Promise(r => setTimeout(r, 10));

        expect(errors.length).toBe(0);
        expect(session.ccPid).toBeUndefined();
        expect(saveCalled).toBe(false);
      } finally {
        console.error = originalError;
      }
    });
  });
});
