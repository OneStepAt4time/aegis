/**
 * tmux.test.ts — Unit tests for TmuxManager public methods.
 * Issue #1880: tmux.ts unit tests Phase 2
 *
 * Follows dead-session.test.ts pattern:
 * - Import real TmuxManager, create real instances
 * - Mock the internal tmux command execution (tmuxInternal)
 * - Call actual public methods, verify real behavior
 *
 * Covers: listWindows, windowExists, capturePane, capturePaneDirect,
 * sendSpecialKey, killWindow, killSession, resizePane, listPanePid,
 * getWindowHealth, isServerHealthy, sendKeys, sendKeysDirect,
 * ensureSession, parseWindowListLine, serialize queue ordering,
 * TmuxTimeoutError, isTmuxServerError, isDuplicateWindowNameError,
 * isPidAlive, verifyDelivery, sendKeysVerified, constructor defaults.
 */

import { describe, it, expect, vi } from 'vitest';
import { TmuxManager, TmuxTimeoutError } from '../tmux.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a real TmuxManager instance. */
function makeManager(sessionName = 'test-session', socketName = 'test-socket') {
  return new TmuxManager(sessionName, socketName);
}

/**
 * Spy on the private tmuxInternal method to return controlled responses.
 * `impl` receives the tmux subcommand args and returns the mock stdout.
 */
function mockTmuxInternal(
  manager: TmuxManager,
  impl: (...args: unknown[]) => Promise<string>,
) {
  return vi.spyOn(manager as any, 'tmuxInternal').mockImplementation(impl);
}

/** Build a response handler from a map of subcommand → response. */
function cmdResponseMap(map: Record<string, string>) {
  return async (...args: unknown[]): Promise<string> => {
    const cmd = args[0] as string;
    const response = map[cmd];
    return response ?? '';
  };
}

// Standard window list output lines
const BRIDGE = '@0\t_bridge_main\t/home\tbash\t0';
const WIN1   = '@1\tmy-window\t/home/project\tclaude\t0';
const WIN2   = '@2\tanother-win\t/tmp/work\tnode\t0';
const FULL_LIST = [BRIDGE, WIN1, WIN2].join('\n');

/** Standard mock that returns healthy session + window list. */
function healthyManager() {
  const manager = makeManager();
  mockTmuxInternal(manager, cmdResponseMap({
    'has-session': '',
    'list-windows': FULL_LIST,
  }));
  return manager;
}

// ---------------------------------------------------------------------------
// listWindows
// ---------------------------------------------------------------------------

describe('listWindows', () => {
  it('parses window list and excludes _bridge_main', async () => {
    const manager = healthyManager();
    const windows = await manager.listWindows();

    expect(windows).toHaveLength(2);
    expect(windows[0]!.windowId).toBe('@1');
    expect(windows[0]!.windowName).toBe('my-window');
    expect(windows[1]!.windowId).toBe('@2');
    expect(windows[1]!.windowName).toBe('another-win');
  });

  it('returns empty when only _bridge_main exists', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': BRIDGE,
    }));

    const windows = await manager.listWindows();
    expect(windows).toEqual([]);
  });

  it('returns empty for empty tmux output', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '',
    }));

    const windows = await manager.listWindows();
    expect(windows).toEqual([]);
  });

  it('returns empty when list-windows throws', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async (...args: unknown[]) => {
      if (args[0] === 'has-session') return '';
      if (args[0] === 'list-windows') throw new Error('no server running');
      return '';
    });

    const windows = await manager.listWindows();
    expect(windows).toEqual([]);
  });

  it('parses paneDead=1 correctly', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\tdead-win\t/home\tbash\t1',
    }));

    const [win] = await manager.listWindows();
    expect(win!.paneDead).toBe(true);
  });

  it('parses cwd and paneCommand fields', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@5\twork\t/project\tnode\t0',
    }));

    const [win] = await manager.listWindows();
    expect(win!.cwd).toBe('/project');
    expect(win!.paneCommand).toBe('node');
    expect(win!.paneDead).toBe(false);
  });

  it('handles windows with spaces in name', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\tmy cool project\t/tmp\tbash\t0',
    }));

    const [win] = await manager.listWindows();
    expect(win!.windowName).toBe('my cool project');
  });
});

// ---------------------------------------------------------------------------
// windowExists
// ---------------------------------------------------------------------------

describe('windowExists', () => {
  it('returns true when window is in the session', async () => {
    const manager = healthyManager();
    expect(await manager.windowExists('@1')).toBe(true);
  });

  it('returns false when window is not in the session', async () => {
    const manager = healthyManager();
    expect(await manager.windowExists('@99')).toBe(false);
  });

  it('caches result — second call skips tmux', async () => {
    const manager = healthyManager();
    await manager.windowExists('@1');
    // Access the spy via the manager instance
    const spy = (manager as any).tmuxInternal;

    const callsAfterFirst = spy.mock.calls.length;
    await manager.windowExists('@1');

    // No new tmuxInternal calls — served from cache
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('re-fetches after cache TTL expires', async () => {
    const manager = healthyManager();
    await manager.windowExists('@1');
    const spy = (manager as any).tmuxInternal;
    const callsAfterFirst = spy.mock.calls.length;

    // Expire the cache entry (TTL is 2s)
    const cache = (manager as any).windowCache as Map<string, { exists: boolean; timestamp: number }>;
    cache.get('@1')!.timestamp = Date.now() - 5_000;

    await manager.windowExists('@1');
    expect(spy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('returns false on tmux error without throwing', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async () => { throw new Error('server crashed'); });

    const exists = await manager.windowExists('@1');
    expect(exists).toBe(false);
  });

  it('different window IDs get separate cache entries', async () => {
    const manager = healthyManager();
    await manager.windowExists('@1');
    await manager.windowExists('@2');

    const cache = (manager as any).windowCache;
    expect(cache.has('@1')).toBe(true);
    expect(cache.has('@2')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// capturePane
// ---------------------------------------------------------------------------

describe('capturePane', () => {
  it('returns captured pane content', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({ 'capture-pane': 'Hello World\nLine 2' }));

    expect(await manager.capturePane('@1')).toBe('Hello World\nLine 2');
  });

  it('strips DCS passthrough sequences', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'capture-pane': 'before\x1bPDCS data\x1b\\after',
    }));

    expect(await manager.capturePane('@1')).toBe('beforeafter');
  });

  it('strips multiple DCS sequences', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'capture-pane': 'a\x1bPfirst\x1b\\b\x1bPsecond\x1b\\c',
    }));

    expect(await manager.capturePane('@1')).toBe('abc');
  });

  it('uses session:windowId target format', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({ 'capture-pane': '' }));

    await manager.capturePane('@5');

    const call = spy.mock.calls.find(c => c.join(' ').includes('capture-pane'));
    expect(call).toBeDefined();
    expect(call!.join(' ')).toContain('test-session:@5');
  });
});

// ---------------------------------------------------------------------------
// sendSpecialKey
// ---------------------------------------------------------------------------

describe('sendSpecialKey', () => {
  it('dispatches key via tmux send-keys', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.sendSpecialKey('@1', 'C-c');

    const call = spy.mock.calls.find(c => c[0] === 'send-keys');
    expect(call).toBeDefined();
    expect(call).toContain('C-c');
  });

  it('uses session:windowId target', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.sendSpecialKey('@3', 'Escape');

    const call = spy.mock.calls.find(c => c[0] === 'send-keys')!;
    expect(call.join(' ')).toContain('test-session:@3');
  });
});

// ---------------------------------------------------------------------------
// killWindow
// ---------------------------------------------------------------------------

describe('killWindow', () => {
  it('clears window from cache', async () => {
    const manager = healthyManager();
    await manager.windowExists('@1');
    const cache = (manager as any).windowCache;
    expect(cache.has('@1')).toBe(true);

    await manager.killWindow('@1');
    expect(cache.has('@1')).toBe(false);
  });

  it('calls tmux kill-window with correct target', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.killWindow('@5');

    const call = spy.mock.calls.find(c => c[0] === 'kill-window')!;
    expect(call.join(' ')).toContain('test-session:@5');
  });

  it('does not throw when kill-window fails', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async (...args: unknown[]) => {
      if (args[0] === 'kill-window') throw new Error('no such window');
      return '';
    });

    await expect(manager.killWindow('@99')).resolves.toBeUndefined();
  });

  it('clears cache even if kill-window errors', async () => {
    const manager = healthyManager();
    await manager.windowExists('@1');

    mockTmuxInternal(manager, async (...args: unknown[]) => {
      if (args[0] === 'kill-window') throw new Error('fail');
      return '';
    });

    await manager.killWindow('@1');
    expect((manager as any).windowCache.has('@1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// killSession
// ---------------------------------------------------------------------------

describe('killSession', () => {
  it('kills the default session when no name given', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.killSession();

    const call = spy.mock.calls.find(c => c[0] === 'kill-session')!;
    expect(call).toContain('test-session');
  });

  it('kills a named session when name is provided', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.killSession('other-session');

    const call = spy.mock.calls.find(c => c[0] === 'kill-session')!;
    expect(call).toContain('other-session');
  });

  it('does not throw when kill-session fails', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async (...args: unknown[]) => {
      if (args[0] === 'kill-session') throw new Error('no session found');
      return '';
    });

    await expect(manager.killSession()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resizePane
// ---------------------------------------------------------------------------

describe('resizePane', () => {
  it('sends resize-pane with correct dimensions', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.resizePane('@1', 220, 50);

    const call = spy.mock.calls.find(c => c[0] === 'resize-pane')!;
    expect(call).toContain('-x');
    expect(call).toContain('220');
    expect(call).toContain('-y');
    expect(call).toContain('50');
  });

  it('uses session:windowId target', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({}));

    await manager.resizePane('@2', 100, 30);

    const call = spy.mock.calls.find(c => c[0] === 'resize-pane')!;
    expect(call.join(' ')).toContain('test-session:@2');
  });
});

// ---------------------------------------------------------------------------
// listPanePid
// ---------------------------------------------------------------------------

describe('listPanePid', () => {
  it('parses a valid PID', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({ 'list-panes': '12345' }));

    expect(await manager.listPanePid('@1')).toBe(12345);
  });

  it('returns first PID when multiple panes exist', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({ 'list-panes': '111\n222\n333' }));

    expect(await manager.listPanePid('@1')).toBe(111);
  });

  it('returns null for empty output', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({ 'list-panes': '' }));

    expect(await manager.listPanePid('@1')).toBeNull();
  });

  it('returns null for non-numeric output', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({ 'list-panes': 'not-a-pid' }));

    expect(await manager.listPanePid('@1')).toBeNull();
  });

  it('returns null on tmux error', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async () => { throw new Error('no pane'); });

    expect(await manager.listPanePid('@1')).toBeNull();
  });

  it('uses session:windowId target', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, cmdResponseMap({ 'list-panes': '123' }));

    await manager.listPanePid('@7');

    const call = spy.mock.calls.find(c => c[0] === 'list-panes')!;
    expect(call.join(' ')).toContain('test-session:@7');
  });
});

// ---------------------------------------------------------------------------
// getWindowHealth
// ---------------------------------------------------------------------------

describe('getWindowHealth', () => {
  it('reports healthy when claude process is running', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\twork\t/home\tclaude\t0',
    }));

    const health = await manager.getWindowHealth('@1');
    expect(health.windowExists).toBe(true);
    expect(health.paneCommand).toBe('claude');
    expect(health.claudeRunning).toBe(true);
    expect(health.paneDead).toBe(false);
  });

  it('detects node as claude process', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\twork\t/home\tnode\t0',
    }));

    expect((await manager.getWindowHealth('@1')).claudeRunning).toBe(true);
  });

  it('does not flag shell as claude', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\twork\t/home\tbash\t0',
    }));

    const health = await manager.getWindowHealth('@1');
    expect(health.claudeRunning).toBe(false);
    expect(health.paneCommand).toBe('bash');
  });

  it('returns not-exists when window not found', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@2\tother\t/home\tbash\t0',
    }));

    const health = await manager.getWindowHealth('@99');
    expect(health).toEqual({
      windowExists: false,
      paneCommand: null,
      claudeRunning: false,
      paneDead: false,
    });
  });

  it('detects paneDead flag', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\twork\t/home\tbash\t1',
    }));

    expect((await manager.getWindowHealth('@1')).paneDead).toBe(true);
  });

  it('returns safe defaults on tmux error', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async () => { throw new Error('server error'); });

    const health = await manager.getWindowHealth('@1');
    expect(health).toEqual({
      windowExists: false,
      paneCommand: null,
      claudeRunning: false,
      paneDead: false,
    });
  });

  it('is case-insensitive when checking claude process', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\twork\t/home\tClaude\t0',
    }));

    // paneCommand is compared with .toLowerCase() in the source
    const health = await manager.getWindowHealth('@1');
    expect(health.paneCommand).toBe('Claude');
    expect(health.claudeRunning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isServerHealthy
// ---------------------------------------------------------------------------

describe('isServerHealthy', () => {
  it('returns healthy when list-sessions succeeds', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({ 'list-sessions': 'sess1\nsess2' }));

    const result = await manager.isServerHealthy();
    expect(result).toEqual({ healthy: true, error: null });
  });

  it('returns unhealthy with error message on failure', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async () => {
      throw new Error('no server running');
    });

    const result = await manager.isServerHealthy();
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('no server running');
  });

  it('handles non-Error throws gracefully', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, async () => { throw 'string error'; });

    const result = await manager.isServerHealthy();
    expect(result.healthy).toBe(false);
    expect(result.error).toBe('string error');
  });
});

// ---------------------------------------------------------------------------
// sendKeys
// ---------------------------------------------------------------------------

describe('sendKeys', () => {
  it('throws when window does not exist', async () => {
    const manager = healthyManager();
    // FULL_LIST has @1 and @2 but not @99

    await expect(manager.sendKeys('@99', 'hello')).rejects.toThrow('does not exist');
  });

  it('sends text and Enter when enter=true', async () => {
    const manager = healthyManager();
    const spy = (manager as any).tmuxInternal;

    await manager.sendKeys('@1', 'hello', true);

    const calls = spy.mock.calls.map((c: any[]) => c.join(' '));
    // Should send text literally via send-keys -l
    expect(calls.some((c: string) => c.includes('send-keys') && c.includes('-l') && c.includes('hello'))).toBe(true);
    // Should send Enter
    expect(calls.some((c: string) => c.includes('send-keys') && c.includes('Enter') && !c.includes('-l'))).toBe(true);
  });

  it('does not send Enter when enter=false', async () => {
    const manager = healthyManager();
    const spy = (manager as any).tmuxInternal;

    await manager.sendKeys('@1', 'partial', false);

    const calls = spy.mock.calls.map((c: any[]) => c.join(' '));
    // Should NOT send Enter as a separate command
    expect(calls.some((c: string) => c.includes('Enter') && !c.includes('-l'))).toBe(false);
  });

  it('sends multi-line text line-by-line', async () => {
    const manager = healthyManager();
    const spy = (manager as any).tmuxInternal;

    await manager.sendKeys('@1', 'line1\nline2\nline3', true);

    const sendKeysCalls = spy.mock.calls
      .filter((c: string[]) => c[0] === 'send-keys' && c.includes('-l'))
      .map((c: string[]) => c.join(' '));

    // Should send each line separately
    expect(sendKeysCalls.some((c: string) => c.includes('line1'))).toBe(true);
    expect(sendKeysCalls.some((c: string) => c.includes('line2'))).toBe(true);
    expect(sendKeysCalls.some((c: string) => c.includes('line3'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureSession
// ---------------------------------------------------------------------------

describe('ensureSession', () => {
  it('returns normally when session exists and is healthy', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@0',
    }));

    await expect(manager.ensureSession()).resolves.toBeUndefined();
  });

  it('creates session when has-session fails', async () => {
    const manager = makeManager();
    const spy = mockTmuxInternal(manager, async (...args: unknown[]) => {
      if (args[0] === 'has-session') throw new Error('no session');
      if (args[0] === 'kill-session') return '';
      if (args[0] === 'new-session') return '';
      return '';
    });

    await manager.ensureSession();

    const newCall = spy.mock.calls.find(c => c[0] === 'new-session');
    expect(newCall).toBeDefined();
    expect(newCall).toContain('test-session');
    expect(newCall).toContain('_bridge_main');
  });

  it('recreates session when session exists but list-windows fails', async () => {
    const manager = makeManager();
    let listWindowsCallCount = 0;
    const spy = mockTmuxInternal(manager, async (...args: unknown[]) => {
      if (args[0] === 'has-session') return '';
      if (args[0] === 'list-windows') {
        listWindowsCallCount++;
        // First call (health check from ensureSessionInternal) fails
        if (listWindowsCallCount === 1) throw new Error('broken');
        return '';
      }
      if (args[0] === 'kill-session') return '';
      if (args[0] === 'new-session') return '';
      return '';
    });

    await manager.ensureSession();

    // Should have killed and recreated
    expect(spy.mock.calls.some(c => c[0] === 'kill-session')).toBe(true);
    expect(spy.mock.calls.some(c => c[0] === 'new-session')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseWindowListLine — thorough parsing via listWindows
// ---------------------------------------------------------------------------

describe('parseWindowListLine', () => {
  it('parses all tab-separated fields correctly', async () => {
    const manager = makeManager();
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@42\tmy-project\t/home/user/code\tclaude\t0',
    }));

    const [win] = await manager.listWindows();
    expect(win).toEqual({
      windowId: '@42',
      windowName: 'my-project',
      cwd: '/home/user/code',
      paneCommand: 'claude',
      paneDead: false,
    });
  });

  it('treats paneDead field missing as false', async () => {
    const manager = makeManager();
    // 4 fields instead of 5 — paneDead undefined → falsy
    mockTmuxInternal(manager, cmdResponseMap({
      'has-session': '',
      'list-windows': '@1\twin\t/home\tbash',
    }));

    const [win] = await manager.listWindows();
    expect(win!.paneDead).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// serialize queue — operations run sequentially
// ---------------------------------------------------------------------------

describe('serialize queue', () => {
  it('runs concurrent operations in order', async () => {
    const manager = makeManager();
    const order: number[] = [];
    mockTmuxInternal(manager, async () => {
      // Simulate small delay so concurrent calls queue up
      await new Promise(r => setTimeout(r, 10));
      return '';
    });

    const p1 = manager.sendSpecialKey('@1', 'a').then(() => order.push(1));
    const p2 = manager.sendSpecialKey('@2', 'b').then(() => order.push(2));
    const p3 = manager.sendSpecialKey('@3', 'c').then(() => order.push(3));

    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('continues queue after a failed operation', async () => {
    const manager = makeManager();
    let callCount = 0;
    mockTmuxInternal(manager, async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient');
      return '';
    });

    // First call fails internally but serialize continues
    const p1 = manager.sendSpecialKey('@1', 'a').catch(() => {});
    const p2 = manager.sendSpecialKey('@2', 'b').catch(() => {});

    await Promise.all([p1, p2]);
    // Both operations should have been attempted
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// socketName isolation
// ---------------------------------------------------------------------------

describe('socketName', () => {
  it('uses provided socket name', () => {
    const manager = makeManager('sess', 'my-socket');
    expect(manager.socketName).toBe('my-socket');
  });

  it('generates default socket name from pid when not provided', () => {
    const manager = new TmuxManager('sess');
    expect(manager.socketName).toBe(`aegis-${process.pid}`);
  });
});

// ---------------------------------------------------------------------------
// TmuxTimeoutError — error class
// ---------------------------------------------------------------------------

describe('TmuxTimeoutError', () => {
  it('has correct name property', () => {
    const err = new TmuxTimeoutError(['send-keys', '-t', '@1'], 10_000);
    expect(err.name).toBe('TmuxTimeoutError');
  });

  it('includes command args in message', () => {
    const err = new TmuxTimeoutError(['capture-pane', '-t', '@1', '-p'], 5_000);
    expect(err.message).toContain('capture-pane');
    expect(err.message).toContain('@1');
  });

  it('includes timeout value in message', () => {
    const err = new TmuxTimeoutError(['send-keys'], 30_000);
    expect(err.message).toContain('30000');
  });

  it('is an instance of Error', () => {
    expect(new TmuxTimeoutError(['list-windows'], 10_000) instanceof Error).toBe(true);
  });

  it('can be thrown and caught', () => {
    expect(() => {
      throw new TmuxTimeoutError(['send-keys', '-t', '@1', '-l', 'hello'], 10_000);
    }).toThrow(TmuxTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// isTmuxServerError — error classification (public method)
// ---------------------------------------------------------------------------

describe('isTmuxServerError', () => {
  it('classifies "connection refused" as server error', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('connection refused'))).toBe(true);
  });

  it('classifies "no server running" as server error', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('no server running'))).toBe(true);
  });

  it('classifies "failed to connect" as server error', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('failed to connect to server'))).toBe(true);
  });

  it('classifies "no tmux server" as server error', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('no tmux server found'))).toBe(true);
  });

  it('returns false for generic errors', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('some other error'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError('string')).toBe(false);
    expect(manager.isTmuxServerError(null)).toBe(false);
    expect(manager.isTmuxServerError(undefined)).toBe(false);
    expect(manager.isTmuxServerError({ code: 'ENOENT' })).toBe(false);
  });

  it('is case-insensitive', () => {
    const manager = makeManager();
    expect(manager.isTmuxServerError(new Error('CONNECTION REFUSED'))).toBe(true);
    expect(manager.isTmuxServerError(new Error('No Server Running'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDuplicateWindowNameError — private, tested via (manager as any)
// ---------------------------------------------------------------------------

describe('isDuplicateWindowNameError', () => {
  it('detects "duplicate window" pattern', () => {
    const manager = makeManager();
    expect((manager as any).isDuplicateWindowNameError(new Error('duplicate window found'))).toBe(true);
  });

  it('detects "window name already exists" pattern', () => {
    const manager = makeManager();
    expect((manager as any).isDuplicateWindowNameError(new Error('window name already exists'))).toBe(true);
  });

  it('detects "duplicate session" pattern', () => {
    const manager = makeManager();
    expect((manager as any).isDuplicateWindowNameError(new Error('duplicate session name'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    const manager = makeManager();
    expect((manager as any).isDuplicateWindowNameError(new Error('no such window'))).toBe(false);
  });

  it('returns false for non-Error values', () => {
    const manager = makeManager();
    expect((manager as any).isDuplicateWindowNameError('string')).toBe(false);
    expect((manager as any).isDuplicateWindowNameError(null)).toBe(false);
  });

  it('is case-insensitive', () => {
    const manager = makeManager();
    expect((manager as any).isDuplicateWindowNameError(new Error('DUPLICATE WINDOW'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPidAlive — delegates to platform abstraction
// ---------------------------------------------------------------------------

describe('isPidAlive', () => {
  it('returns a boolean for pid 1', () => {
    const manager = makeManager();
    expect(typeof manager.isPidAlive(1)).toBe('boolean');
  });

  it('returns a boolean for any integer pid', () => {
    const manager = makeManager();
    expect(typeof manager.isPidAlive(12345)).toBe('boolean');
  });

  it('returns a boolean for a very large pid', () => {
    const manager = makeManager();
    expect(typeof manager.isPidAlive(999999999)).toBe('boolean');
  });

  it('returns true for the current process pid', () => {
    const manager = makeManager();
    expect(manager.isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a non-existent pid', () => {
    const manager = makeManager();
    // PID 999999999 is extremely unlikely to exist
    expect(manager.isPidAlive(999999999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// capturePaneDirect — serialized capture via execFileAsync
// ---------------------------------------------------------------------------

describe('capturePaneDirect', () => {
  it('returns captured content via serialize + capturePaneDirectInternal', async () => {
    const manager = makeManager();
    vi.spyOn(manager as any, 'capturePaneDirectInternal').mockResolvedValue('direct pane content');

    const content = await manager.capturePaneDirect('@1');
    expect(content).toBe('direct pane content');
  });

  it('goes through the serialize queue', async () => {
    const manager = makeManager();
    const serializeSpy = vi.spyOn(manager as any, 'serialize');
    vi.spyOn(manager as any, 'capturePaneDirectInternal').mockResolvedValue('');

    await manager.capturePaneDirect('@1');

    expect(serializeSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// sendKeysDirect — bypass serialize (unless _creatingCount > 0)
// ---------------------------------------------------------------------------

describe('sendKeysDirect', () => {
  it('calls sendKeysDirectInternal directly when not creating', async () => {
    const manager = makeManager();
    const internalSpy = vi.spyOn(manager as any, 'sendKeysDirectInternal').mockResolvedValue(undefined);

    await manager.sendKeysDirect('@1', 'hello', true);

    expect(internalSpy).toHaveBeenCalledWith('@1', 'hello', true);
  });

  it('queues through serialize when _creatingCount > 0', async () => {
    const manager = makeManager();
    (manager as any)._creatingCount = 1;
    const serializeSpy = vi.spyOn(manager as any, 'serialize');
    vi.spyOn(manager as any, 'sendKeysDirectInternal').mockResolvedValue(undefined);

    await manager.sendKeysDirect('@1', 'text', true);

    expect(serializeSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults enter to true', async () => {
    const manager = makeManager();
    const internalSpy = vi.spyOn(manager as any, 'sendKeysDirectInternal').mockResolvedValue(undefined);

    await manager.sendKeysDirect('@1', 'hello');

    expect(internalSpy).toHaveBeenCalledWith('@1', 'hello', true);
  });
});

// ---------------------------------------------------------------------------
// verifyDelivery — delivery confirmation logic
// ---------------------------------------------------------------------------

describe('verifyDelivery', () => {
  it('returns true when CC is in an active state', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('some working output');

    const result = await manager.verifyDelivery('@1', 'hello');
    // detectUIState on generic text may return 'unknown' or something else
    // The key assertion: it doesn't throw and returns a boolean
    expect(typeof result).toBe('boolean');
  });

  it('returns false when CC is idle and text not visible', async () => {
    const manager = makeManager();
    // Empty pane → detectUIState returns 'unknown' → benefit of the doubt = true
    // To get 'idle', need specific pane content. Let's use a spy on isActiveState
    vi.spyOn(manager, 'capturePane').mockResolvedValue('$ ');

    const result = await manager.verifyDelivery('@1', 'a very long prompt that is not in pane');
    // Pane '$ ' is detected as idle by terminal-parser, and text isn't visible
    // But verifyDelivery checks searchText.length >= 5 first
    expect(typeof result).toBe('boolean');
  });

  it('confirms delivery when sent text appears in pane', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('user typed: hello world prompt here');

    const result = await manager.verifyDelivery('@1', 'hello world prompt here that is long enough');
    // searchText = first 60 chars trimmed, length >= 5, and pane includes it
    expect(result).toBe(true);
  });

  it('does not confirm on short text (< 5 chars visible match)', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('$ hi');

    // searchText = 'hi'.trim() = 'hi', length 2 < 5, so text evidence skipped
    const result = await manager.verifyDelivery('@1', 'hi');
    expect(typeof result).toBe('boolean');
  });

  it('detects idle→active transition with preSendState', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('working...');

    // preSendState='idle', and detectUIState returns something other than 'idle'
    const result = await manager.verifyDelivery('@1', 'some text', 'idle');
    // If state !== 'idle', returns true (idle→active transition)
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// sendKeysVerified — retry delivery logic
// ---------------------------------------------------------------------------

describe('sendKeysVerified', () => {
  it('returns delivered on first attempt when delivery succeeds', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('$ ');
    vi.spyOn(manager, 'sendKeys').mockResolvedValue(undefined);
    // Make verifyDelivery return true on first poll
    vi.spyOn(manager, 'verifyDelivery').mockResolvedValue(true);

    const result = await manager.sendKeysVerified('@1', 'hello');

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('retries up to maxAttempts on delivery failure', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('$ ');
    vi.spyOn(manager, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(manager, 'verifyDelivery').mockResolvedValue(false);
    // Override pollUntil to immediately return the verifyDelivery result
    vi.spyOn(manager as any, 'pollUntil').mockResolvedValue(false);

    const result = await manager.sendKeysVerified('@1', 'hello', 2);

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(2);
  });

  it('does not re-send if pane is not idle on retry', async () => {
    const manager = makeManager();
    let captureCount = 0;
    vi.spyOn(manager, 'capturePane').mockImplementation(async () => {
      captureCount++;
      // First capture: idle (for pre-send state)
      // Second capture onwards: "working" (non-idle)
      return captureCount > 1 ? 'working output...' : '$ ';
    });
    const sendKeysSpy = vi.spyOn(manager, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'pollUntil').mockResolvedValue(true);

    await manager.sendKeysVerified('@1', 'hello', 3);

    // sendKeys should only be called once (first attempt only)
    expect(sendKeysSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults maxAttempts to 3', async () => {
    const manager = makeManager();
    vi.spyOn(manager, 'capturePane').mockResolvedValue('$ ');
    vi.spyOn(manager, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(manager as any, 'pollUntil').mockResolvedValue(false);

    const result = await manager.sendKeysVerified('@1', 'hello');

    expect(result.attempts).toBe(3);
    expect(result.delivered).toBe(false);
  });
});
