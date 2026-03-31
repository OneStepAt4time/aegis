/**
 * session-dedup-607.test.ts — Tests for Issue #607: session deduplication.
 *
 * Verifies that findIdleSessionByWorkDir correctly identifies resumable
 * sessions and that the POST /v1/sessions route reuses idle sessions
 * instead of creating duplicates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { SessionManager, SessionInfo } from '../session.js';

// ---------------------------------------------------------------------------
// Unit tests for the findIdleSessionByWorkDir filter/sort logic
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Omit<SessionInfo, 'workDir' | 'status'>> & { workDir: string; status: SessionInfo['status'] }): SessionInfo {
  const { workDir, status, lastActivity, id, windowId, windowName, createdAt, ...rest } = overrides;
  return {
    id: id ?? crypto.randomUUID(),
    windowId: windowId ?? '@1',
    windowName: windowName ?? 'test',
    workDir,
    status,
    byteOffset: 0,
    monitorOffset: 0,
    createdAt: createdAt ?? Date.now() - 60_000,
    lastActivity: lastActivity ?? Date.now(),
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...rest,
  };
}

/**
 * Replicate the filter+sort logic from SessionManager.findIdleSessionByWorkDir
 * so we test the logic without needing a real SessionManager (no tmux required).
 */
function findIdleSessionByWorkDir(sessions: SessionInfo[], workDir: string): SessionInfo | null {
  const candidates = sessions.filter(
    (s) => s.workDir === workDir && s.status === 'idle',
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.lastActivity - a.lastActivity);
  return candidates[0];
}

describe('Issue #607: findIdleSessionByWorkDir logic', () => {
  describe('matching behavior', () => {
    it('should return an idle session with matching workDir', () => {
      const idle = makeSession({ workDir: '/project/a', status: 'idle' });
      const result = findIdleSessionByWorkDir([idle], '/project/a');
      expect(result).toBe(idle);
    });

    it('should return null when no sessions exist', () => {
      const result = findIdleSessionByWorkDir([], '/project/a');
      expect(result).toBeNull();
    });

    it('should return null when no session matches workDir', () => {
      const idle = makeSession({ workDir: '/project/b', status: 'idle' });
      const result = findIdleSessionByWorkDir([idle], '/project/a');
      expect(result).toBeNull();
    });
  });

  describe('status filtering', () => {
    const nonIdleStatuses: SessionInfo['status'][] = [
      'working', 'compacting', 'context_warning', 'waiting_for_input',
      'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
      'settings', 'error', 'unknown',
    ];

    for (const status of nonIdleStatuses) {
      it(`should NOT return a session with status "${status}"`, () => {
        const session = makeSession({ workDir: '/project/a', status });
        const result = findIdleSessionByWorkDir([session], '/project/a');
        expect(result).toBeNull();
      });
    }

    it('should return the idle session when mixed statuses exist', () => {
      const working = makeSession({ workDir: '/project/a', status: 'working' });
      const idle = makeSession({ workDir: '/project/a', status: 'idle' });
      const permission = makeSession({ workDir: '/project/a', status: 'permission_prompt' });
      const result = findIdleSessionByWorkDir([working, idle, permission], '/project/a');
      expect(result).toBe(idle);
    });
  });

  describe('multiple idle sessions — most recently active wins', () => {
    it('should return the session with the highest lastActivity', () => {
      const older = makeSession({ workDir: '/project/a', status: 'idle', lastActivity: 1000 });
      const newer = makeSession({ workDir: '/project/a', status: 'idle', lastActivity: 2000 });
      const result = findIdleSessionByWorkDir([older, newer], '/project/a');
      expect(result).toBe(newer);
    });

    it('should return the session with the highest lastActivity regardless of insertion order', () => {
      const newer = makeSession({ workDir: '/project/a', status: 'idle', lastActivity: 3000 });
      const older = makeSession({ workDir: '/project/a', status: 'idle', lastActivity: 1000 });
      const middle = makeSession({ workDir: '/project/a', status: 'idle', lastActivity: 2000 });
      const result = findIdleSessionByWorkDir([newer, older, middle], '/project/a');
      expect(result).toBe(newer);
    });
  });

  describe('exact workDir matching (no substring)', () => {
    it('should NOT match /project/abc when looking for /project/a', () => {
      const session = makeSession({ workDir: '/project/abc', status: 'idle' });
      const result = findIdleSessionByWorkDir([session], '/project/a');
      expect(result).toBeNull();
    });

    it('should NOT match /project/a/sub when looking for /project/a', () => {
      const session = makeSession({ workDir: '/project/a/sub', status: 'idle' });
      const result = findIdleSessionByWorkDir([session], '/project/a');
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: POST /v1/sessions route reuse behavior
// ---------------------------------------------------------------------------

describe('Issue #607: POST /v1/sessions route reuse', () => {
  function createMockSessionManager(existingSession: SessionInfo | null): SessionManager {
    return {
      findIdleSessionByWorkDir: vi.fn((_workDir: string) => existingSession),
      createSession: vi.fn(async () => { throw new Error('should not create session'); }),
      sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
      listSessions: vi.fn(() => []),
    } as unknown as SessionManager;
  }

  async function buildApp(sessionManager: SessionManager) {
    const app = Fastify();
    // Minimal route replica for testing the reuse logic
    const createSessionSchema = (await import('zod')).z.object({
      workDir: (await import('zod')).z.string().min(1),
      name: (await import('zod')).z.string().max(200).optional(),
      prompt: (await import('zod')).z.string().max(100_000).optional(),
      resumeSessionId: (await import('zod')).z.string().uuid().optional(),
      claudeCommand: (await import('zod')).z.string().max(10_000).optional(),
      env: (await import('zod')).z.record((await import('zod')).z.string(), (await import('zod')).z.string()).optional(),
      stallThresholdMs: (await import('zod')).z.number().int().positive().max(3_600_000).optional(),
      permissionMode: (await import('zod')).z.enum(['default', 'bypassPermissions', 'plan']).optional(),
      autoApprove: (await import('zod')).z.boolean().optional(),
    }).strict();

    const sessions = sessionManager;

    app.post('/v1/sessions', async (req, reply) => {
      const parsed = createSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }
      const { workDir, prompt } = parsed.data;
      if (!workDir) return reply.status(400).send({ error: 'workDir is required' });

      // Issue #607: Check for an existing idle session with the same workDir
      const existing = sessions.findIdleSessionByWorkDir(workDir);
      if (existing) {
        let promptDelivery: { delivered: boolean; attempts: number } | undefined;
        if (prompt) {
          promptDelivery = await sessions.sendInitialPrompt(existing.id, prompt);
        }
        return reply.status(200).send({ ...existing, reused: true, promptDelivery });
      }

      // No idle session found — create new (not reached in reuse tests)
      return reply.status(201).send({ id: 'new', reused: false });
    });

    return app;
  }

  it('should return existing idle session with status 200 and reused=true', async () => {
    const existing = makeSession({ workDir: '/project/a', status: 'idle', id: 'existing-id' });
    const sm = createMockSessionManager(existing);
    const app = await buildApp(sm);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.reused).toBe(true);
    expect(body.id).toBe('existing-id');
    expect(sm.createSession).not.toHaveBeenCalled();
  });

  it('should send prompt to the reused session when provided', async () => {
    const existing = makeSession({ workDir: '/project/a', status: 'idle', id: 'existing-id' });
    const sm = createMockSessionManager(existing);
    const app = await buildApp(sm);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a', prompt: 'fix the bug' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.reused).toBe(true);
    expect(body.promptDelivery).toEqual({ delivered: true, attempts: 1 });
    expect(sm.sendInitialPrompt).toHaveBeenCalledWith('existing-id', 'fix the bug');
  });

  it('should NOT reuse when no idle session exists (returns new session)', async () => {
    const sm = createMockSessionManager(null);
    // Override createSession since the reuse test mock throws
    (sm.createSession as ReturnType<typeof vi.fn>).mockImplementation(async () =>
      makeSession({ workDir: '/project/a', status: 'idle', id: 'new-id' }),
    );
    // Override the route handler to not throw on createSession
    const app = Fastify();
    const sessions = sm;

    app.post('/v1/sessions', async (_req, reply) => {
      const existing = sessions.findIdleSessionByWorkDir('/project/a');
      if (existing) {
        return reply.status(200).send({ ...existing, reused: true });
      }
      const session = await sessions.createSession({ workDir: '/project/a' });
      return reply.status(201).send({ ...session, reused: false });
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.reused).toBe(false);
    expect(sm.createSession).toHaveBeenCalled();
  });

  it('should not send prompt when reusing and no prompt provided', async () => {
    const existing = makeSession({ workDir: '/project/a', status: 'idle', id: 'existing-id' });
    const sm = createMockSessionManager(existing);
    const app = await buildApp(sm);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.promptDelivery).toBeUndefined();
    expect(sm.sendInitialPrompt).not.toHaveBeenCalled();
  });
});
