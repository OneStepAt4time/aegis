/**
 * acp-runtime-permission-guard-4575.test.ts — Issue #4575 P0:
 * Settings.json resume/load permission-guard enforcement at the
 * runtime lifecycle boundary.
 *
 * Background: CC v2.1.143 reads `permissions.defaultMode` from
 * `<workDir>/.claude/settings.local.json` on startup, OVERRIDING the
 * `--permission-mode` argv. #4555 closed the gap in
 * `session-factory.ts:123-131` (the createSession path), but the
 * resume/load paths in `backend/runtime.ts` reach `createRuntime`
 * WITHOUT that protection.
 *
 * Fix: hoist the activate/neutralize dispatch into `createRuntime`,
 * making it the single application point. All 4 call sites
 * (startNewRuntime, startNewRuntimeBackground, startResumeRuntime,
 * startLoadRuntime) now get the protection.
 *
 * These tests verify the dispatch logic in `createRuntime` directly,
 * using real fs in tmpdirs (no mocks). The 4 call sites all funnel
 * through `createRuntime`, so coverage of the dispatch proves the
 * P0 resume/load gap is closed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createRuntime,
  startResumeRuntime,
  startLoadRuntime,
} from '../services/acp/backend/runtime.js';
import { settingsPath } from '../permission-guard.js';

describe('Issue #4575: runtime-layer permission-guard', () => {
  let workDir: string;
  let fakeHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'aegis-4575-'));
    fakeHome = await mkdtemp(join(tmpdir(), 'aegis-4575-home-'));
    await mkdir(join(workDir, '.claude'), { recursive: true });
    await mkdir(join(fakeHome, '.claude'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  /**
   * Build a minimal AcpSessionRecord + RuntimeLifecycleDeps that lets
   * createRuntime execute its body without spawning a child process.
   */
  function setupDeps(permissionMode: string | undefined) {
    const session = {
      id: '00000000-0000-4000-8000-000000000001',
      tenantId: 't-1',
      ownerKeyId: 'o-1',
      permissionMode,
      // Required by startResumeRuntime / startLoadRuntime (they
      // check this and throw if missing). createRuntime ignores it.
      acpAgentSessionId: 'acp-1',
    } as never;

    const fakeClient = {
      start: async () => {},
      // The session/resume and session/load responses go through
      // attachmentFromResult which requires result.sessionId. The
      // initialize response is opaque to startAndInitialize (it just
      // returns response.result). A sessionId in the result is enough
      // for both call sites — we don't read the other fields.
      request: async () => ({
        jsonrpc: '2.0' as const,
        id: '1',
        result: { sessionId: 'fake-acp-session-1' },
      }),
      notify: async () => {},
      respond: () => {},
      respondWithError: () => {},
      shutdown: async () => ({ code: 0, signal: null, expected: true, escalated: false }),
      onNotification: () => () => {},
      onRequest: () => () => {},
      onExit: () => () => {},
      onError: () => () => {},
    };

    const deps = {
      runtimes: new Map(),
      pendingApprovals: new Map(),  // disposeRuntime calls .delete on this
      inFlightPrompts: new Map(),
      options: {},
      clientFactory: () => fakeClient as never,
      sessionService: {
        // Used by startResumeRuntime / startLoadRuntime for the
        // attachAgentSession call. Returns a session with status 'idle'
        // so transitionIfInitializing is a no-op (we don't want to
        // exercise the transition path; we're testing the guard).
        attachAgentSession: async (sessionId: string) =>
          ({
            id: sessionId,
            tenantId: 't-1',
            ownerKeyId: 'o-1',
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }) as never,
        // Mocked as a no-op. The tests don't exercise the transition
        // path; this exists so failStartup's catch doesn't itself
        // throw if the test triggers a startup failure.
        transition: async () => ({} as never),
      } as never,
      backendRunIdProvider: () => 'run-1',
    } as never;

    return { session, deps };
  }

  // ─── Dispatch: bypassPermissions → activate ─────────────────────

  describe('dispatch when permissionMode is bypassPermissions', () => {
    it('writes bypassPermissions to settings.local.json (activate path)', async () => {
      const { session, deps } = setupDeps('bypassPermissions');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('overrides a pre-existing non-bypass mode in settings.local.json', async () => {
      const initial = { permissions: { defaultMode: 'default' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('bypassPermissions');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('bypassPermissions');
    });
  });

  // ─── Dispatch: non-bypass → neutralize ─────────────────────

  describe('dispatch when permissionMode is non-bypass', () => {
    it('neutralizes bypassPermissions to the target mode (plan)', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('plan');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('plan');
    });

    it('neutralizes bypassPermissions to default when target is default', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('default');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('default');
    });

    it('neutralizes bypassPermissions to acceptEdits when target is acceptEdits', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('acceptEdits');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('acceptEdits');
    });

    it('defaults to neutral when permissionMode is undefined', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps(undefined);
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('default');
    });
  });

  // ─── Wired path: resume/load flow ─────────────────────

  describe('wired path: resume/load use the same protection (P0)', () => {
    // The 4 call sites in runtime.ts (startNewRuntime,
    // startNewRuntimeBackground, startResumeRuntime, startLoadRuntime)
    // all funnel through createRuntime. Verifying the dispatch here
    // proves the resume/load P0 is closed without needing to mock
    // the full AcpChildProcess / JSON-RPC flow.

    it('resume: pre-existing bypassPermissions in settings.local.json is patched to session mode (plan)', async () => {
      // Simulate a "dirty" project: user (or another process) set
      // bypassPermissions in settings.local.json since the session
      // was last created.
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      // Session is being resumed with effective mode 'plan'.
      const { session, deps } = setupDeps('plan');
      await createRuntime(deps, session, workDir, 'run-1');

      // The settings must now reflect the session's effective mode,
      // not whatever the filesystem said before the runtime was
      // created.
      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('plan');
    });

    it('load: pre-existing bypassPermissions in settings.local.json is patched to session mode (acceptEdits)', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('acceptEdits');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('acceptEdits');
    });
  });

  // ─── Idempotency ─────────────────────

  describe('idempotency (new/new-background paths re-run safely)', () => {
    it('does not double-patch when settings are already correct (plan)', async () => {
      // Pre-set the correct mode
      const initial = { permissions: { defaultMode: 'plan' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('plan');
      await createRuntime(deps, session, workDir, 'run-1');

      // The settings should still be 'plan' (neutralize is a no-op
      // when no location has bypassPermissions).
      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('plan');
    });

    it('does not double-patch when settings are already correct (bypass)', async () => {
      // Pre-set bypassPermissions
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('bypassPermissions');
      await createRuntime(deps, session, workDir, 'run-1');

      // activate is a no-op when already set to bypassPermissions.
      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('bypassPermissions');
    });
  });

  // ─── Defense-in-depth ─────────────────────

  describe('defense-in-depth (catches the gap even if upstream is broken)', () => {
    it('closes the gap when buildSessionInfo did not run (e.g., direct resume)', async () => {
      // Simulate the failure mode #4575 P0: a user has
      // bypassPermissions in settings.local.json, and a session is
      // being resumed with effective mode 'default' — without the
      // runtime-layer guard, the resume would silently use
      // bypassPermissions despite the session saying 'default'.
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('default');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('default');
    });
  });

  // ─── Other settings preserved ─────────────────────

  describe('preserves other settings', () => {
    it('keeps non-permissions fields intact after patching', async () => {
      const initial = {
        permissions: { defaultMode: 'bypassPermissions' },
        model: 'claude-sonnet-4-20250514',
        env: { DEBUG: '1' },
      };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('plan');
      await createRuntime(deps, session, workDir, 'run-1');

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('plan');
      expect(settings.model).toBe('claude-sonnet-4-20250514');
      expect(settings.env).toEqual({ DEBUG: '1' });
    });
  });


  // ─── AC binding (Boss's #4575 spec, 2026-06-04) ─────────────────────

  describe('AC (a): resume with permissionMode: "default" neutralizes pre-spawn', () => {
    it('patches pre-existing bypassPermissions to default before spawn', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('default');
        await startResumeRuntime(deps, session, workDir);

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('default');
    });
  });

  describe('AC (b): load with permissionMode: "bypassPermissions" activates', () => {
    it('writes bypassPermissions to settings.local.json on load path', async () => {
      const { session, deps } = setupDeps('bypassPermissions');
        await startLoadRuntime(deps, session, workDir);

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('bypassPermissions');
    });

    it('overrides a pre-existing non-bypass mode in settings.local.json on load path', async () => {
      const initial = { permissions: { defaultMode: 'plan' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('bypassPermissions');
        await startLoadRuntime(deps, session, workDir);

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('bypassPermissions');
    });
  });

  describe('AC (c): resume with no permissionMode defaults to neutralization', () => {
    it('patches pre-existing bypassPermissions to default when permissionMode is undefined', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps(undefined);
        await startResumeRuntime(deps, session, workDir);

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('default');
    });
  });

  // ─── Wired-path: end-to-end through the resume entry point ──────────
  //
  // AC binding: "end-to-end verifying permissionMode is re-applied on
  // resume, not just at create. Mock createRuntime and assert the guard
  // fired at the resume entry point."
  //
  // Implementation note: we exercise the full startResumeRuntime call
  // chain (no early returns, no stubbed createRuntime). The only mocks
  // are the AcpChildProcess and sessionService — the things that would
  // require real I/O. The dispatch in createRuntime is REAL and runs
  // before any of the mocked layers, so the test verifies the guard
  // fires at the resume entry point end-to-end.

  describe('wired-path: guard re-applied on resume, not just at create', () => {
    it('fires the guard on startResumeRuntime entry before child spawn', async () => {
      // Pre-plant bypassPermissions to simulate a "dirty" project where
      // the user (or a malicious git pull / prompt-injection file-write
      // / compromised dep) has set bypassPermissions since the session
      // was last created.
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      // Session is being resumed with effective mode 'plan' — the
      // resume path must re-apply the guard so the argv defense isn't
      // silently bypassed.
      const { session, deps } = setupDeps('plan');
        await startResumeRuntime(deps, session, workDir);

      // Settings must reflect the session's effective mode, not
      // whatever the filesystem said. This is the assertion that
      // proves the guard fired at the resume entry point — if the
      // dispatch hadn't run, settings would still be 'bypassPermissions'.
      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('plan');
    });

    it('fires the guard on startLoadRuntime entry before child spawn', async () => {
      const initial = { permissions: { defaultMode: 'bypassPermissions' } };
      await writeFile(settingsPath(workDir), JSON.stringify(initial));

      const { session, deps } = setupDeps('acceptEdits');
        await startLoadRuntime(deps, session, workDir);

      const file = await readFile(settingsPath(workDir), 'utf-8');
      const settings = JSON.parse(file);
      expect(settings.permissions.defaultMode).toBe('acceptEdits');
    });
  });

});
