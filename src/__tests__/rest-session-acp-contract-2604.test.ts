/**
 * rest-session-acp-contract-2604.test.ts — ACP-061 REST session route redaction contracts.
 */

import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    execFile: (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      cb(null, { stdout: 'Claude Code 2.1.80\n', stderr: '' });
    },
  };
});

import { SYSTEM_TENANT } from '../config.js';
import { registerSessionRoutes } from '../routes/sessions.js';
import type { RouteContext } from '../routes/context.js';

const SESSION_ID = '00000000-0000-4000-8000-000000002604';
const NOW = 1_800_000_000_000;

const acpBackedSession = {
  id: SESSION_ID,
  windowId: '@2604',
  displayName: 'ACP Route Contract',
  hookSecret: 'must-not-leak',
  hookSettingsFile: 'D:\\aegis\\.session-hooks\\secret.json',
  workDir: 'D:\\aegis',
  claudeSessionId: 'claude-session-2604',
  jsonlPath: 'D:\\aegis\\.state\\transcript.jsonl',
  byteOffset: 10,
  monitorOffset: 20,
  status: 'working',
  createdAt: NOW - 1_000,
  lastActivity: NOW,
  stallThresholdMs: 300_000,
  permissionMode: 'default',
  parentId: '00000000-0000-4000-8000-000000000001',
};

function buildApp(options: { reuseExisting?: boolean } = {}) {
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (req) => {
    req.authKeyId = null;
    req.tenantId = SYSTEM_TENANT;
  });

  const sessions = {
    listSessions: vi.fn(() => [acpBackedSession]),
    getSession: vi.fn((id: string) => id === SESSION_ID ? acpBackedSession : undefined),
    getPendingPermissionInfo: vi.fn(() => undefined),
    getPendingQuestionInfo: vi.fn(() => undefined),
    findIdleSessionByWorkDir: vi.fn(async () => options.reuseExisting ? acpBackedSession : null),
    releaseSessionClaim: vi.fn(),
    createSession: vi.fn(async () => acpBackedSession),
    sendInitialPrompt: vi.fn(async () => ({ delivered: true, attempts: 1 })),
    getHealth: vi.fn(),
    killSession: vi.fn(),
  };
  const ctx = {
    sessions,
    auth: { authEnabled: false },
    quotas: { checkSessionQuota: () => ({ allowed: true }) },
    config: {
      envDenylist: [],
      envAdminAllowlist: [],
      tenantWorkdirs: {},
    },
    metrics: {
      sessionCreated: vi.fn(),
      promptSent: vi.fn(),
      getStats: vi.fn(() => ({ totalCreated: 1, totalCompleted: 0, totalFailed: 0 })),
    },
    monitor: {},
    eventBus: { emitEnded: vi.fn() },
    channels: {
      sessionCreated: vi.fn(async () => undefined),
      sessionEnded: vi.fn(async () => undefined),
    },
    memoryBridge: null,
    toolRegistry: {},
    getAuditLogger: () => undefined,
    validateWorkDir: async (workDir: string) => workDir,
  } as unknown as RouteContext;

  registerSessionRoutes(app, ctx);
  return { app, sessions };
}

function expectPublicSessionContract(session: Record<string, unknown>): void {
  expect(session).toMatchObject({
    id: SESSION_ID,
    displayName: 'ACP Route Contract',
    workDir: 'D:\\aegis',
    claudeSessionId: 'claude-session-2604',
    parentId: '00000000-0000-4000-8000-000000000001',
  });
  expect(session).not.toHaveProperty('windowId');
  expect(session).not.toHaveProperty('hookSecret');
  expect(session).not.toHaveProperty('hookSettingsFile');
}

describe('ACP-061 REST session route redaction contracts', () => {
  it('redacts hook internals from list, get, and create route responses', async () => {
    const { app } = buildApp();
    try {
      const listResponse = await app.inject({ method: 'GET', url: '/v1/sessions' });
      expect(listResponse.statusCode).toBe(200);
      const listBody = listResponse.json<{ sessions: Record<string, unknown>[] }>();
      expectPublicSessionContract(listBody.sessions[0]);

      const getResponse = await app.inject({ method: 'GET', url: `/v1/sessions/${SESSION_ID}` });
      expect(getResponse.statusCode).toBe(200);
      expectPublicSessionContract(getResponse.json<Record<string, unknown>>());

      const createResponse = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        payload: { workDir: 'D:\\aegis' },
      });
      expect(createResponse.statusCode).toBe(201);
      expectPublicSessionContract(createResponse.json<Record<string, unknown>>());
    } finally {
      await app.close();
    }
  });

  it('redacts hook internals when create reuses an existing idle session', async () => {
    const { app, sessions } = buildApp({ reuseExisting: true });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/sessions',
        payload: { workDir: 'D:\\aegis', prompt: 'continue ACP-061' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(body.reused).toBe(true);
      expect(body.promptDelivery).toEqual({ delivered: true, attempts: 1 });
      expectPublicSessionContract(body);
      expect(sessions.sendInitialPrompt).toHaveBeenCalledWith(SESSION_ID, 'continue ACP-061');
      expect(sessions.releaseSessionClaim).toHaveBeenCalledWith(SESSION_ID);
    } finally {
      await app.close();
    }
  });
});
