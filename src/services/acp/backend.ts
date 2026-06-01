/**
 * backend.ts — ACP Backend core class.
 *
 * Issue #4534: Split from monolithic backend.ts for gate:arch compliance.
 * Types moved to backend/types.ts, errors to backend/errors.ts,
 * utilities to backend/utils.ts, runtime lifecycle to backend/runtime.ts,
 * prompt delivery to backend/prompts.ts, drivers to backend/drivers.ts,
 * action dispatch to backend/actions.ts.
 */

import { randomUUID } from 'node:crypto';
import type {
  AcpJsonObject,
  AcpJsonRpcInboundRequest,
  AcpJsonValue,
} from './json-rpc-client.js';
import type { AcpActionRecord } from './action-queue.js';
import type {
  AcpSessionRecord,
  AcpSessionScope,
} from './types.js';
import { StructuredLogger } from '../../logger.js';
import {
  AcpBackendLifecycleError,
  AcpBackendRuntimeUnavailableError,
} from './backend/errors.js';
import type {
  AcpBackendClient,
  AcpBackendClientFactoryContext,
  AcpBackendCreateSessionInput,
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
  AcpBackendOptions,
  AcpBackendRuntime,
  AcpBackendShutdownSessionInput,
  AcpBackendCancelSessionInput,
  AcpBackendRestartSessionInput,
  AcpBackendResumeSessionInput,
  AcpBackendLoadSessionInput,
  AcpBackendAdoptRuntimeInput,
} from './backend/types.js';
import {
  createDefaultAcpBackendClient,
  hasLoadSessionCapability,
  scopeFromInput,
  toCreateSessionInput,
  isNonEmptyString,
  requireActionMetadataString,
  primitiveResultMetadata,
  assertNeverAction,
  isActiveStatus,
  readPackageVersion,
} from './backend/utils.js';
import * as runtimeLifecycle from './backend/runtime.js';
import * as promptModule from './backend/prompts.js';
import * as driverModule from './backend/drivers.js';
import * as actionModule from './backend/actions.js';

const log = new StructuredLogger();

const DEFAULT_PROTOCOL_VERSION = 1;
const ACP_PROMPT_REQUEST_TIMEOUT_MS = 60_000;
const ACP_PROMPT_ACK_TIMEOUT_MS = 5_000;
const PACKAGE_VERSION = readPackageVersion();

export { hasLoadSessionCapability } from './backend/utils.js';

export class AcpBackend {
  private readonly sessionService: AcpBackendOptions['sessionService'];
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

  private getRuntimeDeps(): runtimeLifecycle.RuntimeLifecycleDeps {
    return {
      sessionService: this.sessionService,
      clientFactory: this.clientFactory,
      backendRunIdProvider: this.backendRunIdProvider,
      clientInfo: this.clientInfo,
      clientCapabilities: this.clientCapabilities,
      options: this.options,
      runtimes: this.runtimes,
      inFlightPrompts: this.inFlightPrompts,
      pendingApprovals: this.pendingApprovals,
    };
  }

  private getPromptDeps(): promptModule.PromptDeps {
    return {
      sessionService: this.sessionService,
      inFlightPrompts: this.inFlightPrompts,
    };
  }

  private getDriverDeps(): driverModule.DriverDeps {
    return {
      participants: this.participants,
      driverFences: this.driverFences,
      sessionService: this.sessionService,
    };
  }

  private getActionDeps(): actionModule.ActionDeps {
    return {
      sessionService: this.sessionService,
      inFlightPrompts: this.inFlightPrompts,
      strictValidation: this.strictValidation,
      emitValidationWarnings: this.emitValidationWarnings,
      shutdownSession: (input: AcpBackendShutdownSessionInput) => this.shutdownSession(input),
      cancelSession: (input: AcpBackendCancelSessionInput) => this.cancelSession(input),
    };
  }

  /**
   * Create a new ACP session: durable record → child process → initialize → session/new.
   * @throws {AcpBackendLifecycleError} on handshake or session/new failure
   */
  async createSession(input: AcpBackendCreateSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.createSession(toCreateSessionInput(input));
    return runtimeLifecycle.startNewRuntime(
      this.getRuntimeDeps(),
      session,
      input.cwd,
      input.mcpServers,
      input.systemPrompt
    );
  }

  /**
   * Issue #4456: Create a new ACP session without blocking on the runtime handshake.
   * Returns immediately with the durable session record while the child process
   * spawn + initialize + session/new handshake runs in the background.
   *
   * Use this for HTTP endpoints where synchronous handshake causes client timeouts
   * (e.g., POST /v1/sessions hanging for 2+ minutes).
   */
  async createSessionAsync(input: AcpBackendCreateSessionInput): Promise<AcpBackendStartResult> {
    const session = await this.sessionService.createSession(toCreateSessionInput(input));
    const backendRunId = this.backendRunIdProvider();

    // Fire-and-forget the handshake — caller gets the session record immediately.
    // On success, session transitions to agent_ready. On failure, transitions to error.
    runtimeLifecycle.startNewRuntimeBackground(
      this.getRuntimeDeps(),
      session,
      input.cwd,
      input.mcpServers,
      input.systemPrompt,
      backendRunId
    ).catch((err) => {
      log.error(
        { component: 'acp-backend', operation: 'asyncStartFailed', attributes: { sessionId: session.id, error: String(err) } }
      );
    });

    return { session, initializeResult: {}, backendRunId };
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
    return runtimeLifecycle.startResumeRuntime(this.getRuntimeDeps(), session, input.cwd);
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
    return runtimeLifecycle.startLoadRuntime(
      this.getRuntimeDeps(),
      session,
      input.cwd,
      input.mcpServers
    );
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
    return promptModule.sendPrompt(this.getPromptDeps(), runtime, sessionId, text, scope);
  }

  /**
   * Claim the driver seat for a session. Only one driver is allowed at a time.
   * @throws {AcpBackendLifecycleError} if a driver is already claimed
   */
  async claimDriver(input: AcpBackendClaimDriverInput): Promise<AcpBackendDriverResult> {
    return driverModule.claimDriver(this.getDriverDeps(), input);
  }

  /**
   * Release the driver seat. The caller must be the current driver.
   * @throws {AcpBackendLifecycleError} if not the current driver
   */
  async releaseDriver(input: AcpBackendReleaseDriverInput): Promise<AcpBackendDriverResult> {
    return driverModule.releaseDriver(this.getDriverDeps(), input);
  }

  /**
   * Transfer the driver seat to another subscriber. The current driver's
   * fence is incremented.
   */
  async transferDriver(input: AcpBackendTransferDriverInput): Promise<AcpBackendDriverResult> {
    return driverModule.transferDriver(this.getDriverDeps(), input);
  }

  /** Return current driver, observers, and active count for a session. */
  getParticipants(sessionId: string, scope: AcpSessionScope): AcpBackendParticipantsResult {
    return driverModule.getParticipants(this.getDriverDeps(), sessionId, scope);
  }

  /**
   * Dispatch an action from the action queue to the appropriate ACP runtime method.
   */
  async dispatchAction(action: AcpActionRecord): Promise<AcpBackendDispatchActionResult> {
    // Handle close action without requiring runtime (idempotent shutdown)
    if (action.actionType === 'close') {
      const result = await this.shutdownSession(action);
      return { resultMetadata: { status: result.session.status } };
    }
    const runtime = this.requireRuntime(action.sessionId);
    return actionModule.dispatchAction(this.getActionDeps(), runtime, action);
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
      runtime.cleanupPromise = runtimeLifecycle.shutdownRuntime(
        this.getRuntimeDeps(),
        session,
        runtime
      );
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
      runtimeLifecycle.disposeRuntime(this.getRuntimeDeps(), previous);
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
    const result = await runtimeLifecycle.startResumeRuntime(
      this.getRuntimeDeps(),
      restarted,
      input.cwd,
      backendRunId
    );
    return { ...result, backoffDelayMs };
  }

  async adoptSessionRuntime(input: AcpBackendAdoptRuntimeInput): Promise<void> {
    const scope = scopeFromInput(input);
    await this.sessionService.getSession(input.sessionId, scope);
    this.runtimes.set(
      input.sessionId,
      runtimeLifecycle.bindRuntime(this.getRuntimeDeps(), {
        sessionId: input.sessionId,
        scope,
        backendRunId: input.backendRunId,
        client: input.client,
        disposers: [],
      })
    );
  }

  private requireRuntime(sessionId: string): AcpBackendRuntime {
    const runtime = this.runtimes.get(sessionId);
    if (!runtime) throw new AcpBackendRuntimeUnavailableError(sessionId);
    return runtime;
  }
}

// Re-export types for backward compatibility (Issue #4534)
// Re-export values for backward compatibility (Issue #4534)
export {
  AcpBackendLifecycleError,
  AcpBackendRuntimeUnavailableError,
  createDefaultAcpBackendClient,
} from './backend/utils.js';

export type {
  AcpBackendAdoptRuntimeInput,
  AcpBackendCancelResult,
  AcpBackendCancelSessionInput,
  AcpBackendClient,
  AcpBackendClientFactoryContext,
  AcpBackendCreateSessionInput,
  AcpBackendDispatchActionResult,
  AcpBackendInitializeResult,
  AcpBackendLoadSessionInput,
  AcpBackendOptions,
  AcpBackendRestartBackoffContext,
  AcpBackendRestartBackoffEvent,
  AcpBackendRestartResult,
  AcpBackendRestartSessionInput,
  AcpBackendResumeSessionInput,
  AcpBackendRuntimeExitEvent,
  AcpBackendScopedRuntimeInput,
  AcpBackendSessionResult,
  AcpBackendSessionService,
  AcpBackendShutdownResult,
  AcpBackendShutdownSessionInput,
  AcpBackendStartResult,
} from './backend/types.js';
