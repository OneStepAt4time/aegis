/**
 * backend/types.ts — ACP Backend type definitions.
 *
 * Issue #4534: Extracted from backend.ts for gate:arch compliance.
 */

import type {
  AcpChildProcessExitEvent,
  AcpChildProcessOptions,
  AcpChildProcessShutdownOptions,
} from '../child-process.js';
import type {
  AcpJsonObject,
  AcpJsonRpcClientOptions,
  AcpJsonRpcId,
  AcpJsonRpcInboundRequest,
  AcpJsonRpcNotification,
  AcpJsonRpcRequestOptions,
  AcpJsonRpcResponseError,
  AcpJsonRpcSuccess,
  AcpJsonValue,
} from '../json-rpc-client.js';
import type { AcpActionMetadata, AcpActionRecord } from '../action-queue.js';
import type {
  AcpAgentSessionAttachment,
  AcpBackendMetadata,
  AcpBackendMetadataValue,
  AcpCreateSessionInput,
  AcpSessionRecord,
  AcpSessionScope,
  AcpSessionTransitionEvent,
  PromptValidationWarning,
} from '../types.js';

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
  /**
   * Issue #4522 AC #3: Session's effective permission mode. Propagated through
   * the clientFactory so the resulting AcpChildProcess can inject
   * \`--permission-mode <mode>\` at spawn time, closing the retire→wake CC
   * v2.1.143 persistence threat.
   */
  permissionMode?: string;
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
  /** Issue #4456: Promise that resolves when the async runtime handshake completes.
   * Only present for createSessionAsync; absent for synchronous start methods. */
  ready?: Promise<AcpBackendStartResult>;
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
  /** Issue #3897: Emit validation_warning transitions for monitoring (default: false). */
  emitValidationWarnings?: boolean;
  sessionService: AcpBackendSessionService;
  clientFactory?: (context: AcpBackendClientFactoryContext) => AcpBackendClient;
  backendRunIdProvider?: () => string;
  clientInfo?: AcpJsonObject;
  clientCapabilities?: AcpJsonObject;
  childProcessOptions?: Omit<AcpChildProcessOptions, 'cwd'>;
  jsonRpcClientOptions?: Omit<AcpJsonRpcClientOptions, 'child'>;
  onRawNotification?: (notification: AcpJsonRpcNotification, context: { sessionId: string } & AcpSessionScope) => void;
  onRawRequest?: (request: AcpJsonRpcInboundRequest) => void;
  onRuntimeExit?: (event: AcpBackendRuntimeExitEvent) => void;
  restartBackoff?: (context: AcpBackendRestartBackoffContext) => number;
  /** Issue #3900: When true, validation warnings from prompt output cause action failure. */
  strictValidation?: boolean;
  onRestartBackoff?: (event: AcpBackendRestartBackoffEvent) => void;
}

export interface AcpBackendRuntime {
  sessionId: string;
  scope: AcpSessionScope;
  backendRunId: string;
  client: AcpBackendClient;
  disposers: (() => void)[];
  cleanupPromise?: Promise<AcpBackendShutdownResult>;
  agentCapabilities?: AcpJsonValue;
}
