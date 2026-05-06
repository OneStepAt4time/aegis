import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AcpChildProcess,
  type AcpChildProcessExitEvent,
  type AcpChildProcessOptions,
  type AcpChildProcessShutdownOptions,
} from './child-process.js';
import {
  AcpJsonRpcClient,
  type AcpJsonObject,
  type AcpJsonRpcClientOptions,
  type AcpJsonRpcId,
  type AcpJsonRpcInboundRequest,
  type AcpJsonRpcNotification,
  type AcpJsonRpcRequestOptions,
  type AcpJsonRpcResponseError,
  type AcpJsonRpcSuccess,
  type AcpJsonValue,
} from './json-rpc-client.js';
import type { AcpActionMetadata, AcpActionRecord } from './action-queue.js';
import type {
  AcpAgentSessionAttachment,
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpCreateSessionInput,
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionTransitionEvent,
} from './types.js';

const DEFAULT_PROTOCOL_VERSION = 1;
const PACKAGE_VERSION = readPackageVersion();

export interface AcpBackendClient {
  start(): Promise<void>;
  request<T = AcpJsonValue>(
    method: string,
    params?: AcpJsonValue,
    options?: AcpJsonRpcRequestOptions
  ): Promise<AcpJsonRpcSuccess<T>>;
  notify(method: string, params?: AcpJsonValue): Promise<void>;
  respond(id: AcpJsonRpcId, result: AcpJsonValue): Promise<void>;
  respondWithError(id: AcpJsonRpcId, error: AcpJsonRpcResponseError): Promise<void>;
  shutdown(options?: AcpChildProcessShutdownOptions): Promise<AcpChildProcessExitEvent>;
  onNotification(listener: (notification: AcpJsonRpcNotification) => void): () => void;
  onRequest(listener: (request: AcpJsonRpcInboundRequest) => void): () => void;
  onExit(listener: (exit: AcpChildProcessExitEvent) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
}

export interface AcpBackendSessionService {
  createSession(input: AcpCreateSessionInput): Promise<AcpSessionRecord>;
  getSession(sessionId: string, scope: AcpSessionScope): Promise<AcpSessionRecord>;
  attachAgentSession(
    sessionId: string,
    scope: AcpSessionScope,
    attachment: AcpAgentSessionAttachment
  ): Promise<AcpSessionRecord>;
  transition(
    sessionId: string,
    scope: AcpSessionScope,
    event: AcpSessionTransitionEvent
  ): Promise<AcpSessionRecord>;
  recordBackendRestart(
    sessionId: string,
    scope: AcpSessionScope,
    backendRunId?: string
  ): Promise<AcpSessionRecord>;
}

export interface AcpBackendCreateSessionInput extends AcpCreateSessionInput {
  cwd: string;
  mcpServers?: AcpJsonObject;
}

export interface AcpBackendScopedRuntimeInput extends AcpSessionScope {
  sessionId: string;
}

export interface AcpBackendResumeSessionInput extends AcpBackendScopedRuntimeInput {
  cwd: string;
}

export interface AcpBackendLoadSessionInput extends AcpBackendScopedRuntimeInput {
  cwd: string;
  mcpServers?: AcpJsonObject;
}

export type AcpBackendCancelSessionInput = AcpBackendScopedRuntimeInput;

export type AcpBackendShutdownSessionInput = AcpBackendScopedRuntimeInput;

export interface AcpBackendRestartSessionInput extends AcpBackendScopedRuntimeInput {
  cwd: string;
  reason: string;
}

export interface AcpBackendAdoptRuntimeInput extends AcpBackendScopedRuntimeInput {
  backendRunId: string;
  client: AcpBackendClient;
}

export interface AcpBackendClientFactoryContext extends AcpSessionScope {
  durableSessionId: string;
  backendRunId: string;
  cwd: string;
}

export interface AcpBackendInitializeResult {
  agentCapabilities?: AcpJsonValue;
  agentInfo?: AcpJsonValue;
  authMethods?: AcpJsonValue;
}

export interface AcpBackendSessionResult {
  sessionId: string;
  claudeSessionId?: string;
}

export interface AcpBackendStartResult {
  session: AcpSessionRecord;
  initializeResult: AcpBackendInitializeResult;
  backendRunId: string;
}

export interface AcpBackendCancelResult {
  session: AcpSessionRecord;
  cancelResult: AcpJsonValue;
}

export interface AcpBackendShutdownResult {
  session: AcpSessionRecord;
  exit?: AcpChildProcessExitEvent;
}

export interface AcpBackendRestartResult extends AcpBackendStartResult {
  backoffDelayMs: number;
}

export interface AcpBackendDispatchActionResult {
  resultMetadata?: AcpActionMetadata;
}

export interface AcpBackendApprovalInput extends AcpBackendScopedRuntimeInput {
  approvalId: string;
}

export interface AcpBackendApprovalResult {
  sessionId: string;
  approvalId: string;
  action: 'approved' | 'rejected';
  timestamp: string;
}

export interface AcpPendingApproval {
  approvalId: string;
  sessionId: string;
  tool: {
    toolName: string;
    description: string;
    input?: Record<string, unknown>;
  };
  requestedAt: string;
  expiresAt?: string;
}

export interface AcpBackendClaimDriverInput extends AcpBackendScopedRuntimeInput {
  holderId: string;
  ttlMs?: number;
}

export interface AcpBackendReleaseDriverInput extends AcpBackendScopedRuntimeInput {
  holderId: string;
}

export interface AcpBackendTransferDriverInput extends AcpBackendScopedRuntimeInput {
  targetSubscriberId: string;
  reason?: string;
}

export interface AcpBackendDriverResult {
  sessionId: string;
  holderId: string | null;
  role: 'driver' | 'observer';
  fence?: number;
  ttlMs?: number;
}

export interface AcpBackendParticipantsResult {
  sessionId: string;
  driver: { subscriberId: string; role: 'driver'; metadata?: Record<string, unknown> } | null;
  observers: { subscriberId: string; role: 'observer'; metadata?: Record<string, unknown> }[];
  activeCount: number;
}

export interface AcpBackendRuntimeExitEvent {
  sessionId: string;
  backendRunId: string;
  exit: AcpChildProcessExitEvent;
}

export interface AcpBackendRestartBackoffContext {
  sessionId: string;
  backendRunId: string;
  attempt: number;
  reason: string;
}

export interface AcpBackendRestartBackoffEvent extends AcpBackendRestartBackoffContext {
  delayMs: number;
}

export interface AcpBackendOptions {
  sessionService: AcpBackendSessionService;
  clientFactory?: (context: AcpBackendClientFactoryContext) => AcpBackendClient;
  backendRunIdProvider?: () => string;
  clientInfo?: AcpJsonObject;
  clientCapabilities?: AcpJsonObject;
  childProcessOptions?: Omit<AcpChildProcessOptions, 'cwd'>;
  jsonRpcClientOptions?: Omit<AcpJsonRpcClientOptions, 'child'>;
  onRawNotification?: (notification: AcpJsonRpcNotification) => void;
  onRawRequest?: (request: AcpJsonRpcInboundRequest) => void;
  onRuntimeExit?: (event: AcpBackendRuntimeExitEvent) => void;
  restartBackoff?: (context: AcpBackendRestartBackoffContext) => number;
  onRestartBackoff?: (event: AcpBackendRestartBackoffEvent) => void;
}

interface AcpBackendRuntime {
  sessionId: string;
  scope: AcpSessionScope;
  backendRunId: string;
  client: AcpBackendClient;
  disposers: (() => void)[];
  cleanupPromise?: Promise<AcpBackendShutdownResult>;
}

export class AcpBackendLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpBackendLifecycleError';
  }
}

export class AcpBackendRuntimeUnavailableError extends AcpBackendLifecycleError {
  constructor(sessionId: string) {
    super(`ACP runtime is not active for session: ${sessionId}`);
    this.name = 'AcpBackendRuntimeUnavailableError';
  }
}

export class AcpBackend {
  private readonly sessionService: AcpBackendSessionService;
  private readonly clientFactory: (context: AcpBackendClientFactoryContext) => AcpBackendClient;
  private readonly backendRunIdProvider: () => string;
  private readonly clientInfo: AcpJsonObject;
  private readonly clientCapabilities: AcpJsonObject;
  private readonly runtimes = new Map<string, AcpBackendRuntime>();
  private readonly restartAttempts = new Map<string, number>();
  private readonly pendingApprovals = new Map<string, AcpPendingApproval>();
  private readonly participants = new Map<string, AcpBackendParticipantsResult>();
  private readonly driverFences = new Map<string, number>();

  constructor(private readonly options: AcpBackendOptions) {
    this.sessionService = options.sessionService;
    this.clientFactory =
      options.clientFactory ??
      (context =>
        createDefaultAcpBackendClient(context, {
          childProcessOptions: options.childProcessOptions,
          jsonRpcClientOptions: options.jsonRpcClientOptions,
        }));
    this.backendRunIdProvider = options.backendRunIdProvider ?? randomUUID;
    this.clientInfo = options.clientInfo ?? { name: 'aegis', version: PACKAGE_VERSION };
    this.clientCapabilities = options.clientCapabilities ?? {};
  }

  async createSession(input: AcpBackendCreateSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.createSession(toCreateSessionInput(input));
    return this.startNewRuntime(session, input.cwd, input.mcpServers);
  }

  async resumeSession(input: AcpBackendResumeSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.getSession(input.sessionId, scopeFromInput(input));
    if (!session.acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot resume ACP session ${session.id} without a verified ACP agent session id`
      );
    }
    return this.startResumeRuntime(session, input.cwd);
  }

  async loadSession(input: AcpBackendLoadSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.getSession(input.sessionId, scopeFromInput(input));
    if (!session.acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot load ACP session ${session.id} without a verified ACP agent session id`
      );
    }
    return this.startLoadRuntime(session, input.cwd, input.mcpServers);
  }

  async cancelSession(input: AcpBackendCancelSessionInput): Promise<AcpBackendCancelResult> {
    const scope = scopeFromInput(input);
    const session = await this.sessionService.getSession(input.sessionId, scope);
    const runtime = this.requireRuntime(input.sessionId);
    const acpSessionId = session.acpAgentSessionId;
    if (!acpSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot cancel ACP session ${session.id} before ACP agent attachment`
      );
    }
    const response = await runtime.client.request<AcpJsonValue>('session/cancel', {
      sessionId: acpSessionId,
    });
    return {
      session: await this.sessionService.getSession(input.sessionId, scope),
      cancelResult: response.result,
    };
  }

  async approveSession(input: AcpBackendApprovalInput): Promise<AcpBackendApprovalResult> {
    const runtime = this.requireRuntime(input.sessionId);
    await runtime.client.respond(input.approvalId, {
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    this.pendingApprovals.delete(input.sessionId);
    return {
      sessionId: input.sessionId,
      approvalId: input.approvalId,
      action: 'approved',
      timestamp: new Date().toISOString(),
    };
  }

  async rejectSession(input: AcpBackendApprovalInput): Promise<AcpBackendApprovalResult> {
    const runtime = this.requireRuntime(input.sessionId);
    await runtime.client.respond(input.approvalId, {
      outcome: { outcome: 'selected', optionId: 'reject-once' },
    });
    this.pendingApprovals.delete(input.sessionId);
    return {
      sessionId: input.sessionId,
      approvalId: input.approvalId,
      action: 'rejected',
      timestamp: new Date().toISOString(),
    };
  }

  getPendingApproval(sessionId: string): AcpPendingApproval | null {
    return this.pendingApprovals.get(sessionId) ?? null;
  }

  async claimDriver(input: AcpBackendClaimDriverInput): Promise<AcpBackendDriverResult> {
    const scope = scopeFromInput(input);
    await this.sessionService.getSession(input.sessionId, scope);
    let record = this.participants.get(input.sessionId);
    if (!record) {
      record = { sessionId: input.sessionId, driver: null, observers: [], activeCount: 0 };
      this.participants.set(input.sessionId, record);
    }
    if (record.driver) {
      throw new AcpBackendLifecycleError(`Driver already claimed for session ${input.sessionId}`);
    }
    const fence = (this.driverFences.get(input.sessionId) ?? 0) + 1;
    this.driverFences.set(input.sessionId, fence);
    record.driver = { subscriberId: input.holderId, role: 'driver' };
    record.activeCount = 1 + record.observers.length;
    return { sessionId: input.sessionId, holderId: input.holderId, role: 'driver', fence, ttlMs: input.ttlMs };
  }

  async releaseDriver(input: AcpBackendReleaseDriverInput): Promise<AcpBackendDriverResult> {
    const scope = scopeFromInput(input);
    await this.sessionService.getSession(input.sessionId, scope);
    const record = this.participants.get(input.sessionId);
    if (!record || !record.driver || record.driver.subscriberId !== input.holderId) {
      throw new AcpBackendLifecycleError(`Not the driver of session ${input.sessionId}`);
    }
    record.driver = null;
    record.activeCount = record.observers.length;
    return { sessionId: input.sessionId, holderId: null, role: 'observer' };
  }

  async transferDriver(input: AcpBackendTransferDriverInput): Promise<AcpBackendDriverResult> {
    const scope = scopeFromInput(input);
    await this.sessionService.getSession(input.sessionId, scope);
    const record = this.participants.get(input.sessionId);
    if (!record || !record.driver) {
      throw new AcpBackendLifecycleError(`No driver to transfer for session ${input.sessionId}`);
    }
    const fence = (this.driverFences.get(input.sessionId) ?? 0) + 1;
    this.driverFences.set(input.sessionId, fence);
    record.driver = { subscriberId: input.targetSubscriberId, role: 'driver' };
    return { sessionId: input.sessionId, holderId: input.targetSubscriberId, role: 'driver', fence };
  }

  getParticipants(sessionId: string, _scope: AcpSessionScope): AcpBackendParticipantsResult {
    return (
      this.participants.get(sessionId) ?? {
        sessionId,
        driver: null,
        observers: [],
        activeCount: 0,
      }
    );
  }

  async dispatchAction(action: AcpActionRecord): Promise<AcpBackendDispatchActionResult> {
    if (action.actionType === 'close') {
      const result = await this.shutdownSession(action);
      return { resultMetadata: { status: result.session.status } };
    }

    const scope = scopeFromInput(action);
    const session = await this.sessionService.getSession(action.sessionId, scope);
    const runtime = this.requireRuntime(action.sessionId);
    const acpSessionId = session.acpAgentSessionId;
    if (!acpSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot dispatch ACP action ${action.actionId} before ACP agent attachment`
      );
    }

    switch (action.actionType) {
      case 'prompt':
        return this.dispatchPromptAction(runtime, acpSessionId, action);
      case 'approve':
      case 'reject':
        return this.dispatchApprovalAction(runtime, action);
      case 'cancel': {
        const result = await this.cancelSession(action);
        return { resultMetadata: primitiveResultMetadata(result.cancelResult) };
      }
      case 'pause':
      case 'resume':
      case 'driver_transfer':
      case 'intervene':
        throw new AcpBackendLifecycleError(
          `ACP action type ${action.actionType} has no runtime dispatch contract in ACP-046`
        );
      default:
        return assertNeverAction(action.actionType);
    }
  }

  async shutdownSession(input: AcpBackendShutdownSessionInput): Promise<AcpBackendShutdownResult> {
    const scope = scopeFromInput(input);
    const session = await this.sessionService.getSession(input.sessionId, scope);
    const runtime = this.runtimes.get(input.sessionId);
    if (!runtime) {
      return { session };
    }
    if (!runtime.cleanupPromise) {
      runtime.cleanupPromise = this.shutdownRuntime(session, runtime);
    }
    return runtime.cleanupPromise;
  }

  async restartSession(input: AcpBackendRestartSessionInput): Promise<AcpBackendRestartResult> {
    const scope = scopeFromInput(input);
    const verified = await this.sessionService.getSession(input.sessionId, scope);
    if (!verified.acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot restart ACP session ${verified.id} without a verified ACP agent session id`
      );
    }
    const previous = this.runtimes.get(input.sessionId);
    if (previous) {
      await previous.client.shutdown();
      this.disposeRuntime(previous);
      this.runtimes.delete(input.sessionId);
    }

    const backendRunId = this.backendRunIdProvider();
    const attempt = (this.restartAttempts.get(input.sessionId) ?? 0) + 1;
    this.restartAttempts.set(input.sessionId, attempt);
    const backoffDelayMs = Math.max(
      0,
      this.options.restartBackoff?.({
        sessionId: input.sessionId,
        backendRunId,
        attempt,
        reason: input.reason,
      }) ?? 0
    );
    this.options.onRestartBackoff?.({
      sessionId: input.sessionId,
      backendRunId,
      attempt,
      reason: input.reason,
      delayMs: backoffDelayMs,
    });

    const restarted = await this.sessionService.recordBackendRestart(
      input.sessionId,
      scope,
      backendRunId
    );
    const result = await this.startResumeRuntime(restarted, input.cwd, backendRunId);
    return { ...result, backoffDelayMs };
  }

  async adoptSessionRuntime(input: AcpBackendAdoptRuntimeInput): Promise<void> {
    const scope = scopeFromInput(input);
    await this.sessionService.getSession(input.sessionId, scope);
    this.runtimes.set(
      input.sessionId,
      this.bindRuntime({
        sessionId: input.sessionId,
        scope,
        backendRunId: input.backendRunId,
        client: input.client,
        disposers: [],
      })
    );
  }

  private async startNewRuntime(
    session: AcpSessionRecord,
    cwd: string,
    mcpServers: AcpJsonObject | undefined
  ): Promise<AcpBackendStartResult> {
    const backendRunId = this.backendRunIdProvider();
    const runtime = this.createRuntime(session, cwd, backendRunId);
    let started = false;
    try {
      const initializeResult = await this.startAndInitialize(runtime);
      started = true;
      const response = await runtime.client.request<AcpBackendSessionResult>(
        'session/new',
        this.buildSessionStartParams(session.id, backendRunId, cwd, mcpServers)
      );
      const attachment = attachmentFromResult(response.result, backendRunId);
      const attached = await this.sessionService.attachAgentSession(
        session.id,
        runtime.scope,
        attachment
      );
      const ready = await this.transitionIfInitializing(attached, runtime.scope, {
        type: 'agent_ready',
      });
      this.runtimes.set(session.id, runtime);
      return { session: ready, initializeResult, backendRunId };
    } catch (error) {
      await this.failStartup(session.id, runtime.scope, runtime, started);
      throw error;
    }
  }

  private async startResumeRuntime(
    session: AcpSessionRecord,
    cwd: string,
    forcedBackendRunId?: string
  ): Promise<AcpBackendStartResult> {
    const acpAgentSessionId = session.acpAgentSessionId;
    if (!acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot resume ACP session ${session.id} without ACP agent session id`
      );
    }
    const backendRunId = forcedBackendRunId ?? this.backendRunIdProvider();
    const runtime = this.createRuntime(session, cwd, backendRunId);
    let started = false;
    try {
      const initializeResult = await this.startAndInitialize(runtime);
      started = true;
      const response = await runtime.client.request<AcpBackendSessionResult>('session/resume', {
        sessionId: acpAgentSessionId,
        cwd,
        _meta: this.buildAegisMetadata(session.id, backendRunId),
      });
      const attachment = attachmentFromResult(response.result, backendRunId);
      const attached = await this.sessionService.attachAgentSession(
        session.id,
        runtime.scope,
        attachment
      );
      const ready = await this.transitionIfInitializing(attached, runtime.scope, {
        type: 'agent_ready',
      });
      this.runtimes.set(session.id, runtime);
      return { session: ready, initializeResult, backendRunId };
    } catch (error) {
      await this.failStartup(session.id, runtime.scope, runtime, started);
      throw error;
    }
  }

  private async startLoadRuntime(
    session: AcpSessionRecord,
    cwd: string,
    mcpServers?: AcpJsonObject
  ): Promise<AcpBackendStartResult> {
    const acpAgentSessionId = session.acpAgentSessionId;
    if (!acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot load ACP session ${session.id} without ACP agent session id`
      );
    }
    const backendRunId = this.backendRunIdProvider();
    const runtime = this.createRuntime(session, cwd, backendRunId);
    let started = false;
    try {
      const initializeResult = await this.startAndInitialize(runtime);
      started = true;
      const response = await runtime.client.request<AcpBackendSessionResult>('session/load', {
        sessionId: acpAgentSessionId,
        cwd,
        ...(mcpServers ? { mcpServers } : {}),
        _meta: this.buildAegisMetadata(session.id, backendRunId),
      });
      const attachment = attachmentFromResult(response.result, backendRunId);
      const attached = await this.sessionService.attachAgentSession(
        session.id,
        runtime.scope,
        attachment
      );
      const ready = await this.transitionIfInitializing(attached, runtime.scope, {
        type: 'agent_ready',
      });
      this.runtimes.set(session.id, runtime);
      return { session: ready, initializeResult, backendRunId };
    } catch (error) {
      await this.failStartup(session.id, runtime.scope, runtime, started);
      throw error;
    }
  }

  private createRuntime(
    session: AcpSessionRecord,
    cwd: string,
    backendRunId: string
  ): AcpBackendRuntime {
    const context: AcpBackendClientFactoryContext = {
      durableSessionId: session.id,
      tenantId: session.tenantId,
      ownerKeyId: session.ownerKeyId,
      backendRunId,
      cwd,
    };
    return this.bindRuntime({
      sessionId: session.id,
      scope: { tenantId: session.tenantId, ownerKeyId: session.ownerKeyId },
      backendRunId,
      client: this.clientFactory(context),
      disposers: [],
    });
  }

  private bindRuntime(runtime: AcpBackendRuntime): AcpBackendRuntime {
    runtime.disposers.push(
      runtime.client.onNotification(notification => {
        this.options.onRawNotification?.(notification);
      }),
      runtime.client.onRequest(request => {
        if (request.method === 'session/request_permission') {
          this.trackPendingApproval(runtime.sessionId, request);
        }
        this.options.onRawRequest?.(request);
      }),
      runtime.client.onExit(exit => {
        void this.handleRuntimeExit(runtime, exit);
      })
    );
    return runtime;
  }

  private async dispatchPromptAction(
    runtime: AcpBackendRuntime,
    acpSessionId: string,
    action: AcpActionRecord
  ): Promise<AcpBackendDispatchActionResult> {
    const text = requireActionMetadataString(action, 'text', 'prompt action metadata.text');
    await this.sessionService.transition(action.sessionId, runtime.scope, { type: 'run_started' });
    try {
      const response = await runtime.client.request<AcpJsonValue>('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text }],
      });
      await this.sessionService.transition(action.sessionId, runtime.scope, {
        type: 'run_completed',
      });
      return { resultMetadata: primitiveResultMetadata(response.result) };
    } catch (error) {
      await this.sessionService.transition(action.sessionId, runtime.scope, {
        type: 'runtime_failed',
      });
      throw error;
    }
  }

  private async dispatchApprovalAction(
    runtime: AcpBackendRuntime,
    action: AcpActionRecord
  ): Promise<AcpBackendDispatchActionResult> {
    if (!isNonEmptyString(action.approvalId)) {
      throw new AcpBackendLifecycleError(
        `ACP ${action.actionType} action ${action.actionId} requires approvalId`
      );
    }
    const optionId = requireActionMetadataString(
      action,
      'optionId',
      'approval action metadata.optionId'
    );
    await runtime.client.respond(action.approvalId, {
      outcome: {
        outcome: 'selected',
        optionId,
      },
    });
    return {
      resultMetadata: {
        approvalId: action.approvalId,
        outcome: 'selected',
      },
    };
  }

  private async startAndInitialize(
    runtime: AcpBackendRuntime
  ): Promise<AcpBackendInitializeResult> {
    await runtime.client.start();
    const response = await runtime.client.request<AcpBackendInitializeResult>('initialize', {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      clientCapabilities: this.clientCapabilities,
      clientInfo: this.clientInfo,
    });
    return response.result;
  }

  private buildSessionStartParams(
    durableSessionId: string,
    backendRunId: string,
    cwd: string,
    mcpServers: AcpJsonObject | undefined
  ): AcpJsonObject {
    return {
      cwd,
      ...(mcpServers ? { mcpServers } : {}),
      _meta: this.buildAegisMetadata(durableSessionId, backendRunId),
    };
  }

  private buildAegisMetadata(durableSessionId: string, backendRunId: string): AcpJsonObject {
    return {
      aegis: {
        sessionId: durableSessionId,
        backendRunId,
      },
    };
  }

  private async transitionIfInitializing(
    session: AcpSessionRecord,
    scope: AcpSessionScope,
    event: AcpSessionTransitionEvent
  ): Promise<AcpSessionRecord> {
    if (session.status !== 'initializing') return session;
    return this.sessionService.transition(session.id, scope, event);
  }

  private async failStartup(
    sessionId: string,
    scope: AcpSessionScope,
    runtime: AcpBackendRuntime,
    started: boolean
  ): Promise<void> {
    try {
      await this.sessionService.transition(sessionId, scope, { type: 'runtime_failed' });
    } finally {
      if (started) {
        await runtime.client.shutdown().catch(() => undefined);
      }
      this.disposeRuntime(runtime);
      this.runtimes.delete(sessionId);
    }
  }

  private async shutdownRuntime(
    session: AcpSessionRecord,
    runtime: AcpBackendRuntime
  ): Promise<AcpBackendShutdownResult> {
    let current = session;
    let exit: AcpChildProcessExitEvent | undefined;
    try {
      if (isActiveStatus(current.status)) {
        current = await this.sessionService.transition(session.id, runtime.scope, {
          type: 'close_requested',
        });
      }
      const acpAgentSessionId = current.acpAgentSessionId;
      if (acpAgentSessionId) {
        await runtime.client.request('session/close', { sessionId: acpAgentSessionId });
      }
      exit = await runtime.client.shutdown();
      if (current.status === 'closing') {
        current = await this.sessionService.transition(session.id, runtime.scope, {
          type: 'close_completed',
        });
      } else {
        current = await this.sessionService.getSession(session.id, runtime.scope);
      }
      return { session: current, exit };
    } finally {
      this.disposeRuntime(runtime);
      this.runtimes.delete(session.id);
    }
  }

  private async handleRuntimeExit(
    runtime: AcpBackendRuntime,
    exit: AcpChildProcessExitEvent
  ): Promise<void> {
    this.options.onRuntimeExit?.({
      sessionId: runtime.sessionId,
      backendRunId: runtime.backendRunId,
      exit,
    });
    if (exit.expected || runtime.cleanupPromise) return;
    try {
      await this.sessionService.transition(runtime.sessionId, runtime.scope, {
        type: 'runtime_failed',
      });
    } finally {
      this.disposeRuntime(runtime);
      this.runtimes.delete(runtime.sessionId);
    }
  }

  private requireRuntime(sessionId: string): AcpBackendRuntime {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) throw new AcpBackendRuntimeUnavailableError(sessionId);
    return runtime;
  }

  private trackPendingApproval(sessionId: string, request: AcpJsonRpcInboundRequest): void {
    const params =
      typeof request.params === 'object' && request.params !== null
        ? (request.params as Record<string, unknown>)
        : {};
    const toolCall =
      typeof params.toolCall === 'object' && params.toolCall !== null
        ? (params.toolCall as Record<string, unknown>)
        : {};
    this.pendingApprovals.set(sessionId, {
      approvalId: String(request.id),
      sessionId,
      tool: {
        toolName: typeof toolCall.kind === 'string' ? toolCall.kind : 'unknown',
        description:
          typeof toolCall.title === 'string' ? toolCall.title : 'Tool execution requested',
        input:
          typeof toolCall.input === 'object' && toolCall.input !== null
            ? (toolCall.input as Record<string, unknown>)
            : undefined,
      },
      requestedAt: new Date().toISOString(),
    });
  }

  private disposeRuntime(runtime: AcpBackendRuntime): void {
    for (const dispose of runtime.disposers.splice(0)) {
      dispose();
    }
    this.pendingApprovals.delete(runtime.sessionId);
  }
}

export function createDefaultAcpBackendClient(
  context: AcpBackendClientFactoryContext,
  options: {
    childProcessOptions?: Omit<AcpChildProcessOptions, 'cwd'>;
    jsonRpcClientOptions?: Omit<AcpJsonRpcClientOptions, 'child'>;
  } = {}
): AcpBackendClient {
  const child = new AcpChildProcess({
    ...options.childProcessOptions,
    cwd: context.cwd,
  });
  return new AcpJsonRpcClient({
    ...options.jsonRpcClientOptions,
    child,
    idNamespace:
      options.jsonRpcClientOptions?.idNamespace ?? `aegis-acp-${context.durableSessionId}`,
  });
}

function scopeFromInput(input: AcpSessionScope): AcpSessionScope {
  return { tenantId: input.tenantId, ownerKeyId: input.ownerKeyId };
}

function toCreateSessionInput(input: AcpBackendCreateSessionInput): AcpCreateSessionInput {
  return {
    tenantId: input.tenantId,
    ownerKeyId: input.ownerKeyId,
    parentSessionId: input.parentSessionId,
    rootSessionId: input.rootSessionId,
    correlationId: input.correlationId,
    resumeFromSessionId: input.resumeFromSessionId,
    backendMetadata: input.backendMetadata,
  };
}

function attachmentFromResult(
  result: AcpBackendSessionResult,
  backendRunId: string
): AcpAgentSessionAttachment {
  if (!isNonEmptyString(result.sessionId)) {
    throw new AcpBackendLifecycleError('ACP session lifecycle response omitted sessionId');
  }
  return {
    acpAgentSessionId: result.sessionId,
    ...(isNonEmptyString(result.claudeSessionId)
      ? { claudeSessionId: result.claudeSessionId }
      : {}),
    backendRunId,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function requireActionMetadataString(action: AcpActionRecord, key: string, label: string): string {
  const value = optionalActionMetadataString(action, key);
  if (value === undefined) {
    throw new AcpBackendLifecycleError(
      `ACP ${action.actionType} action ${action.actionId} requires ${label}`
    );
  }
  return value;
}

function optionalActionMetadataString(action: AcpActionRecord, key: string): string | undefined {
  const value = action.metadata?.[key];
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) {
    throw new AcpBackendLifecycleError(
      `ACP ${action.actionType} action ${action.actionId} metadata.${key} must be a non-empty string`
    );
  }
  return value;
}

function primitiveResultMetadata(result: AcpJsonValue): AcpBackendMetadata {
  const metadata: AcpBackendMetadata = {};
  if (!isJsonObject(result)) return metadata;
  for (const [key, value] of Object.entries(result)) {
    if (isBackendMetadataValue(value)) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function isJsonObject(value: AcpJsonValue): value is AcpJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBackendMetadataValue(value: AcpJsonValue): value is AcpBackendMetadataValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function assertNeverAction(value: never): never {
  throw new Error(`Unhandled ACP action type: ${value}`);
}

function isActiveStatus(status: AcpSessionRecord['status']): boolean {
  return (
    status === 'initializing' ||
    status === 'idle' ||
    status === 'running' ||
    status === 'paused' ||
    status === 'intervening'
  );
}

function readPackageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const pkg: unknown = JSON.parse(readFileSync(join(currentDir, '../../../package.json'), 'utf8'));
  if (typeof pkg !== 'object' || pkg === null || !('version' in pkg)) {
    return '0.0.0';
  }
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

export function hasLoadSessionCapability(initializeResult: AcpBackendInitializeResult): boolean {
  const capabilities = initializeResult.agentCapabilities;
  if (typeof capabilities !== 'object' || capabilities === null || Array.isArray(capabilities)) {
    return false;
  }
  return (capabilities as Record<string, unknown>).loadSession === true;
}
