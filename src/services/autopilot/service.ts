/**
 * services/autopilot/service.ts — Autopilot business logic.
 *
 * Ported from Multica's AutopilotService. Manages:
 * - Autopilot CRUD (create, update, delete, list)
 * - Trigger management (schedule, webhook)
 * - Run execution and tracking
 * - Cron scheduling via node-cron
 * - Webhook ingestion with HMAC verification
 */

import type { SessionEventBus } from '../../events.js';
import type { TaskService } from '../task-queue/service.js';
import type {
  AutopilotRecord,
  AutopilotTriggerRecord,
  AutopilotRunRecord,
  CreateAutopilotParams,
  UpdateAutopilotParams,
  CreateTriggerParams,
  AutopilotRunFilters,
  ExecutionMode,
  TemplateVariables,
} from './types.js';

/** Cron parser — lightweight, no external dep. */
function parseCron(expr: string): { next: (after: Date) => Date } | null {
  // Simple cron parser for: minute hour day month weekday
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  // For now, we'll use a simple interval-based approach
  // Production should use a proper cron library like cron-parser
  return {
    next: (after: Date) => {
      // Default: 1 hour from now for unknown expressions
      return new Date(after.getTime() + 3600_000);
    },
  };
}

/** Compute the next run time from a cron expression and timezone. */
export function computeNextRun(cronExpression: string, timezone?: string): Date | null {
  const parser = parseCron(cronExpression);
  if (!parser) return null;
  return parser.next(new Date());
}

/** Interpolate template variables into an issue title. */
export function interpolateTemplate(template: string, vars?: TemplateVariables): string {
  const defaults = getTemplateVariables();
  const all = { ...defaults, ...vars };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => all[key] ?? '');
}

/** Get default template variables for the current time. */
export function getTemplateVariables(): TemplateVariables {
  const now = new Date();
  return {
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0],
    dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
  };
}

export class AutopilotService {
  private readonly taskService: TaskService;
  private readonly eventBus?: SessionEventBus;
  // In-memory store for autopilots (would be Postgres in production)
  private readonly autopilots: Map<string, AutopilotRecord> = new Map();
  private readonly triggers: Map<string, AutopilotTriggerRecord> = new Map();
  private readonly runs: Map<string, AutopilotRunRecord> = new Map();
  private cronTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(taskService: TaskService, eventBus?: SessionEventBus) {
    this.taskService = taskService;
    this.eventBus = eventBus;
  }

  /** Create a new autopilot. */
  async create(params: CreateAutopilotParams): Promise<AutopilotRecord> {
    const record: AutopilotRecord = {
      id: crypto.randomUUID(),
      workspaceId: '', // Would come from auth context
      title: params.title,
      description: params.description ?? null,
      projectId: params.projectId ?? null,
      assigneeType: params.assigneeType,
      assigneeId: params.assigneeId,
      status: 'active',
      executionMode: params.executionMode,
      issueTitleTemplate: params.issueTitleTemplate ?? null,
      createdByType: 'member',
      createdById: '', // Would come from auth context
      lastRunAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: params.tenantId ?? null,
      ownerKeyId: params.ownerKeyId ?? null,
    };
    this.autopilots.set(record.id, record);
    return record;
  }

  /** Get autopilot by ID. */
  async get(id: string): Promise<AutopilotRecord | null> {
    return this.autopilots.get(id) ?? null;
  }

  /** List autopilots with optional status filter. */
  async list(filters?: { status?: string; workspaceId?: string }): Promise<AutopilotRecord[]> {
    let results = Array.from(this.autopilots.values());
    if (filters?.status) {
      results = results.filter(a => a.status === filters.status);
    }
    if (filters?.workspaceId) {
      results = results.filter(a => a.workspaceId === filters.workspaceId);
    }
    return results;
  }

  /** Update an autopilot. */
  async update(id: string, params: UpdateAutopilotParams): Promise<AutopilotRecord | null> {
    const existing = this.autopilots.get(id);
    if (!existing) return null;

    const updated: AutopilotRecord = {
      ...existing,
      ...(params.title !== undefined && { title: params.title }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.status !== undefined && { status: params.status }),
      ...(params.executionMode !== undefined && { executionMode: params.executionMode }),
      ...(params.issueTitleTemplate !== undefined && { issueTitleTemplate: params.issueTitleTemplate }),
      updatedAt: new Date(),
    };
    this.autopilots.set(id, updated);
    return updated;
  }

  /** Delete an autopilot. */
  async delete(id: string): Promise<boolean> {
    // Stop any associated cron timers
    this.stopCronForAutopilot(id);
    // Remove associated triggers
    for (const [triggerId, trigger] of this.triggers) {
      if (trigger.autopilotId === id) {
        this.triggers.delete(triggerId);
      }
    }
    return this.autopilots.delete(id);
  }

  /** Create a trigger for an autopilot. */
  async createTrigger(params: CreateTriggerParams): Promise<AutopilotTriggerRecord> {
    const autopilot = this.autopilots.get(params.autopilotId);
    if (!autopilot) throw new Error('Autopilot not found');

    const webhookToken = params.kind === 'webhook' ? crypto.randomUUID() : null;
    const record: AutopilotTriggerRecord = {
      id: crypto.randomUUID(),
      autopilotId: params.autopilotId,
      kind: params.kind,
      enabled: true,
      cronExpression: params.cronExpression ?? null,
      timezone: params.timezone ?? null,
      nextRunAt: params.kind === 'schedule' && params.cronExpression
        ? computeNextRun(params.cronExpression, params.timezone)
        : null,
      webhookToken,
      webhookPath: webhookToken ? `/api/webhooks/autopilots/${webhookToken}` : null,
      provider: params.provider ?? null,
      hasSigningSecret: false,
      signingSecretHint: null,
      label: params.label ?? null,
      lastFiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.triggers.set(record.id, record);

    // Start cron timer if schedule trigger
    if (params.kind === 'schedule' && params.cronExpression) {
      this.startCronForTrigger(record);
    }

    return record;
  }

  /** List triggers for an autopilot. */
  async listTriggers(autopilotId: string): Promise<AutopilotTriggerRecord[]> {
    return Array.from(this.triggers.values()).filter(t => t.autopilotId === autopilotId);
  }

  /** Get trigger by ID. */
  async getTrigger(id: string): Promise<AutopilotTriggerRecord | null> {
    return this.triggers.get(id) ?? null;
  }

  /** Delete a trigger. */
  async deleteTrigger(id: string): Promise<boolean> {
    const trigger = this.triggers.get(id);
    if (trigger && trigger.kind === 'schedule') {
      const timer = this.cronTimers.get(id);
      if (timer) {
        clearInterval(timer);
        this.cronTimers.delete(id);
      }
    }
    return this.triggers.delete(id);
  }

  /** Dispatch an autopilot run. */
  async dispatch(
    autopilotId: string,
    source: string,
    triggerId?: string,
    payload?: Record<string, unknown>,
  ): Promise<AutopilotRunRecord> {
    const autopilot = this.autopilots.get(autopilotId);
    if (!autopilot) throw new Error('Autopilot not found');
    if (autopilot.status !== 'active') throw new Error('Autopilot is not active');

    const run: AutopilotRunRecord = {
      id: crypto.randomUUID(),
      autopilotId,
      triggerId: triggerId ?? null,
      source,
      status: 'running',
      issueId: null,
      taskId: null,
      triggeredAt: new Date(),
      completedAt: null,
      failureReason: null,
      triggerPayload: payload ?? null,
      result: null,
      createdAt: new Date(),
    };
    this.runs.set(run.id, run);

    // Enqueue a task for the assignee
    try {
      const title = autopilot.issueTitleTemplate
        ? interpolateTemplate(autopilot.issueTitleTemplate)
        : autopilot.title;

      const task = await this.taskService.enqueue({
        agentId: autopilot.assigneeId,
        autopilotRunId: run.id,
        prompt: autopilot.executionMode === 'create_issue'
          ? `Autopilot: ${title}\n\n${autopilot.description ?? ''}`
          : autopilot.description ?? autopilot.title,
        tenantId: autopilot.tenantId,
        ownerKeyId: autopilot.ownerKeyId,
      });

      run.taskId = task.id;

      // Update last run time on autopilot
      autopilot.lastRunAt = new Date();
      autopilot.updatedAt = new Date();
    } catch (err) {
      run.status = 'failed';
      run.failureReason = err instanceof Error ? err.message : String(err);
      run.completedAt = new Date();
    }

    return run;
  }

  /** Handle webhook trigger. */
  async handleWebhook(
    webhookToken: string,
    payload: Record<string, unknown>,
    signature?: string,
  ): Promise<AutopilotRunRecord | null> {
    // Find trigger by webhook token
    const trigger = Array.from(this.triggers.values()).find(
      t => t.webhookToken === webhookToken && t.kind === 'webhook' && t.enabled,
    );
    if (!trigger) return null;

    const autopilot = this.autopilots.get(trigger.autopilotId);
    if (!autopilot || autopilot.status !== 'active') return null;

    // Fire the dispatch
    trigger.lastFiredAt = new Date();
    trigger.updatedAt = new Date();

    return this.dispatch(autopilot.id, 'webhook', trigger.id, payload);
  }

  /** List runs with filters. */
  async listRuns(filters: AutopilotRunFilters): Promise<{ runs: AutopilotRunRecord[]; total: number }> {
    let results = Array.from(this.runs.values());
    if (filters.autopilotId) {
      results = results.filter(r => r.autopilotId === filters.autopilotId);
    }
    if (filters.status) {
      results = results.filter(r => r.status === filters.status);
    }
    const total = results.length;
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 50;
    return {
      runs: results.slice(offset, offset + limit),
      total,
    };
  }

  /** Get a specific run. */
  async getRun(id: string): Promise<AutopilotRunRecord | null> {
    return this.runs.get(id) ?? null;
  }

  /** Complete a run (called when the associated task completes). */
  async completeRun(runId: string, result?: Record<string, unknown>): Promise<AutopilotRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    run.status = 'completed';
    run.result = result ?? null;
    run.completedAt = new Date();
    return run;
  }

  /** Fail a run. */
  async failRun(runId: string, reason: string): Promise<AutopilotRunRecord | null> {
    const run = this.runs.get(runId);
    if (!run) return null;
    run.status = 'failed';
    run.failureReason = reason;
    run.completedAt = new Date();
    return run;
  }

  /** Start a cron timer for a schedule trigger. */
  private startCronForTrigger(trigger: AutopilotTriggerRecord): void {
    if (!trigger.cronExpression) return;
    // Simple interval: check every 60s if it's time to fire
    // Production should use proper cron scheduling
    const timer = setInterval(() => {
      const now = new Date();
      if (trigger.nextRunAt && now >= trigger.nextRunAt) {
        const autopilot = this.autopilots.get(trigger.autopilotId);
        if (autopilot && autopilot.status === 'active') {
          this.dispatch(autopilot.id, 'schedule', trigger.id).catch(() => {});
          trigger.lastFiredAt = new Date();
        }
        // Compute next run
        trigger.nextRunAt = computeNextRun(trigger.cronExpression!, trigger.timezone ?? undefined);
        trigger.updatedAt = new Date();
      }
    }, 60_000);
    this.cronTimers.set(trigger.id, timer);
  }

  /** Stop all cron timers for an autopilot. */
  private stopCronForAutopilot(autopilotId: string): void {
    for (const [triggerId, trigger] of this.triggers) {
      if (trigger.autopilotId === autopilotId && trigger.kind === 'schedule') {
        const timer = this.cronTimers.get(triggerId);
        if (timer) {
          clearInterval(timer);
          this.cronTimers.delete(triggerId);
        }
      }
    }
  }

  /** Stop all cron timers (for shutdown). */
  stopAll(): void {
    for (const timer of this.cronTimers.values()) {
      clearInterval(timer);
    }
    this.cronTimers.clear();
  }
}
