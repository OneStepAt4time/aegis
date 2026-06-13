/**
 * acp-sendprompt-auto-resume-4695.test.ts
 *
 * Issue #4695: Auto-resume runtime on sendPrompt when inactive.
 *
 * Acceptance criteria:
 * - sendPrompt to idle session → resume + deliver
 * - delivered: true on success
 * - Clean error if not resumable
 * - Active sessions: no resume attempt (regression)
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

describe('Issue #4695: sendPrompt auto-resume', () => {
  it('attempts auto-resume when runtime is not active', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/resume', { sessionId: 'acp-agent-session-1' });
    client.setResult('session/prompt', { ok: true });

    // Session has acpAgentSessionId → resumable
    service.records.set('session-1', {
      id: 'session-1',
      conversationId: 'conv-1',
      transcriptId: 'transcript-1',
      acpAgentSessionId: 'acp-agent-session-1',
      status: "idle" as const, createdAt: Date.now(), updatedAt: Date.now(),
      ...scope,
    });

    let factoryCallCount = 0;
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: (ctx: AcpBackendClientFactoryContext) => {
        factoryCallCount++;
        return client;
      },
      backendRunIdProvider: () => 'backend-run-1',
    });

    // No active runtime — should auto-resume
    const result = await backend.sendPrompt('session-1', 'hello', scope, cwd);

    expect(result.delivered).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.error).toBeUndefined();
    // Factory was called to create a new runtime for resume
    expect(factoryCallCount).toBeGreaterThan(0);
    // session/resume was called
    expect(client.requests.some(r => r.method === 'session/resume')).toBe(true);
    // session/prompt was called after resume
    expect(client.requests.some(r => r.method === 'session/prompt')).toBe(true);
  });

  it('returns no_agent_session when session has no acpAgentSessionId', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();

    // Session without acpAgentSessionId → not resumable
    service.records.set('session-2', {
      id: 'session-2',
      conversationId: 'conv-2',
      transcriptId: 'transcript-2',
      acpAgentSessionId: undefined,
      status: "idle" as const, createdAt: Date.now(), updatedAt: Date.now(),
      ...scope,
    });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
    });

    const result = await backend.sendPrompt('session-2', 'hello', scope, cwd);

    expect(result.delivered).toBe(false);
    expect(result.error).toBe('no_acp_runtime');
    // No resume attempt
    expect(client.requests.some(r => r.method === 'session/resume')).toBe(false);
  });

  it('returns no_acp_runtime when cwd is not provided', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();

    service.records.set('session-3', {
      id: 'session-3',
      conversationId: 'conv-3',
      transcriptId: 'transcript-3',
      acpAgentSessionId: 'acp-agent-session-3',
      status: "idle" as const, createdAt: Date.now(), updatedAt: Date.now(),
      ...scope,
    });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
    });

    // No cwd → cannot resume
    const result = await backend.sendPrompt('session-3', 'hello', scope);

    expect(result.delivered).toBe(false);
    expect(result.error).toBe('no_acp_runtime');
  });

  it('does not attempt resume when runtime is already active', async () => {
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

    // Create a session (this registers the runtime)
    await backend.createSession({ ...scope, cwd });

    // Clear request log
    client.requests.length = 0;

    // Send prompt to active session
    const result = await backend.sendPrompt('session-1', 'hello', scope, cwd);

    expect(result.delivered).toBe(true);
    // No resume attempt
    expect(client.requests.some(r => r.method === 'session/resume')).toBe(false);
    // Prompt was delivered directly
    expect(client.requests.some(r => r.method === 'session/prompt')).toBe(true);
  });
});

// Reuse the fake classes from acp-backend.test.ts
class FakeBackendClient implements AcpBackendClient {
  readonly requests: { method: string; params: AcpJsonValue | undefined }[] = [];
  readonly notifications = new Set<(notification: AcpJsonRpcNotification) => void>();
  readonly inboundRequests = new Set<(request: AcpJsonRpcInboundRequest) => void>();
  readonly exits = new Set<Parameters<AcpBackendClient['onExit']>[0]>();
  readonly errors = new Set<Parameters<AcpBackendClient['onError']>[0]>();
  readonly results = new Map<string, unknown>();
  readonly responses: { id: AcpJsonValue; result?: AcpJsonValue; error?: unknown }[] = [];
  started = 0;
  shutdowns = 0;

  setResult(method: string, result: unknown): void {
    this.results.set(method, result);
  }

  async start(): Promise<void> {
    this.started += 1;
  }

  async request<T = AcpJsonValue>(
    method: string,
    params?: AcpJsonValue,
    _options?: AcpJsonRpcRequestOptions
  ): Promise<AcpJsonRpcSuccess<T>> {
    this.requests.push({ method, params });
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
    // Default session-1 record
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
