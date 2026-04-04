/**
 * tmux-race-403.test.ts — Test that concurrent createWindow calls with the
 * same name do not cause duplicate windows (Issue #403).
 *
 * The fix moves ensureSession + mkdir + name-check + creation inside a single
 * serialize() scope and converts _creating boolean to a reference counter.
 */

import { describe, it, expect, vi } from 'vitest';
import { TmuxManager } from '../tmux.js';

/** Replicate the serialize() promise-chain pattern from TmuxManager. */
function createSerializeQueue() {
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

  return { serialize };
}

describe('createWindow race condition (Issue #403)', () => {
  it('concurrent createWindow calls with same name produce unique names', async () => {
    const { serialize } = createSerializeQueue();
    const windows = new Set<string>();
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const createWindow = async (name: string) => {
      return serialize(async () => {
        let finalName = name;
        let counter = 2;
        while (windows.has(finalName)) {
          finalName = `${name}-${counter++}`;
        }
        await delay(10);
        windows.add(finalName);
        return finalName;
      });
    };

    const results = await Promise.all([
      createWindow('task'),
      createWindow('task'),
      createWindow('task'),
    ]);

    expect(new Set(results).size).toBe(3);
    expect(results).toContain('task');
    expect(results).toContain('task-2');
    expect(results).toContain('task-3');
  });

  it('_creatingCount stays > 0 while multiple createWindow calls are in flight', async () => {
    const { serialize } = createSerializeQueue();
    let creatingCount = 0;
    const snapshots: number[] = [];
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const createWindow = async (name: string) => {
      creatingCount++;
      try {
        return await serialize(async () => {
          snapshots.push(creatingCount);
          await delay(20);
          return name;
        });
      } finally {
        creatingCount--;
      }
    };

    await Promise.all([
      createWindow('w1'),
      createWindow('w2'),
      createWindow('w3'),
    ]);

    // Each serialized block should see creatingCount > 0 at the time it runs
    // (not the stale value from before concurrent calls started)
    for (const snap of snapshots) {
      expect(snap).toBeGreaterThanOrEqual(1);
    }

    // After all complete, counter returns to 0
    expect(creatingCount).toBe(0);
  });

  it('boolean _creating flag would be prematurely cleared by first completion', async () => {
    // Demonstrates the OLD bug: using a boolean flag, the first call to
    // complete sets _creating = false, even though the second call is still
    // in flight. This would allow direct methods (capturePaneDirect,
    // sendKeysDirect) to skip the serialize queue.
    let creating = false;
    const snapshots: boolean[] = [];
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const createWindowOld = async () => {
      creating = true;
      try {
        await delay(10);
      } finally {
        creating = false;
      }
    };

    // Start two concurrent calls
    const p1 = createWindowOld();
    // Small delay to ensure p1 has started
    await delay(5);
    const p2 = createWindowOld();

    // Wait for first to finish — it sets creating = false
    await p1;

    // Second is still in flight, but creating is now false!
    snapshots.push(creating);

    await p2;

    // The snapshot taken between p1 finishing and p2 finishing shows false
    // even though p2 is still "creating" — this is the bug.
    expect(snapshots[0]).toBe(false);
  });

  it('_creatingCount correctly reflects in-flight operations after first completes', async () => {
    // Demonstrates the FIX: counter stays > 0 until ALL createWindow calls finish.
    let creatingCount = 0;
    const snapshots: number[] = [];
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const createWindowNew = async () => {
      creatingCount++;
      try {
        await delay(10);
      } finally {
        creatingCount--;
      }
    };

    const p1 = createWindowNew();
    await delay(5);
    const p2 = createWindowNew();

    await p1;

    // p2 is still in flight — counter should be 1, not 0
    snapshots.push(creatingCount);

    await p2;

    expect(snapshots[0]).toBe(1);
    expect(creatingCount).toBe(0);
  });

  it('ensureSession + mkdir + name-check inside serialize is atomic', async () => {
    const { serialize } = createSerializeQueue();
    const windows = new Set<string>();
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const order: string[] = [];
    let callId = 0;

    const createWindow = async (name: string) => {
      const id = ++callId;
      return serialize(async () => {
        // ensureSession (simulated)
        order.push(`ensureSession:${id}`);
        await delay(5);

        // mkdir (simulated)
        order.push(`mkdir:${id}`);
        await delay(5);

        // name collision check
        let finalName = name;
        let counter = 2;
        while (windows.has(finalName)) {
          finalName = `${name}-${counter++}`;
        }

        // create window
        order.push(`create:${id}:${finalName}`);
        await delay(5);
        windows.add(finalName);
        return finalName;
      });
    };

    const results = await Promise.all([
      createWindow('task'),
      createWindow('task'),
    ]);

    // All steps for call 1 must complete before call 2 starts
    // (no interleaving of ensureSession/mkdir/check/create between calls)
    const call1Create = order.indexOf('create:1:task');
    const call2Ensure = order.indexOf('ensureSession:2');

    // Call 2's ensureSession happens AFTER call 1's create
    expect(call2Ensure).toBeGreaterThan(call1Create);

    expect(results).toContain('task');
    expect(results).toContain('task-2');
  });

  it('TmuxManager.createWindow returns deterministic unique names for concurrent calls', async () => {
    const tmux = new TmuxManager('race-session', 'race-socket');
    const windows = new Map<string, string>();
    let nextId = 1;

    vi.spyOn(tmux, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(tmux as any, 'tmuxInternal').mockImplementation(async (...args: unknown[]) => {
      const [cmd, ...rest] = args as string[];

      if (cmd === 'has-session') return '';
      if (cmd === 'new-session') return '';
      if ((cmd === 'set-option' && rest.includes('-w')) || cmd === 'select-pane') return '';

      if (cmd === 'list-windows') {
        return [...windows.entries()]
          .map(([name, id]) => `${id}\t${name}\t/tmp\tnode`)
          .join('\n');
      }

      if (cmd === 'new-window') {
        const name = rest[rest.indexOf('-n') + 1]!;
        if (windows.has(name)) {
          throw new Error(`duplicate window: ${name}`);
        }
        windows.set(name, `@${nextId++}`);
        return '';
      }

      if (cmd === 'display-message') {
        const target = rest[rest.indexOf('-t') + 1]!;
        const name = target.split(':')[1]!;
        const id = windows.get(name);
        if (!id) throw new Error(`can't find window: ${name}`);
        return id;
      }

      if (cmd === 'kill-window') {
        const target = rest[rest.indexOf('-t') + 1]!;
        const name = target.split(':')[1]!;
        windows.delete(name);
        return '';
      }

      throw new Error(`unexpected tmux command in test: ${cmd}`);
    });

    const [first, second, third] = await Promise.all([
      tmux.createWindow({ workDir: '/tmp/race', windowName: 'task', claudeCommand: 'claude --version' }),
      tmux.createWindow({ workDir: '/tmp/race', windowName: 'task', claudeCommand: 'claude --version' }),
      tmux.createWindow({ workDir: '/tmp/race', windowName: 'task', claudeCommand: 'claude --version' }),
    ]);

    expect(first.windowName).toBe('task');
    expect(second.windowName).toBe('task-2');
    expect(third.windowName).toBe('task-3');
    expect(new Set([first.windowName, second.windowName, third.windowName]).size).toBe(3);
  });

  it('TmuxManager.createWindow recovers when duplicate appears between check and create', async () => {
    const tmux = new TmuxManager('race-session', 'race-socket');
    const windows = new Map<string, string>();
    let nextId = 1;
    let injectExternalCollision = true;

    vi.spyOn(tmux, 'sendKeys').mockResolvedValue(undefined);
    vi.spyOn(tmux as any, 'tmuxInternal').mockImplementation(async (...args: unknown[]) => {
      const [cmd, ...rest] = args as string[];

      if (cmd === 'has-session') return '';
      if (cmd === 'new-session') return '';
      if ((cmd === 'set-option' && rest.includes('-w')) || cmd === 'select-pane') return '';

      if (cmd === 'list-windows') {
        return [...windows.entries()]
          .map(([name, id]) => `${id}\t${name}\t/tmp\tnode`)
          .join('\n');
      }

      if (cmd === 'new-window') {
        const name = rest[rest.indexOf('-n') + 1]!;
        if (injectExternalCollision && name === 'task') {
          injectExternalCollision = false;
          windows.set('task', '@999'); // Simulate external creator winning the race.
          throw new Error('duplicate window: task');
        }
        if (windows.has(name)) {
          throw new Error(`duplicate window: ${name}`);
        }
        windows.set(name, `@${nextId++}`);
        return '';
      }

      if (cmd === 'display-message') {
        const target = rest[rest.indexOf('-t') + 1]!;
        const name = target.split(':')[1]!;
        const id = windows.get(name);
        if (!id) throw new Error(`can't find window: ${name}`);
        return id;
      }

      if (cmd === 'kill-window') {
        const target = rest[rest.indexOf('-t') + 1]!;
        const name = target.split(':')[1]!;
        windows.delete(name);
        return '';
      }

      throw new Error(`unexpected tmux command in test: ${cmd}`);
    });

    const created = await tmux.createWindow({
      workDir: '/tmp/race',
      windowName: 'task',
      claudeCommand: 'claude --version',
    });

    expect(created.windowName).toBe('task-2');
    expect(windows.has('task')).toBe(true);
    expect(windows.has('task-2')).toBe(true);
  });
});
