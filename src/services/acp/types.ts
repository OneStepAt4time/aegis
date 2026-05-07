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
  status: AcpSessionStatus;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  failedAt?: number;
  backendMetadata?: AcpBackendMetadata;
}

export interface AcpCreateSessionInput extends AcpSessionScope {
  parentSessionId?: string;
  rootSessionId?: string;
  correlationId?: string;
  resumeFromSessionId?: string;
  backendMetadata?: AcpBackendMetadata;
  /** Per-session custom system prompt. Passed via _meta.systemPrompt in ACP session/new. */
  systemPrompt?: string;
}

export interface AcpAgentSessionAttachment {
  acpAgentSessionId?: string;
  claudeSessionId?: string;
  backendRunId?: string;
  backendMetadata?: AcpBackendMetadata;
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
  | { type: 'runtime_failed' };

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
