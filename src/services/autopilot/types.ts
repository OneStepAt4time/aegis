/**
 * services/autopilot/types.ts — Autopilot domain types.
 *
 * Ported from Multica's autopilot system. An autopilot is a recurring
 * automation that assigns work to agents on a schedule or via webhook.
 */

/** Autopilot status. */
export type AutopilotStatus = 'active' | 'paused' | 'archived';

/** Execution mode. */
export type ExecutionMode = 'create_issue' | 'run_only';

/** Trigger kind. */
export type TriggerKind = 'schedule' | 'webhook' | 'api';

/** Webhook provider type. */
export type WebhookProvider = 'generic' | 'github';

/** Autopilot record. */
export interface AutopilotRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  projectId: string | null;
  assigneeType: 'agent' | 'squad';
  assigneeId: string;
  status: AutopilotStatus;
  executionMode: ExecutionMode;
  issueTitleTemplate: string | null;
  createdByType: 'member' | 'agent';
  createdById: string;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenantId: string | null;
  ownerKeyId: string | null;
}

/** Autopilot trigger record. */
export interface AutopilotTriggerRecord {
  id: string;
  autopilotId: string;
  kind: TriggerKind;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string | null;
  nextRunAt: Date | null;
  webhookToken: string | null;
  webhookPath: string | null;
  provider: WebhookProvider | null;
  hasSigningSecret: boolean;
  signingSecretHint: string | null;
  label: string | null;
  lastFiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Autopilot run record. */
export interface AutopilotRunRecord {
  id: string;
  autopilotId: string;
  triggerId: string | null;
  source: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  issueId: string | null;
  taskId: string | null;
  triggeredAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
  triggerPayload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  createdAt: Date;
}

/** Create autopilot params. */
export interface CreateAutopilotParams {
  title: string;
  description?: string;
  projectId?: string;
  assigneeType: 'agent' | 'squad';
  assigneeId: string;
  executionMode: ExecutionMode;
  issueTitleTemplate?: string;
  tenantId?: string;
  ownerKeyId?: string;
}

/** Update autopilot params. */
export interface UpdateAutopilotParams {
  title?: string;
  description?: string;
  status?: AutopilotStatus;
  executionMode?: ExecutionMode;
  issueTitleTemplate?: string;
}

/** Create trigger params. */
export interface CreateTriggerParams {
  autopilotId: string;
  kind: TriggerKind;
  cronExpression?: string;
  timezone?: string;
  label?: string;
  provider?: WebhookProvider;
}

/** Autopilot run filters. */
export interface AutopilotRunFilters {
  autopilotId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/** Issue title template variables. */
export interface TemplateVariables {
  date: string;
  time: string;
  dayOfWeek: string;
  [key: string]: string;
}
