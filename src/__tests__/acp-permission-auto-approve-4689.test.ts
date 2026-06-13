/**
 * acp-permission-auto-approve-4689.test.ts
 *
 * Issue #4689: Prevent permission approval deadlock for non-default modes.
 *
 * When permission mode is acceptEdits/bypassPermissions/auto/dontAsk,
 * session/request_permission should be auto-approved instead of stored
 * as pending (which causes deadlock).
 */

import { describe, expect, it } from 'vitest';

import {
  AcpBackend,
  type AcpBackendClient,
  type AcpBackendClientFactoryContext,
  type AcpBackendSessionService,
  type AcpCreateSessionInput,
  type AcpJsonRpcId,
  type AcpJsonRpcInboundRequest,
  type AcpJsonRpcNotification,
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

describe('Issue #4689: Permission auto-approve for non-default modes', () => {
  it('auto-approves permission requests for acceptEdits mode', async () => {
    const service = new FakeSessionService({ permissionMode: 'acceptEdits' });
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-1' });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'run-1',
    });

    await backend.createSession({ ...scope, cwd });

    // Simulate bridge sending session/request_permission
    const permRequest: AcpJsonRpcInboundRequest = {
      jsonrpc: '2.0',
      id: 'perm-1',
      method: 'session/request_permission',
      params: { sessionId: 'acp-agent-1', toolCall: { kind: 'Read' } },
      raw: {},
    };
    client.emitRequest(permRequest);

    // Give the async respond() a tick to fire
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should have auto-responded with allow-once
    expect(client.responses.length).toBe(1);
    expect(client.responses[0].id).toBe('perm-1');
    expect(client.responses[0].result).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });

    // Should NOT have stored as pending approval
    expect(backend.getPendingApproval('session-1')).toBeNull();
  });

  it('stores permission requests for default mode (no auto-approve)', async () => {
    const service = new FakeSessionService({ permissionMode: 'default' });
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-1' });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'run-1',
    });

    await backend.createSession({ ...scope, cwd });

    const permRequest: AcpJsonRpcInboundRequest = {
      jsonrpc: '2.0',
      id: 'perm-2',
      method: 'session/request_permission',
      params: { sessionId: 'acp-agent-1', toolCall: { kind: 'Bash' } },
      raw: {},
    };
    client.emitRequest(permRequest);

    await new Promise(resolve => setTimeout(resolve, 50));

    // Should NOT have auto-responded
    expect(client.responses.length).toBe(0);

    // Should have stored as pending approval
    const pending = backend.getPendingApproval('session-1');
    expect(pending).not.toBeNull();
    expect(pending!.approvalId).toBe('perm-2');
  });

  it('auto-approves for bypassPermissions mode', async () => {
    const service = new FakeSessionService({ permissionMode: 'bypassPermissions' });
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-1' });

    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'run-1',
    });

    await backend.createSession({ ...scope, cwd });

    client.emitRequest({
      jsonrpc: '2.0',
      id: 'perm-3',
      method: 'session/request_permission',
      params: {},
      raw: {},
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    expect(client.responses.length).toBe(1);
    expect(backend.getPendingApproval('session-1')).toBeNull();
  });
});

// Fake classes (same pattern as acp-backend.test.ts)
class FakeBackendClient implements AcpBackendClient {
  readonly requests: { method: string; params: AcpJsonValue | undefined }[] = [];
  readonly notifications = new Set<(n: AcpJsonRpcNotification) => void>();
  readonly inboundRequests = new Set<(r: AcpJsonRpcInboundRequest) => void>();
  readonly exits = new Set<Parameters<AcpBackendClient['onExit']>[0]>();
  readonly errors = new Set<Parameters<AcpBackendClient['onError']>[0]>();
  readonly results = new Map<string, unknown>();
  readonly responses: { id: AcpJsonValue; result?: AcpJsonValue; error?: unknown }[] = [];
  started = 0;
  shutdowns = 0;

  setResult(method: string, result: unknown): void {
    this.results.set(method, result);
  }

  async start(): Promise<void> { this.started++; }

  async request<T = AcpJsonValue>(
    method: string,
    params?: AcpJsonValue,
    _options?: AcpJsonRpcRequestOptions
  ): Promise<AcpJsonRpcSuccess<T>> {
    this.requests.push({ method, params });
    return { jsonrpc: '2.0', id: `${method}-req`, result: this.results.get(method) as T };
  }

  async notify(_method: string, _params?: AcpJsonValue): Promise<void> {}

  async respond(id: AcpJsonRpcId, result: AcpJsonValue): Promise<void> {
    this.responses.push({ id, result });
  }

  async respondWithError(id: AcpJsonRpcId, error: AcpJsonRpcResponseError): Promise<void> {
    this.responses.push({ id, error });
  }

  async shutdown(): Promise<{ code: number | null; signal: NodeJS.Signals | null; expected: boolean; escalated: boolean }> {
    this.shutdowns++;
    return { code: 0, signal: null, expected: true, escalated: false };
  }

  onNotification(l: (n: AcpJsonRpcNotification) => void): () => void {
    this.notifications.add(l);
    return () => this.notifications.delete(l);
  }

  onRequest(l: (r: AcpJsonRpcInboundRequest) => void): () => void {
    this.inboundRequests.add(l);
    return () => this.inboundRequests.delete(l);
  }

  onExit(l: Parameters<AcpBackendClient['onExit']>[0]): () => void {
    this.exits.add(l);
    return () => this.exits.delete(l);
  }

  onError(l: Parameters<AcpBackendClient['onError']>[0]): () => void {
    this.errors.add(l);
    return () => this.errors.delete(l);
  }

  emitRequest(request: AcpJsonRpcInboundRequest): void {
    for (const l of this.inboundRequests) l(request);
  }
}

class FakeSessionService implements AcpBackendSessionService {
  private record: AcpSessionRecord;
  readonly createdInputs: AcpCreateSessionInput[] = [];

  constructor(opts: { permissionMode?: string } = {}) {
    this.record = {
      id: 'session-1',
      conversationId: 'conv-1',
      transcriptId: 'transcript-1',
      status: 'initializing' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      permissionMode: opts.permissionMode,
      ...scope,
    };
  }

  async createSession(input: AcpCreateSessionInput): Promise<AcpSessionRecord> {
    this.createdInputs.push(input);
    return this.record;
  }

  async getSession(): Promise<AcpSessionRecord> {
    return this.record;
  }

  async attachAgentSession(): Promise<AcpSessionRecord> {
    this.record.acpAgentSessionId = 'acp-agent-1';
    this.record.status = 'running';
    return this.record;
  }

  async transition(
    _sessionId: string,
    _scope: AcpSessionScope,
    event: AcpSessionTransitionEvent
  ): Promise<AcpSessionRecord> {
    if (event.type === 'agent_ready') this.record.status = 'running';
    return this.record;
  }

  async recordBackendRestart(): Promise<AcpSessionRecord> {
    return this.record;
  }
}
