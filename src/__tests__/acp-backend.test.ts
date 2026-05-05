import { describe, expect, it } from 'vitest';

import {
  AcpBackend,
  AcpSessionNotFoundError,
  type AcpBackendClient,
  type AcpBackendClientFactoryContext,
  type AcpBackendCreateSessionInput,
  type AcpBackendSessionService,
  type AcpCreateSessionInput,
  type AcpJsonRpcInboundRequest,
  type AcpJsonRpcNotification,
  type AcpJsonRpcRequestOptions,
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

const cwd = 'D:\\aegis\\workspace';

describe('AcpBackend session lifecycle', () => {
  it('creates a durable session, starts ACP, attaches agent ids, and marks the session ready', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {
      agentCapabilities: { loadSession: true, close: true },
      agentInfo: { name: 'fake-acp-agent', version: '0.32.0' },
      authMethods: [],
    });
    client.setResult('session/new', {
      sessionId: 'acp-agent-session-1',
      claudeSessionId: 'claude-session-1',
    });
    const contexts: AcpBackendClientFactoryContext[] = [];
    const rawNotifications: AcpJsonRpcNotification[] = [];
    const rawRequests: AcpJsonRpcInboundRequest[] = [];
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: context => {
        contexts.push(context);
        return client;
      },
      backendRunIdProvider: () => 'backend-run-1',
      onRawNotification: notification => rawNotifications.push(notification),
      onRawRequest: request => rawRequests.push(request),
    });

    const result = await backend.createSession({
      ...scope,
      cwd,
      backendMetadata: { source: 'unit-test' },
      mcpServers: { filesystem: { command: 'node', args: ['server.js'] } },
    });
    client.emitNotification({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'acp-agent-session-1', update: { sessionUpdate: 'raw' } },
      raw: {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'acp-agent-session-1', update: { sessionUpdate: 'raw' } },
      },
    });
    client.emitRequest({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: { sessionId: 'acp-agent-session-1' },
      raw: {
        jsonrpc: '2.0',
        id: 'permission-1',
        method: 'session/request_permission',
        params: { sessionId: 'acp-agent-session-1' },
      },
    });

    expect(result.session).toMatchObject({
      id: 'session-1',
      status: 'idle',
      acpAgentSessionId: 'acp-agent-session-1',
      claudeSessionId: 'claude-session-1',
      currentBackendRunId: 'backend-run-1',
    });
    expect(result.initializeResult).toMatchObject({
      agentInfo: { name: 'fake-acp-agent', version: '0.32.0' },
    });
    expect(contexts).toEqual([
      {
        backendRunId: 'backend-run-1',
        cwd,
        durableSessionId: 'session-1',
        tenantId: 'tenant-a',
        ownerKeyId: 'owner-a',
      },
    ]);
    expect(client.started).toBe(1);
    expect(client.requests).toEqual([
      {
        method: 'initialize',
        params: {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: 'aegis', version: '0.6.6-preview.1' },
        },
      },
      {
        method: 'session/new',
        params: {
          cwd,
          mcpServers: { filesystem: { command: 'node', args: ['server.js'] } },
          _meta: { aegis: { sessionId: 'session-1', backendRunId: 'backend-run-1' } },
        },
      },
    ]);
    expect(service.createdInputs).toEqual([
      {
        tenantId: 'tenant-a',
        ownerKeyId: 'owner-a',
        backendMetadata: { source: 'unit-test' },
      },
    ]);
    expect(service.attachments).toEqual([
      {
        sessionId: 'session-1',
        scope,
        attachment: {
          acpAgentSessionId: 'acp-agent-session-1',
          claudeSessionId: 'claude-session-1',
          backendRunId: 'backend-run-1',
        },
      },
    ]);
    expect(service.transitions).toEqual([
      { sessionId: 'session-1', scope, event: { type: 'agent_ready' } },
    ]);
    expect(rawNotifications).toHaveLength(1);
    expect(rawRequests).toHaveLength(1);
  });

  it('resumes only after SessionService verifies the durable session scope', async () => {
    const service = new FakeSessionService([
      createSessionRecord({
        id: 'session-resume',
        acpAgentSessionId: 'acp-agent-existing',
        claudeSessionId: 'claude-existing',
        status: 'idle',
      }),
    ]);
    const client = new FakeBackendClient();
    client.setResult('initialize', { agentCapabilities: { loadSession: true } });
    client.setResult('session/resume', {
      sessionId: 'acp-agent-existing',
      claudeSessionId: 'claude-existing',
    });
    let createdClients = 0;
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => {
        createdClients += 1;
        return client;
      },
      backendRunIdProvider: () => 'backend-run-resume',
    });

    const resumed = await backend.resumeSession({
      ...scope,
      sessionId: 'session-resume',
      cwd,
    });
    await expect(
      backend.resumeSession({
        tenantId: 'tenant-b',
        ownerKeyId: 'owner-a',
        sessionId: 'session-resume',
        cwd,
      })
    ).rejects.toBeInstanceOf(AcpSessionNotFoundError);

    expect(resumed.session).toMatchObject({
      id: 'session-resume',
      status: 'idle',
      acpAgentSessionId: 'acp-agent-existing',
      currentBackendRunId: 'backend-run-resume',
    });
    expect(createdClients).toBe(1);
    expect(client.requests.map(request => request.method)).toEqual(['initialize', 'session/resume']);
    expect(client.requests[1]?.params).toEqual({
      sessionId: 'acp-agent-existing',
      cwd,
      _meta: { aegis: { sessionId: 'session-resume', backendRunId: 'backend-run-resume' } },
    });
    expect(service.transitions).toEqual([]);
  });

  it('sends cancel and closes the ACP runtime with idempotent shutdown cleanup', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-session-1' });
    client.setResult('session/cancel', { stopReason: 'cancelled' });
    client.setResult('session/close', {});
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
    });

    await backend.createSession({ ...scope, cwd });
    const cancelled = await backend.cancelSession({ ...scope, sessionId: 'session-1' });
    const closed = await backend.shutdownSession({ ...scope, sessionId: 'session-1' });
    const secondClose = await backend.shutdownSession({ ...scope, sessionId: 'session-1' });

    expect(cancelled.session.id).toBe('session-1');
    expect(closed.session).toMatchObject({ id: 'session-1', status: 'closed' });
    expect(secondClose.session).toMatchObject({ id: 'session-1', status: 'closed' });
    expect(client.requests.map(request => request.method)).toEqual([
      'initialize',
      'session/new',
      'session/cancel',
      'session/close',
    ]);
    expect(client.shutdowns).toBe(1);
    expect(service.transitions.map(transition => transition.event.type)).toEqual([
      'agent_ready',
      'close_requested',
      'close_completed',
    ]);
  });

  it('marks the durable session failed, cleans up, and propagates client startup failures', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    const startupError = new Error('spawn failed');
    client.startError = startupError;
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-failed',
    });

    await expect(backend.createSession({ ...scope, cwd })).rejects.toBe(startupError);

    expect(service.transitions).toEqual([
      { sessionId: 'session-1', scope, event: { type: 'runtime_failed' } },
    ]);
    expect(client.shutdowns).toBe(0);
    expect(service.records.get('session-1')).toMatchObject({ status: 'failed' });
    expect(service.records.get('session-1')?.currentBackendRunId).toBeUndefined();
  });

  it('marks active sessions failed when the child exits unexpectedly', async () => {
    const service = new FakeSessionService();
    const client = new FakeBackendClient();
    client.setResult('initialize', {});
    client.setResult('session/new', { sessionId: 'acp-agent-session-1' });
    const exits: unknown[] = [];
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => client,
      backendRunIdProvider: () => 'backend-run-1',
      onRuntimeExit: exit => exits.push(exit),
    });

    await backend.createSession({ ...scope, cwd });
    client.emitExit({ code: 7, signal: null, expected: false, escalated: false });
    await waitForCondition(() => service.records.get('session-1')?.status === 'failed');

    expect(exits).toEqual([
      {
        sessionId: 'session-1',
        backendRunId: 'backend-run-1',
        exit: { code: 7, signal: null, expected: false, escalated: false },
      },
    ]);
    expect(service.transitions.map(transition => transition.event.type)).toEqual([
      'agent_ready',
      'runtime_failed',
    ]);
  });

  it('exposes lifecycle-scoped restart and backoff hooks without running an action worker', async () => {
    const service = new FakeSessionService([
      createSessionRecord({
        id: 'session-restart',
        acpAgentSessionId: 'acp-agent-existing',
        status: 'idle',
      }),
    ]);
    const oldClient = new FakeBackendClient();
    const newClient = new FakeBackendClient();
    newClient.setResult('initialize', {});
    newClient.setResult('session/resume', { sessionId: 'acp-agent-existing' });
    const clients = [newClient];
    const backoffEvents: unknown[] = [];
    const backend = new AcpBackend({
      sessionService: service,
      clientFactory: () => clients.shift() ?? new FakeBackendClient(),
      backendRunIdProvider: (() => {
        const ids = ['backend-run-new'];
        return () => ids.shift() ?? 'backend-run-extra';
      })(),
      restartBackoff: ({ attempt }) => attempt * 250,
      onRestartBackoff: event => backoffEvents.push(event),
    });

    await backend.adoptSessionRuntime({
      ...scope,
      sessionId: 'session-restart',
      backendRunId: 'backend-run-old',
      client: oldClient,
    });
    const restarted = await backend.restartSession({
      ...scope,
      sessionId: 'session-restart',
      cwd,
      reason: 'unexpected-exit',
    });

    expect(restarted.backoffDelayMs).toBe(250);
    expect(restarted.session).toMatchObject({
      id: 'session-restart',
      currentBackendRunId: 'backend-run-new',
      status: 'idle',
    });
    expect(oldClient.shutdowns).toBe(1);
    expect(newClient.requests.map(request => request.method)).toEqual(['initialize', 'session/resume']);
    expect(service.restartRecords).toEqual([
      { sessionId: 'session-restart', scope, backendRunId: 'backend-run-new' },
    ]);
    expect(backoffEvents).toEqual([
      {
        sessionId: 'session-restart',
        backendRunId: 'backend-run-new',
        attempt: 1,
        delayMs: 250,
        reason: 'unexpected-exit',
      },
    ]);
  });
});

class FakeBackendClient implements AcpBackendClient {
  readonly requests: { method: string; params: AcpJsonValue | undefined }[] = [];
  readonly notifications = new Set<(notification: AcpJsonRpcNotification) => void>();
  readonly inboundRequests = new Set<(request: AcpJsonRpcInboundRequest) => void>();
  readonly exits = new Set<Parameters<AcpBackendClient['onExit']>[0]>();
  readonly errors = new Set<Parameters<AcpBackendClient['onError']>[0]>();
  readonly results = new Map<string, unknown>();
  started = 0;
  shutdowns = 0;
  startError: Error | undefined;

  setResult(method: string, result: unknown): void {
    this.results.set(method, result);
  }

  async start(): Promise<void> {
    if (this.startError) throw this.startError;
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
      // The fake stores method results by name; the production transport owns runtime validation.
      result: this.results.get(method) as T,
    };
  }

  async notify(_method: string, _params?: AcpJsonValue): Promise<void> {}

  async shutdown(): Promise<{ code: number | null; signal: NodeJS.Signals | null; expected: boolean; escalated: boolean }> {
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

  emitNotification(notification: AcpJsonRpcNotification): void {
    for (const listener of this.notifications) listener(notification);
  }

  emitRequest(request: AcpJsonRpcInboundRequest): void {
    for (const listener of this.inboundRequests) listener(request);
  }

  emitExit(exit: { code: number | null; signal: NodeJS.Signals | null; expected: boolean; escalated: boolean }): void {
    for (const listener of this.exits) listener(exit);
  }
}

class FakeSessionService implements AcpBackendSessionService {
  readonly records = new Map<string, AcpSessionRecord>();
  readonly createdInputs: AcpCreateSessionInput[] = [];
  readonly attachments: {
    sessionId: string;
    scope: AcpSessionScope;
    attachment: { acpAgentSessionId?: string; claudeSessionId?: string; backendRunId?: string };
  }[] = [];
  readonly transitions: {
    sessionId: string;
    scope: AcpSessionScope;
    event: AcpSessionTransitionEvent;
  }[] = [];
  readonly restartRecords: { sessionId: string; scope: AcpSessionScope; backendRunId: string }[] = [];

  constructor(records: AcpSessionRecord[] = []) {
    for (const record of records) {
      this.records.set(record.id, cloneRecord(record));
    }
  }

  async createSession(input: AcpBackendCreateSessionInput): Promise<AcpSessionRecord> {
    this.createdInputs.push(stripBackendRuntimeInput(input));
    const record = createSessionRecord({ id: `session-${this.records.size + 1}`, ...input });
    this.records.set(record.id, record);
    return cloneRecord(record);
  }

  async getSession(sessionId: string, requestedScope: AcpSessionScope): Promise<AcpSessionRecord> {
    const record = this.records.get(sessionId);
    if (!record || record.tenantId !== requestedScope.tenantId || record.ownerKeyId !== requestedScope.ownerKeyId) {
      throw new AcpSessionNotFoundError(sessionId);
    }
    return cloneRecord(record);
  }

  async attachAgentSession(
    sessionId: string,
    requestedScope: AcpSessionScope,
    attachment: { acpAgentSessionId?: string; claudeSessionId?: string; backendRunId?: string }
  ): Promise<AcpSessionRecord> {
    this.attachments.push({ sessionId, scope: requestedScope, attachment });
    const record = await this.getSession(sessionId, requestedScope);
    const updated = {
      ...record,
      acpAgentSessionId: attachment.acpAgentSessionId ?? record.acpAgentSessionId,
      claudeSessionId: attachment.claudeSessionId ?? record.claudeSessionId,
      currentBackendRunId: attachment.backendRunId ?? record.currentBackendRunId,
      updatedAt: record.updatedAt + 1,
    };
    this.records.set(sessionId, updated);
    return cloneRecord(updated);
  }

  async transition(
    sessionId: string,
    requestedScope: AcpSessionScope,
    event: AcpSessionTransitionEvent
  ): Promise<AcpSessionRecord> {
    this.transitions.push({ sessionId, scope: requestedScope, event });
    const record = await this.getSession(sessionId, requestedScope);
    const nextStatus = statusForEvent(event);
    const updated = {
      ...record,
      status: nextStatus,
      updatedAt: record.updatedAt + 1,
      closedAt: nextStatus === 'closed' ? record.closedAt ?? record.updatedAt + 1 : record.closedAt,
      failedAt: nextStatus === 'failed' ? record.failedAt ?? record.updatedAt + 1 : record.failedAt,
    };
    this.records.set(sessionId, updated);
    return cloneRecord(updated);
  }

  async recordBackendRestart(
    sessionId: string,
    requestedScope: AcpSessionScope,
    backendRunId: string
  ): Promise<AcpSessionRecord> {
    this.restartRecords.push({ sessionId, scope: requestedScope, backendRunId });
    const record = await this.getSession(sessionId, requestedScope);
    const updated = { ...record, currentBackendRunId: backendRunId, updatedAt: record.updatedAt + 1 };
    this.records.set(sessionId, updated);
    return cloneRecord(updated);
  }
}

function createSessionRecord(overrides: Partial<AcpSessionRecord> = {}): AcpSessionRecord {
  return {
    id: 'session-1',
    tenantId: 'tenant-a',
    ownerKeyId: 'owner-a',
    conversationId: 'conversation-1',
    transcriptId: 'transcript-1',
    status: 'initializing',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function cloneRecord(record: AcpSessionRecord): AcpSessionRecord {
  return {
    ...record,
    backendMetadata: record.backendMetadata ? { ...record.backendMetadata } : undefined,
  };
}

function stripBackendRuntimeInput(input: AcpBackendCreateSessionInput): AcpCreateSessionInput {
  const { cwd: _cwd, mcpServers: _mcpServers, ...serviceInput } = input;
  return serviceInput;
}

function statusForEvent(event: AcpSessionTransitionEvent): AcpSessionRecord['status'] {
  switch (event.type) {
    case 'agent_ready':
      return 'idle';
    case 'close_requested':
      return 'closing';
    case 'close_completed':
      return 'closed';
    case 'runtime_failed':
      return 'failed';
    case 'run_started':
      return 'running';
    case 'run_completed':
      return 'idle';
    case 'pause_requested':
      return 'paused';
    case 'resume_requested':
      return 'running';
    case 'intervention_started':
      return 'intervening';
    case 'intervention_completed':
      return 'paused';
  }
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}
