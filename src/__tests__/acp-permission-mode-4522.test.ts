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

  // Document the boundary: case-insensitive exact-match + the =value form
  // (per Themis's re-review). 4 case/value variations now REJECT (defense in
  // depth). 1 partial / typo is still NOT rejected because it's a prefix,
  // not the full flag name (would risk false-positive on a hypothetical
  // future flag like --dangerously-skip-permissions-disabled).
  it.each([
    ['--dangerously-skip-permissions=true', 'with =true suffix (value form)', true],
    ['--dangerously-skip-permissions=1', 'with =1 suffix (value form)', true],
    ['--Dangerously-Skip-Permissions', 'capitalized case', true],
    ['--DANGEROUSLY-SKIP-PERMISSIONS', 'uppercase', true],
    ['--dangerously-skip-permiss', 'partial / typo (prefix, not the full flag)', false],
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

  // WIRED-PATH TEST (Issue #4522 AC #3, per Themis's re-review):
  // Verify that session.permissionMode actually flows from createRuntime's
  // context into the AcpChildProcess constructor. Without this wiring, the
  // helper-level permissionMode injection is dead code in production.
  it('wired path: session.permissionMode propagates from createRuntime context to AcpChildProcess', async () => {
    const { createRuntime } = await import('../services/acp/backend/runtime.js');

    const session = {
      id: '00000000-0000-4000-8000-000000000001',
      conversationId: 'conv-1',
      transcriptId: 'trans-1',
      tenantId: 't-1',
      ownerKeyId: 'o-1',
      status: 'initializing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      permissionMode: 'bypassPermissions',  // the session has a permission mode
    } as const;

    // Capture the context the clientFactory receives
    let capturedContext: unknown = null;
    const fakeClient = {
      start: async () => {},
      request: async () => ({ jsonrpc: '2.0' as const, id: '1', result: {} }),
      notify: async () => {},
      respond: () => {},
      respondWithError: () => {},
      shutdown: async () => ({ code: 0, signal: null, expected: true, escalated: false }),
      onNotification: () => () => {},
      onRequest: () => () => {},
      onExit: () => () => {},
      onError: () => () => {},
    };

    const fakeDeps = {
      runtimes: new Map(),
      options: {},
      clientFactory: (ctx: unknown) => { capturedContext = ctx; return fakeClient as never; },
      sessionService: {} as never,
      backendRunIdProvider: () => 'run-1',
    } as never;

    createRuntime(fakeDeps, session, '/tmp/test', 'run-1');

    expect(capturedContext).not.toBeNull();
    expect((capturedContext as { permissionMode?: string }).permissionMode).toBe('bypassPermissions');
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
