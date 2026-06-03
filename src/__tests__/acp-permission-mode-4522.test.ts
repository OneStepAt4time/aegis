/**
 * acp-permission-mode-4522.test.ts — Tests for Issue #4522 AC #3:
 * --permission-mode argv injection + --dangerously-skip-permissions assertion.
 */

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { AcpChildProcess, AcpChildProcessStartError } from '../services/acp/child-process.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-child-process.mjs');

describe('AC #3: --permission-mode argv injection (Issue #4522)', () => {
  it('injects --permission-mode <mode> into resolved args when permissionMode is set', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath, '--fixture-arg'],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'print-env' },
      permissionMode: 'bypassPermissions',
    });
    child.on('stdout', () => {});

    const started = await child.start();
    await child.waitForExit();

    expect(started.command.args).toContain('--permission-mode');
    expect(started.command.args).toContain('bypassPermissions');
    expect(started.command.args).toContain(fixturePath);
  });

  it('does not inject --permission-mode when permissionMode is unset', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath, '--fixture-arg'],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'print-env' },
    });
    child.on('stdout', () => {});

    const started = await child.start();
    await child.waitForExit();

    expect(started.command.args).not.toContain('--permission-mode');
  });

  it('does not double-inject --permission-mode if already present in args', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath, '--permission-mode', 'plan'],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'print-env' },
      permissionMode: 'default',
    });
    child.on('stdout', () => {});

    const started = await child.start();
    await child.waitForExit();

    const occurrences = started.command.args.filter((a) => a === '--permission-mode').length;
    expect(occurrences).toBe(1);
  });

  it('skips injection and logs warning for invalid permissionMode value', async () => {
    const child = new AcpChildProcess({
      command: process.execPath,
      args: [fixturePath, '--fixture-arg'],
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'print-env' },
      permissionMode: 'this-is-not-a-valid-mode',
    });
    child.on('stdout', () => {});

    const started = await child.start();
    await child.waitForExit();

    expect(started.command.args).not.toContain('--permission-mode');
  });

  it('rejects --dangerously-skip-permissions in resolved args (security boundary)', async () => {
    const child = new AcpChildProcess({
      resolvedCommand: {
        command: process.execPath,
        args: [fixturePath, '--dangerously-skip-permissions'],
        source: 'explicit',
      },
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'print-env' },
      permissionMode: 'default',
    });
    child.on('stdout', () => {});

    let thrown: unknown = null;
    try {
      await child.start();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AcpChildProcessStartError);
    expect((thrown as Error).message).toMatch(/--dangerously-skip-permissions is forbidden/);
  });
});
