/**
 * __tests__/autopilot.test.ts — Autopilot unit tests.
 *
 * Tests CRUD, trigger management, run execution, and webhook handling.
 * Uses the TaskService with real Postgres for E2E verification.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AutopilotService, interpolateTemplate, getTemplateVariables } from '../services/autopilot/service.js';
import { PostgresTaskStore } from '../services/task-queue/store.js';
import { TaskService } from '../services/task-queue/service.js';

const pgUrl = process.env.AEGIS_POSTGRES_URL ?? process.env.TEST_POSTGRES_URL ?? '';
const skipIfNoDb = pgUrl ? describe : describe.skip;

const TEST_TABLE = `test_ap_tasks_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

skipIfNoDb('Autopilot Service', () => {
  let taskStore: PostgresTaskStore;
  let taskService: TaskService;
  let autopilotService: AutopilotService;

  beforeAll(async () => {
    taskStore = new PostgresTaskStore({ url: pgUrl, tableName: TEST_TABLE, poolMax: 2 });
    await taskStore.start();
    taskService = new TaskService(taskStore);
  });

  afterAll(async () => {
    try { await taskStore['pool'].query(`DROP TABLE IF EXISTS "public"."${TEST_TABLE}"`); } catch {}
    autopilotService?.stopAll();
    await taskStore.stop();
  });

  beforeEach(async () => {
    try { await taskStore['pool'].query(`TRUNCATE "public"."${TEST_TABLE}"`); } catch {}
    autopilotService = new AutopilotService(taskService);
  });

  describe('Template interpolation', () => {
    it('replaces {{date}} with current date', () => {
      const vars = getTemplateVariables();
      const result = interpolateTemplate('Daily review — {{date}}', vars);
      expect(result).toContain(vars.date);
    });

    it('replaces multiple variables', () => {
      const vars = getTemplateVariables();
      const result = interpolateTemplate('{{dayOfWeek}} {{time}} report', vars);
      expect(result).toContain(vars.dayOfWeek);
      expect(result).toContain(vars.time);
    });

    it('leaves unknown variables empty', () => {
      const result = interpolateTemplate('Hello {{unknown}}');
      expect(result).toBe('Hello ');
    });
  });

  describe('Autopilot CRUD', () => {
    it('creates an autopilot', async () => {
      const ap = await autopilotService.create({
        title: 'Daily code review',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'create_issue',
        issueTitleTemplate: 'Code review — {{date}}',
      });

      expect(ap.id).toBeTruthy();
      expect(ap.title).toBe('Daily code review');
      expect(ap.status).toBe('active');
      expect(ap.executionMode).toBe('create_issue');
    });

    it('gets autopilot by ID', async () => {
      const created = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });

      const fetched = await autopilotService.get(created.id);
      expect(fetched).toBeTruthy();
      expect(fetched!.id).toBe(created.id);
    });

    it('lists autopilots', async () => {
      await autopilotService.create({ title: 'AP1', assigneeType: 'agent', assigneeId: 'a1', executionMode: 'run_only' });
      await autopilotService.create({ title: 'AP2', assigneeType: 'agent', assigneeId: 'a2', executionMode: 'create_issue' });

      const all = await autopilotService.list();
      expect(all.length).toBe(2);

      const active = await autopilotService.list({ status: 'active' });
      expect(active.length).toBe(2);
    });

    it('updates autopilot', async () => {
      const created = await autopilotService.create({
        title: 'Original',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });

      const updated = await autopilotService.update(created.id, {
        title: 'Updated',
        status: 'paused',
      });

      expect(updated!.title).toBe('Updated');
      expect(updated!.status).toBe('paused');
    });

    it('deletes autopilot and its triggers', async () => {
      const created = await autopilotService.create({
        title: 'To delete',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      await autopilotService.createTrigger({
        autopilotId: created.id,
        kind: 'schedule',
        cronExpression: '0 9 * * *',
      });

      const deleted = await autopilotService.delete(created.id);
      expect(deleted).toBe(true);

      const fetched = await autopilotService.get(created.id);
      expect(fetched).toBeNull();
    });
  });

  describe('Trigger management', () => {
    it('creates a schedule trigger', async () => {
      const ap = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });

      const trigger = await autopilotService.createTrigger({
        autopilotId: ap.id,
        kind: 'schedule',
        cronExpression: '0 9 * * *',
        timezone: 'UTC',
      });

      expect(trigger.id).toBeTruthy();
      expect(trigger.kind).toBe('schedule');
      expect(trigger.cronExpression).toBe('0 9 * * *');
      expect(trigger.webhookToken).toBeNull();
    });

    it('creates a webhook trigger with token', async () => {
      const ap = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });

      const trigger = await autopilotService.createTrigger({
        autopilotId: ap.id,
        kind: 'webhook',
        provider: 'github',
      });

      expect(trigger.kind).toBe('webhook');
      expect(trigger.webhookToken).toBeTruthy();
      expect(trigger.webhookPath).toContain('/api/webhooks/autopilots/');
      expect(trigger.provider).toBe('github');
    });

    it('lists triggers for autopilot', async () => {
      const ap = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      await autopilotService.createTrigger({ autopilotId: ap.id, kind: 'schedule', cronExpression: '0 9 * * *' });
      await autopilotService.createTrigger({ autopilotId: ap.id, kind: 'webhook' });

      const triggers = await autopilotService.listTriggers(ap.id);
      expect(triggers.length).toBe(2);
    });

    it('deletes a trigger', async () => {
      const ap = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      const trigger = await autopilotService.createTrigger({ autopilotId: ap.id, kind: 'webhook' });

      const deleted = await autopilotService.deleteTrigger(trigger.id);
      expect(deleted).toBe(true);

      const fetched = await autopilotService.getTrigger(trigger.id);
      expect(fetched).toBeNull();
    });
  });

  describe('Run execution', () => {
    it('dispatches a run and creates a task', async () => {
      const ap = await autopilotService.create({
        title: 'Daily review',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });

      const run = await autopilotService.dispatch(ap.id, 'manual');

      expect(run.id).toBeTruthy();
      expect(run.status).toBe('running');
      expect(run.taskId).toBeTruthy();
      expect(run.source).toBe('manual');

      // Verify task was created
      const task = await taskService.get(run.taskId!);
      expect(task).toBeTruthy();
      expect(task!.agentId).toBe('agent-1');
      expect(task!.autopilotRunId).toBe(run.id);
    });

    it('fails dispatch for non-existent autopilot', async () => {
      await expect(
        autopilotService.dispatch('nonexistent', 'manual'),
      ).rejects.toThrow('Autopilot not found');
    });

    it('fails dispatch for paused autopilot', async () => {
      const ap = await autopilotService.create({
        title: 'Paused',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      await autopilotService.update(ap.id, { status: 'paused' });

      await expect(
        autopilotService.dispatch(ap.id, 'manual'),
      ).rejects.toThrow('not active');
    });

    it('completes and fails runs', async () => {
      const ap = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      const run = await autopilotService.dispatch(ap.id, 'manual');

      const completed = await autopilotService.completeRun(run.id, { output: 'done' });
      expect(completed!.status).toBe('completed');
      expect(completed!.result).toEqual({ output: 'done' });

      const run2 = await autopilotService.dispatch(ap.id, 'manual');
      const failed = await autopilotService.failRun(run2.id, 'Agent crashed');
      expect(failed!.status).toBe('failed');
      expect(failed!.failureReason).toBe('Agent crashed');
    });

    it('lists runs with filters', async () => {
      const ap = await autopilotService.create({
        title: 'Test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      const run1 = await autopilotService.dispatch(ap.id, 'manual');
      const run2 = await autopilotService.dispatch(ap.id, 'manual');
      await autopilotService.completeRun(run1.id);

      const all = await autopilotService.listRuns({ autopilotId: ap.id });
      expect(all.total).toBe(2);

      const running = await autopilotService.listRuns({ autopilotId: ap.id, status: 'running' });
      expect(running.total).toBe(1);
    });
  });

  describe('Webhook handling', () => {
    it('handles webhook trigger', async () => {
      const ap = await autopilotService.create({
        title: 'Webhook test',
        assigneeType: 'agent',
        assigneeId: 'agent-1',
        executionMode: 'run_only',
      });
      const trigger = await autopilotService.createTrigger({
        autopilotId: ap.id,
        kind: 'webhook',
        provider: 'github',
      });

      const run = await autopilotService.handleWebhook(trigger.webhookToken!, {
        ref: 'refs/heads/main',
        commits: [],
      });

      expect(run).toBeTruthy();
      expect(run!.status).toBe('running');
      expect(run!.source).toBe('webhook');
      expect(run!.triggerPayload).toEqual({ ref: 'refs/heads/main', commits: [] });
    });

    it('returns null for unknown webhook token', async () => {
      const run = await autopilotService.handleWebhook('nonexistent-token', {});
      expect(run).toBeNull();
    });
  });
});
