/**
 * acp-sendprompt-timeout-4705.test.ts
 *
 * Issue #4705: API /v1/sessions/:id/send accepts message but never forwards to CC runtime.
 *
 * Original fix (#4705): a session/prompt timeout → delivered:false (CC did not ack).
 * Revised 2026-06-26: empirically the request IS written to a live JSON-RPC pipe and
 * claude-agent-acp (single-threaded, in-order) processes it; the ack merely lags past
 * the window on idle/cold-resumed sessions, and the reply always appears in the
 * transcript. A dead pipe rejects with a transport error, never a timeout. So a
 * timeout is now treated as a slow ack, not a non-delivery.
 *
 * Acceptance criteria:
 * - Timeout on session/prompt → delivered: true (slow ack; transcript is source of truth)
 * - Actual error (e.g. -32601 Method not found) → thrown as AcpBackendLifecycleError
 * - Successful ack → delivered: true
 */

import { describe, expect, it } from 'vitest';

import {
  AcpBackend,
  type AcpBackendClient,
  type AcpBackendClientFactoryContext,
  type AcpBackendSessionService,
  type AcpCreateSessionInput,
  type AcpJsonRpcInboundRequest,
  type AcpJsonRpcNotification,
  type AcpJsonRpcId,
  type AcpJsonRpcRequestOptions,
  type AcpJsonRpcResponseError,
  type AcpJsonRpcSuccess,
  type AcpJsonValue,
  type AcpSessionRecord,
  type AcpSessionScope,
  type AcpSessionTransitionEvent,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

const cwd = '/tmp/test-workspace';

describe('Issue #4705: sendPrompt timeout handling', () => {
  it('returns delivered:true when session/prompt times out (slow ack, not non-delivery)', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-session-1' });
    // session/prompt will timeout — request was still written to a live pipe.
    client.setTimeout('session/prompt', 50);

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
    });

    await backend.createSession({ ...scope, cwd });

    const result = await backend.sendPrompt('session-1', 'hello', scope, cwd);

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
  }, 10000);

  it('returns delivered:true when session/prompt acks within timeout', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-session-1' });
    client.setResult('session/prompt', { ok: true });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
    });

    await backend.createSession({ ...scope, cwd });

    const result = await backend.sendPrompt('session-1', 'hello', scope, cwd);

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('throws on actual JSON-RPC error (not timeout)', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-session-1' });
    client.setError('session/prompt', { code: -32601, message: 'Method not found' });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
    });

    await backend.createSession({ ...scope, cwd });

    await expect(backend.sendPrompt('session-1', 'hello', scope, cwd)).rejects.toThrow('Method not found');
  });
});

/**
 * Direct sendPrompt: a session/prompt timeout on a live runtime surfaces as
 * delivered:true (the request was written to a live JSON-RPC pipe; the ack
 * merely lagged). This covers the continue-conversation case where an idle
 * session acks slowly — the dashboard must not show a false error toast.
 */
describe('sendPrompt timeout on a live runtime', () => {
  it('returns delivered:true when session/prompt times out', async () => {
    const client = new FakeBackendClient();
    client.setTimeout('session/prompt', 50);
    const runtime = { client } as unknown as import('../services/acp/backend/types.js').AcpBackendRuntime;
    const deps = {
      sessionService: { getSession: async () => ({ acpAgentSessionId: 'acp-agent-session-1' }) },
      inFlightPrompts: new Map<string, AbortController>(),
      pendingHandshakes: new Map<string, unknown>(),
    } as unknown as import('../services/acp/backend/prompts.js').PromptDeps;

    const { sendPrompt } = await import('../services/acp/backend/prompts.js');

    const result = await sendPrompt(deps, runtime, 'session-1', 'hello', scope);

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
  }, 10000);
});

// Fake client that supports timeout and error simulation
class FakeBackendClient implements AcpBackendClient {
  readonly requests: { method: string; params: AcpJsonValue | undefined }[] = [];
  readonly notifications = new Set<(notification: AcpJsonRpcNotification) => void>();
  readonly inboundRequests = new Set<(request: AcpJsonRpcInboundRequest) => void>();
  readonly exits = new Set<Parameters<AcpBackendClient['onExit']>[0]>();
  readonly errors = new Set<Parameters<AcpBackendClient['onError']>[0]>();
  readonly results = new Map<string, unknown>();
  readonly timeouts = new Map<string, number>();
  readonly rpcErrors = new Map<string, AcpJsonRpcResponseError>();
  readonly responses: { id: AcpJsonValue; result?: AcpJsonValue; error?: unknown }[] = [];
  started = 0;
  shutdowns = 0;

  setResult(method: string, result: unknown): void {
    this.results.set(method, result);
  }

  setTimeout(method: string, ms: number): void {
    this.timeouts.set(method, ms);
  }

  setError(method: string, error: AcpJsonRpcResponseError): void {
    this.rpcErrors.set(method, error);
  }

  async start(): Promise<void> {
    this.started += 1;
  }

  async request<T = AcpJsonValue>(
    method: string,
    params?: AcpJsonValue,
    options?: AcpJsonRpcRequestOptions
  ): Promise<AcpJsonRpcSuccess<T>> {
    this.requests.push({ method, params });

    const timeoutMs = this.timeouts.get(method);
    if (timeoutMs !== undefined) {
      await new Promise(_ => setTimeout(_, timeoutMs));
      const err = new Error(`Request timed out after ${timeoutMs}ms`);
      err.name = 'AcpJsonRpcTimeoutError';
      throw err;
    }

    const rpcError = this.rpcErrors.get(method);
    if (rpcError) {
      throw new Error(rpcError.message);
    }

    return {
      jsonrpc: '2.0',
      id: `${method}-request`,
      result: this.results.get(method) as T,
    };
  }

  async notify(_method: string, _params?: AcpJsonValue): Promise<void> {}

  async respond(id: AcpJsonRpcId, result: AcpJsonValue): Promise<void> {
    this.responses.push({ id, result });
  }

  async respondWithError(id: AcpJsonRpcId, error: AcpJsonRpcResponseError): Promise<void> {
    this.responses.push({ id, error });
  }

  async shutdown(): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    expected: boolean;
    escalated: boolean;
  }> {
    this.shutdowns += 1;
    return { code: 0, signal: null, expected: true, escalated: false };
  }

  onNotification(listener: (notification: AcpJsonRpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onRequest(listener: (request: AcpJsonRpcInboundRequest) => void): () => void {
    this.inboundRequests.add(listener);
    return () => this.inboundRequests.delete(listener);
  }

  onExit(listener: Parameters<AcpBackendClient['onExit']>[0]): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  onError(listener: Parameters<AcpBackendClient['onError']>[0]): () => void {
    this.errors.add(listener);
    return () => this.errors.delete(listener);
  }
}

class FakeSessionService implements AcpBackendSessionService {
  readonly records = new Map<string, AcpSessionRecord>();
  readonly createdInputs: AcpCreateSessionInput[] = [];
  readonly attachments: unknown[] = [];
  readonly transitions: unknown[] = [];
  readonly restartRecords: unknown[] = [];

  constructor() {
    this.records.set('session-1', {
      id: 'session-1',
      conversationId: 'conv-1',
      transcriptId: 'transcript-1',
      acpAgentSessionId: undefined,
      status: "initializing" as const, createdAt: Date.now(), updatedAt: Date.now(),
      ...scope,
    });
  }

  async createSession(input: AcpCreateSessionInput): Promise<AcpSessionRecord> {
    this.createdInputs.push(input);
    return this.records.get('session-1')!;
  }

  async getSession(sessionId: string, _scope: AcpSessionScope): Promise<AcpSessionRecord> {
    const record = this.records.get(sessionId);
    if (!record) throw new Error(`Session ${sessionId} not found`);
    return record;
  }

  async attachAgentSession(
    sessionId: string,
    _scope: AcpSessionScope,
    attachment: { acpAgentSessionId?: string; claudeSessionId?: string; backendRunId?: string }
  ): Promise<AcpSessionRecord> {
    const record = this.records.get(sessionId)!;
    record.acpAgentSessionId = attachment.acpAgentSessionId;
    record.currentBackendRunId = attachment.backendRunId;
    record.status = 'running';
    this.attachments.push({ sessionId, attachment });
    return record;
  }

  async transition(
    sessionId: string,
    _scope: AcpSessionScope,
    event: AcpSessionTransitionEvent
  ): Promise<AcpSessionRecord> {
    const record = this.records.get(sessionId)!;
    if (event.type === 'agent_ready') record.status = 'running';
    if (event.type === 'runtime_failed') record.status = 'failed';
    if (event.type === 'close_completed') record.status = 'closed';
    this.transitions.push({ sessionId, event });
    return record;
  }

  async recordBackendRestart(
    sessionId: string,
    _scope: AcpSessionScope,
    backendRunId?: string
  ): Promise<AcpSessionRecord> {
    const record = this.records.get(sessionId)!;
    record.currentBackendRunId = backendRunId;
    this.restartRecords.push({ sessionId, backendRunId });
    return record;
  }
}
