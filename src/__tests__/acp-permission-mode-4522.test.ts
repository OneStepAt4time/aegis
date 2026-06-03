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

  // Document the boundary: exact-match is the correct behavior.
  // Variations should NOT trigger the assertion (only the exact flag name).
  it.each([
    ['--dangerously-skip-permissions=true', 'with =true suffix', false],
    ['--dangerously-skip-permissions=1', 'with =1 suffix', false],
    ['--Dangerously-Skip-Permissions', 'capitalized case', false],
    ['--DANGEROUSLY-SKIP-PERMISSIONS', 'uppercase', false],
    ['--dangerously-skip-permiss', 'partial / typo', false],
    ['--dangerously-skip-permissions', 'exact match (the threat)', true],
  ])('flag detection boundary: %s (%s) — should reject? %s', async (flag, _label, shouldReject) => {
    const child = new AcpChildProcess({
      resolvedCommand: {
        command: process.execPath,
        args: [fixturePath, flag],
        source: 'explicit',
      },
      cwd: process.cwd(),
      env: { FAKE_ACP_CHILD_MODE: 'print-env' },
      permissionMode: 'default',
    });
    child.on('stdout', () => {});
    child.on('stderr', () => {});

    if (shouldReject) {
      let thrown: unknown = null;
      try {
        await child.start();
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AcpChildProcessStartError);
      expect((thrown as Error).message).toMatch(/--dangerously-skip-permissions is forbidden/);
    } else {
      // Variation should NOT trigger — the spawn proceeds. The fixture exits cleanly.
      const started = await child.start();
      await child.waitForExit();
      // Sanity: no exception thrown, command started
      expect(started.pid).toEqual(expect.any(Number));
    }
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
