export type AcpSessionStatus =
  | 'initializing'
  | 'idle'
  | 'running'
  | 'paused'
  | 'intervening'
  | 'closing'
  | 'closed'
  | 'failed';

export interface AcpSessionScope {
  tenantId: string;
  ownerKeyId: string;
}

export type AcpBackendMetadataValue = string | number | boolean | null;
export type AcpBackendMetadata = Record<string, AcpBackendMetadataValue>;

/** Issue #3897: Structured validation warning from ACP prompt output validation. */
export interface PromptValidationWarning {
  code: string;
  message: string;
}

export interface AcpSessionRecord extends AcpSessionScope {
  id: string;
  conversationId: string;
  transcriptId: string;
  acpAgentSessionId?: string;
  claudeSessionId?: string;
  currentBackendRunId?: string;
  parentSessionId?: string;
  rootSessionId?: string;
  correlationId?: string;
  resumeFromSessionId?: string;
  /**
   * Issue #4522 AC #3: Session's effective permission mode (e.g., 'default',
   * 'plan', 'bypassPermissions', 'acceptEdits', 'dontAsk', 'auto'). Set when
   * the ACP session record is created from the parent SessionInfo; read by
   * `createRuntime()` to propagate into the AcpChildProcess spawn so
   * --permission-mode is injected (closing the CC v2.1.143 retire→wake
   * persistence threat).
   */
  permissionMode?: string;
  status: AcpSessionStatus;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  failedAt?: number;
  backendMetadata?: AcpBackendMetadata;
  /** Issue #3897: Structured validation warnings from prompt output validation. */
  validationWarnings?: PromptValidationWarning[];
}

export interface AcpCreateSessionInput extends AcpSessionScope {
  parentSessionId?: string;
  rootSessionId?: string;
  correlationId?: string;
  resumeFromSessionId?: string;
  backendMetadata?: AcpBackendMetadata;
  /** Per-session custom system prompt. Passed via _meta.systemPrompt in ACP session/new. */
  systemPrompt?: string;
  /** Issue #4524: Per-session environment variables to inject into the ACP child process. */
  env?: Record<string, string>;
  /** Issue #4524: Permission mode to enforce on the child process. */
  permissionMode?: string;
}

export interface AcpAgentSessionAttachment {
  acpAgentSessionId?: string;
  claudeSessionId?: string;
  backendRunId?: string;
  backendMetadata?: AcpBackendMetadata;
  /** Issue #3897: Structured validation warnings from prompt output validation. */
  validationWarnings?: PromptValidationWarning[];
}

export type AcpSessionTransitionEvent =
  | { type: 'agent_ready' }
  | { type: 'run_started' }
  | { type: 'run_completed' }
  | { type: 'pause_requested' }
  | { type: 'resume_requested' }
  | { type: 'intervention_started' }
  | { type: 'intervention_completed' }
  | { type: 'close_requested' }
  | { type: 'close_completed' }
  | { type: 'runtime_failed' }
  | { type: 'validation_warning'; warnings?: PromptValidationWarning[] };

export type AcpControlActionType =
  | 'prompt'
  | 'approve'
  | 'reject'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'driver_transfer'
  | 'intervene'
  | 'close';

export interface AcpControlActionInput extends AcpSessionScope {
  actionId: string;
  sessionId: string;
  type: AcpControlActionType;
  idempotencyKey?: string;
  approvalId?: string;
  controlRequestId?: string;
  metadata?: AcpBackendMetadata;
}

export interface AcpListSessionsInput extends AcpSessionScope {
  statuses?: AcpSessionStatus[];
  limit?: number;
  updatedAfter?: number;
}

export interface AcpSessionStore {
  create(record: AcpSessionRecord): Promise<void>;
  get(id: string, scope: AcpSessionScope): Promise<AcpSessionRecord | null>;
  update(record: AcpSessionRecord, scope: AcpSessionScope): Promise<AcpSessionRecord | null>;
  list(input: AcpListSessionsInput): Promise<AcpSessionRecord[]>;
}
