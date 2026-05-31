import { randomUUID } from 'node:crypto';

import {
  AcpChildProcess,
  type AcpChildProcessExitEvent,
  type AcpChildProcessOptions,
} from './child-process.js';
import {
  AcpJsonRpcClient,
  type AcpJsonObject,
  type AcpJsonRpcClientOptions,
  type AcpJsonRpcInboundRequest,
  type AcpJsonValue,
} from './json-rpc-client.js';
import type { AcpActionRecord } from './action-queue.js';
import { validatePromptOutput } from './content-validation.js';
import type {
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionTransitionEvent,
  PromptValidationWarning,
} from './types.js';

// Re-export types from extracted modules for backward compatibility
export type {
  AcpBackendClient,
  AcpBackendSessionService,
  AcpBackendCreateSessionInput,
  AcpBackendScopedRuntimeInput,
  AcpBackendResumeSessionInput,
  AcpBackendLoadSessionInput,
  AcpBackendCancelSessionInput,
  AcpBackendShutdownSessionInput,
  AcpBackendRestartSessionInput,
  AcpBackendAdoptRuntimeInput,
  AcpBackendClientFactoryContext,
  AcpBackendInitializeResult,
  AcpBackendSessionResult,
  AcpBackendStartResult,
  AcpBackendCancelResult,
  AcpBackendShutdownResult,
  AcpBackendRestartResult,
  AcpBackendDispatchActionResult,
  AcpBackendApprovalInput,
  AcpBackendApprovalResult,
  AcpPendingApproval,
  AcpBackendClaimDriverInput,
  AcpBackendReleaseDriverInput,
  AcpBackendTransferDriverInput,
  AcpBackendDriverResult,
  AcpBackendParticipantsResult,
  AcpBackendRuntimeExitEvent,
  AcpBackendRestartBackoffContext,
  AcpBackendRestartBackoffEvent,
  AcpBackendOptions,
  AcpBackendRuntime,
} from './acp-backend-types.js';

export { AcpBackendLifecycleError, AcpBackendRuntimeUnavailableError } from './acp-backend-errors.js';
export { hasLoadSessionCapability } from './acp-backend-utils.js';

import { AcpBackendLifecycleError, AcpBackendRuntimeUnavailableError } from './acp-backend-errors.js';
import type {
  AcpBackendClient,
  AcpBackendSessionService,
  AcpBackendClientFactoryContext,
  AcpBackendCreateSessionInput,
  AcpBackendResumeSessionInput,
  AcpBackendLoadSessionInput,
  AcpBackendCancelSessionInput,
  AcpBackendShutdownSessionInput,
  AcpBackendRestartSessionInput,
  AcpBackendAdoptRuntimeInput,
  AcpBackendInitializeResult,
  AcpBackendSessionResult,
  AcpBackendStartResult,
  AcpBackendCancelResult,
  AcpBackendShutdownResult,
  AcpBackendRestartResult,
  AcpBackendDispatchActionResult,
  AcpBackendApprovalInput,
  AcpBackendApprovalResult,
  AcpPendingApproval,
  AcpBackendClaimDriverInput,
  AcpBackendReleaseDriverInput,
  AcpBackendTransferDriverInput,
  AcpBackendDriverResult,
  AcpBackendParticipantsResult,
  AcpBackendOptions,
  AcpBackendRuntime,
} from './acp-backend-types.js';
import {
  scopeFromInput,
  toCreateSessionInput,
  attachmentFromResult,
  isNonEmptyString,
  requireActionMetadataString,
  primitiveResultMetadata,
  assertNeverAction,
  isActiveStatus,
  readPackageVersion,
} from './acp-backend-utils.js';

import { StructuredLogger } from '../../logger.js';

const log = new StructuredLogger();

const DEFAULT_PROTOCOL_VERSION = 1;
const ACP_PROMPT_REQUEST_TIMEOUT_MS = 60_000;
const ACP_PROMPT_ACK_TIMEOUT_MS = 5_000;
const PACKAGE_VERSION = readPackageVersion();

export class AcpBackend {
  private readonly sessionService: AcpBackendSessionService;
  private readonly clientFactory: (context: AcpBackendClientFactoryContext) => AcpBackendClient;
  private readonly backendRunIdProvider: () => string;
  private readonly clientInfo: AcpJsonObject;
  private readonly clientCapabilities: AcpJsonObject;
  /** Issue #3900: Enforce validation warnings as errors. */
  private readonly strictValidation: boolean;
  /** Emit validation_warning transitions for monitoring. */
  private readonly emitValidationWarnings: boolean;
  private readonly runtimes = new Map<string, AcpBackendRuntime>();
  private readonly restartAttempts = new Map<string, number>();
  private readonly pendingApprovals = new Map<string, AcpPendingApproval>();
  private readonly participants = new Map<string, AcpBackendParticipantsResult>();
  private readonly driverFences = new Map<string, number>();
  /** Issue #2805: Track in-flight prompt requests per session to reject concurrent sends (CC blocks on background terminals). */
  private readonly inFlightPrompts = new Map<string, AbortController>();

  constructor(private readonly options: AcpBackendOptions) {
    this.sessionService = options.sessionService;
    this.strictValidation = options.strictValidation ?? false;
    this.emitValidationWarnings = options.emitValidationWarnings ?? false;
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

  /**
   * Create a new ACP session: durable record → child process → initialize → session/new.
   * @throws {AcpBackendLifecycleError} on handshake or session/new failure
   */
  async createSession(input: AcpBackendCreateSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.createSession(toCreateSessionInput(input));
    return this.startNewRuntime(session, input.cwd, input.mcpServers, input.systemPrompt, input.env, input.permissionMode);
  }

  async createSessionAsync(input: AcpBackendCreateSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.createSession(toCreateSessionInput(input));
    const backendRunId = this.backendRunIdProvider();

    const ready = this.startNewRuntimeBackground(session, input.cwd, input.mcpServers, input.systemPrompt, backendRunId, input.env, input.permissionMode);
    ready.catch((err) => {
      log.error({
        component: 'acp-backend',
        operation: 'asyncStartFailed',
        attributes: { sessionId: session.id, error: String(err) },
      });
    });

    return { session, initializeResult: {}, backendRunId, ready };
  }

  /**
   * Resume an existing ACP session by spawning a fresh child process and calling session/resume.
   * Requires an existing acpAgentSessionId on the session record.
   */
  async resumeSession(input: AcpBackendResumeSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.getSession(input.sessionId, scopeFromInput(input));
    if (!session.acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot resume ACP session ${session.id} without a verified ACP agent session id`
      );
    }
    return this.startResumeRuntime(session, input.cwd);
  }

  /**
   * Load an existing ACP session into a fresh runtime, calling session/load
   * to restore context. Used when reconnecting to a previously active session.
   */
  async loadSession(input: AcpBackendLoadSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.getSession(input.sessionId, scopeFromInput(input));
    if (!session.acpAgentSessionId) {
      throw new AcpBackendLifecycleError(
        `Cannot load ACP session ${session.id} without a verified ACP agent session id`
      );
    }
    return this.startLoadRuntime(session, input.cwd, input.mcpServers);
  }

  /**
   * Send session/cancel to the ACP agent for the given session.
   * The agent decides how to handle cancellation (stop current work, rollback, etc).
   */
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

  /**
   * Approve a pending permission request from the ACP agent.
   * Responds with the 'allow-once' option to the pending approval.
   */
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

  /**
   * Reject a pending permission request from the ACP agent.
   * Responds with the 'reject-once' option to the pending approval.
   */
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

  /** Return the pending permission approval for a session, or null. */
  getPendingApproval(sessionId: string): AcpPendingApproval | null {
    return this.pendingApprovals.get(sessionId) ?? null;
  }

  /** Return the ACP client and agent capabilities for an active runtime, or undefined. */
  getRuntime(sessionId: string): { client: AcpBackendClient; agentCapabilities?: AcpJsonValue } | undefined {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) return undefined;
    return { client: runtime.client, agentCapabilities: runtime.agentCapabilities };
  }



  /** Issue #4294: Return all session IDs with active ACP runtimes. */
  getActiveRuntimeIds(): string[] {
    return [...this.runtimes.keys()];
  }
  /**
   * Issue #3093: Direct prompt delivery to ACP runtime.
   * Bypasses the action queue for immediate prompt delivery during session creation
   * and send_message API calls. Returns {delivered, attempts} matching the session.ts stub contract.
   */
  async sendPrompt(
    sessionId: string,
    text: string,
    scope: AcpSessionScope
  ): Promise<{ delivered: boolean; attempts: number; error?: string }> {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      return { delivered: false, attempts: 0, error: 'no_acp_runtime' };
    }

    // Issue #2805: Reject concurrent prompts — CC blocks on background terminals
    const existing = this.inFlightPrompts.get(sessionId);
    if (existing) {
      throw new AcpBackendLifecycleError(
        `Session ${sessionId} already has a prompt in-flight. ` +
        'Claude Code blocks on background terminals — wait for the current prompt to complete or cancel it.'
      );
    }

    const abort = new AbortController();
    this.inFlightPrompts.set(sessionId, abort);

    try {
      const session = await this.sessionService.getSession(sessionId, scope);
      const acpSessionId = session.acpAgentSessionId;
      if (!acpSessionId) {
        return { delivered: false, attempts: 0, error: 'no_agent_session' };
      }

      // #3479: Revert notify() back to request() with a short ack timeout.
      // #3423's notify() fix silently swallowed CC's -32601 "Method not found"
      // error because JSON-RPC notifications have no response. Using request()
      // with a 5s timeout: if CC acks within 5s → confirmed delivered. If it
      // times out → CC likely received it but hasn't responded yet → mark as
      // delivered (same behavior as notify, but with a chance to catch errors).
      // If CC returns an actual error (e.g. -32601) → surface it properly.
      try {
        await runtime.client.request('session/prompt', {
          sessionId: acpSessionId,
          prompt: [{ type: 'text', text }],
        }, { timeoutMs: ACP_PROMPT_ACK_TIMEOUT_MS });
      } catch (err) {
        if (err instanceof Error && err.name === 'AcpJsonRpcTimeoutError') {
          // Timeout is acceptable — CC likely received the prompt but hasn't
          // responded yet. Log and continue as delivered.
          log.warn({ component: 'acp-backend', operation: 'promptAckTimeout', attributes: { sessionId } });
        } else {
          // Actual error (e.g. -32601 Method not found) — surface it
          throw err;
        }
      }
      return { delivered: true, attempts: 1 };
    } catch (err) {
      if (err instanceof Error && err.name === 'AcpJsonRpcTimeoutError') {
        // Handled above — should not reach here, but defensive
        return { delivered: true, attempts: 1 };
      }
      log.warn({ component: 'acp-backend', operation: 'promptError', attributes: { sessionId, error: (err as Error).message } });
      return { delivered: false, attempts: 1, error: (err as Error).message };
    } finally {
      this.inFlightPrompts.delete(sessionId);
    }
  }

  /**
   * Claim the driver seat for a session. Only one driver is allowed at a time.
   * @throws {AcpBackendLifecycleError} if a driver is already claimed
   */
  async claimDriver(input: AcpBackendClaimDriverInput): Promise<AcpBackendDriverResult> {
    const scope = scopeFromInput(input);
    // Capture participant state before yielding to avoid TOCTOU race (#3921)
    let record = this.participants.get(input.sessionId);
    if (!record) {
      record = { sessionId: input.sessionId, driver: null, observers: [], activeCount: 0 };
      this.participants.set(input.sessionId, record);
    }
    if (record.driver) {
      throw new AcpBackendLifecycleError(`Driver already claimed for session ${input.sessionId}`);
    }
    // Claim atomically before any await — prevents concurrent claims
    const fence = (this.driverFences.get(input.sessionId) ?? 0) + 1;
    this.driverFences.set(input.sessionId, fence);
    record.driver = { subscriberId: input.holderId, role: 'driver' };
    record.activeCount = 1 + record.observers.length;
    await this.sessionService.getSession(input.sessionId, scope);
    return { sessionId: input.sessionId, holderId: input.holderId, role: 'driver', fence, ttlMs: input.ttlMs };
  }

  /**
   * Release the driver seat. The caller must be the current driver.
   * @throws {AcpBackendLifecycleError} if not the current driver
   */
  async releaseDriver(input: AcpBackendReleaseDriverInput): Promise<AcpBackendDriverResult> {
    const scope = scopeFromInput(input);
    // Capture and mutate participant state before yielding to avoid TOCTOU race (#3921)
    const record = this.participants.get(input.sessionId);
    if (!record || !record.driver || record.driver.subscriberId !== input.holderId) {
      throw new AcpBackendLifecycleError(`Not the driver of session ${input.sessionId}`);
    }
    record.driver = null;
    record.activeCount = record.observers.length;
    await this.sessionService.getSession(input.sessionId, scope);
    return { sessionId: input.sessionId, holderId: null, role: 'observer' };
  }

  /**
   * Transfer the driver seat to another subscriber. The current driver's
   * fence is incremented.
   */
  async transferDriver(input: AcpBackendTransferDriverInput): Promise<AcpBackendDriverResult> {
    const scope = scopeFromInput(input);
    // Capture and mutate participant state before yielding to avoid TOCTOU race (#3921)
    const record = this.participants.get(input.sessionId);
    if (!record || !record.driver) {
      throw new AcpBackendLifecycleError(`No driver to transfer for session ${input.sessionId}`);
    }
    const fence = (this.driverFences.get(input.sessionId) ?? 0) + 1;
    this.driverFences.set(input.sessionId, fence);
    record.driver = { subscriberId: input.targetSubscriberId, role: 'driver' };
    await this.sessionService.getSession(input.sessionId, scope);
    return { sessionId: input.sessionId, holderId: input.targetSubscriberId, role: 'driver', fence };
  }

  /** Return current driver, observers, and active count for a session. */
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

  /**
   * Dispatch an action from the action queue to the appropriate ACP runtime method.
   * Handles: close, prompt, approve, reject, cancel. Throws for unimplemented types.
   */
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

  /**
   * Gracefully shut down an ACP runtime: transitions status, sends session/close,
   * kills the child process, and cleans up internal state.
   * No-op if no runtime exists for the session.
   */
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

  /**
   * Restart an ACP session: kill existing runtime, create fresh child process,
   * and call session/resume. Includes configurable backoff delay.
   */
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
      this.inFlightPrompts.delete(input.sessionId);
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
    mcpServers: AcpJsonObject | undefined,
    systemPrompt?: string,
    env?: Record<string, string>,
    permissionMode?: string
  ): Promise<AcpBackendStartResult> {
    const backendRunId = this.backendRunIdProvider();
    const runtime = this.createRuntime(session, cwd, backendRunId, env, permissionMode);
    let started = false;
    try {
      const initializeResult = await this.startAndInitialize(runtime);
      started = true;
      const response = await runtime.client.request<AcpBackendSessionResult>(
        'session/new',
        this.buildSessionStartParams(session.id, backendRunId, cwd, mcpServers, systemPrompt)
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
      runtime.agentCapabilities = initializeResult.agentCapabilities;
      this.runtimes.set(session.id, runtime);
      return { session: ready, initializeResult, backendRunId };
    } catch (error) {
      await this.failStartup(session.id, runtime.scope, runtime, started);
      throw error;
    }
  }

  /**
   * Issue #4456: Run the startNewRuntime handshake in the background.
   * Extracted from startNewRuntime to allow fire-and-forget startup.
   */
  private async startNewRuntimeBackground(
    session: AcpSessionRecord,
    cwd: string,
    mcpServers: AcpJsonObject | undefined,
    systemPrompt: string | undefined,
    backendRunId: string,
    env?: Record<string, string>,
    permissionMode?: string
  ): Promise<AcpBackendStartResult> {
    const runtime = this.createRuntime(session, cwd, backendRunId, env, permissionMode);
    let started = false;
    try {
      const initializeResult = await this.startAndInitialize(runtime);
      started = true;
      const response = await runtime.client.request<AcpBackendSessionResult>(
        'session/new',
        this.buildSessionStartParams(session.id, backendRunId, cwd, mcpServers, systemPrompt)
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
      runtime.agentCapabilities = initializeResult.agentCapabilities;
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
      runtime.agentCapabilities = initializeResult.agentCapabilities;
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
        mcpServers: mcpServers ?? [],
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
      runtime.agentCapabilities = initializeResult.agentCapabilities;
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
    backendRunId: string,
    env?: Record<string, string>,
    permissionMode?: string
  ): AcpBackendRuntime {
    const context: AcpBackendClientFactoryContext = {
      durableSessionId: session.id,
      tenantId: session.tenantId,
      ownerKeyId: session.ownerKeyId,
      backendRunId,
      cwd,
      env,
      permissionMode,
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
        this.options.onRawNotification?.(notification, { sessionId: runtime.sessionId, ...runtime.scope });
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
    const sessionId = action.sessionId;

    // Issue #2805: Reject concurrent prompts — CC blocks on background terminals
    const existing = this.inFlightPrompts.get(sessionId);
    if (existing) {
      throw new AcpBackendLifecycleError(
        `Session ${sessionId} already has a prompt in-flight (action ${action.actionId}). ` +
        'Claude Code blocks on background terminals — wait for the current prompt to complete or cancel it.'
      );
    }

    const abort = new AbortController();
    this.inFlightPrompts.set(sessionId, abort);

    const text = requireActionMetadataString(action, 'text', 'prompt action metadata.text');
    await this.sessionService.transition(sessionId, runtime.scope, { type: 'run_started' });
    try {
      const response = await runtime.client.request<AcpJsonValue>('session/prompt', {
        sessionId: acpSessionId,
        prompt: [{ type: 'text', text }],
      }, { timeoutMs: ACP_PROMPT_REQUEST_TIMEOUT_MS });

      // Issue #3853: Validate output for hallucination signatures
      // Issue #3900: Structured warnings + strict validation enforcement
      const warnings = validatePromptOutput(response.result, text);
      if (warnings.length > 0) {
        log.warn({ component: 'acp-backend', operation: 'contentValidationWarning', attributes: { sessionId, actionId: action.actionId, warnings: JSON.stringify(warnings) } });

        // Issue #3897: Emit validation_warning event for monitoring/alerting (opt-in)
        if (this.emitValidationWarnings) {
          try {
            await this.sessionService.transition(sessionId, runtime.scope, {
              type: 'validation_warning',
              warnings,
            });
          } catch (err) {
            log.warn({ component: 'acp-backend', operation: 'validationWarningEmitFailed', attributes: { error: String(err) } });
          }
        }

        // Issue #3900: Strict mode — fail the action on validation warnings
        if (this.strictValidation) {
          throw new AcpBackendLifecycleError(
            `ACP strict validation: ${warnings.length} warning(s) detected for action ${action.actionId} in session ${sessionId}: ${warnings.map(w => w.message).join('; ')}`
          );
        }
      }

      await this.sessionService.transition(sessionId, runtime.scope, {
        type: 'run_completed',
      });
      const metadata = primitiveResultMetadata(response.result);
      return { resultMetadata: metadata };
    } catch (error) {
      if (error instanceof Error && error.name === 'AcpJsonRpcTimeoutError') {
        log.warn({ component: 'acp-backend', operation: 'promptTimeout', attributes: { sessionId, actionId: action.actionId, timeout: ACP_PROMPT_REQUEST_TIMEOUT_MS } });
      }
      try {
        await this.sessionService.transition(sessionId, runtime.scope, {
          type: 'runtime_failed',
        });
      } catch (transitionError) {
        log.error({ component: 'acp-backend', operation: 'transitionToFailedError', attributes: { sessionId, error: String(transitionError) } });
      }
      throw error;
    } finally {
      this.inFlightPrompts.delete(sessionId);
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
    mcpServers: AcpJsonObject | undefined,
    systemPrompt?: string
  ): AcpJsonObject {
    return {
      cwd,
      mcpServers: mcpServers ?? [],
      _meta: {
        ...this.buildAegisMetadata(durableSessionId, backendRunId),
        ...(systemPrompt ? { systemPrompt } : {}),
      },
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
      try {
        await this.sessionService.transition(sessionId, scope, { type: 'runtime_failed' });
      } catch (transitionError) {
        log.error({ component: 'acp-backend', operation: 'startupTransitionFailed', attributes: { sessionId, error: String(transitionError) } });
      }
    } finally {
      if (started) {
        await runtime.client.shutdown().catch(() => undefined);
      }
      this.disposeRuntime(runtime);
      this.runtimes.delete(sessionId);
      this.inFlightPrompts.delete(sessionId);
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
      this.inFlightPrompts.delete(session.id);
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
      try {
        await this.sessionService.transition(runtime.sessionId, runtime.scope, {
          type: 'runtime_failed',
        });
      } catch (transitionError) {
        log.error({ component: 'acp-backend', operation: 'exitTransitionFailed', attributes: { sessionId: runtime.sessionId, error: String(transitionError) } });
      }
    } finally {
      this.disposeRuntime(runtime);
      this.runtimes.delete(runtime.sessionId);
      this.inFlightPrompts.delete(runtime.sessionId);
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
    env: context.env,
    permissionMode: context.permissionMode,
  });
  child.on('stderr', (event) => {
    const text = typeof event.chunk === 'string' ? event.chunk.trim() : '';
    if (text) {
      log.error({ component: 'acp-backend', operation: 'childStderr', attributes: { sessionId: context.durableSessionId.slice(0, 8), text } });
    }
  });
  return new AcpJsonRpcClient({
    ...options.jsonRpcClientOptions,
    child,
    idNamespace:
      options.jsonRpcClientOptions?.idNamespace ?? `aegis-acp-${context.durableSessionId}`,
  });
}
