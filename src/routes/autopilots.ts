/**
 * routes/autopilots.ts — Autopilot REST API.
 *
 * CRUD + trigger management + run tracking for automated agent scheduling.
 * Ported from Multica's autopilot handler patterns.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AutopilotService } from '../services/autopilot/service.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy, requirePermission, requireRole, withValidation } from './context.js';

// --- Validation schemas ---

const createAutopilotSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  projectId: z.string().uuid().optional(),
  assigneeType: z.enum(['agent', 'squad']),
  assigneeId: z.string().min(1),
  executionMode: z.enum(['create_issue', 'run_only']),
  issueTitleTemplate: z.string().max(500).optional(),
}).strict();

const updateAutopilotSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  executionMode: z.enum(['create_issue', 'run_only']).optional(),
  issueTitleTemplate: z.string().max(500).optional(),
}).strict();

const createTriggerSchema = z.object({
  kind: z.enum(['schedule', 'webhook', 'api']),
  cronExpression: z.string().max(100).optional(),
  timezone: z.string().max(100).optional(),
  label: z.string().max(200).optional(),
  provider: z.enum(['generic', 'github']).optional(),
}).strict();

const runListQuerySchema = z.object({
  status: z.enum(['running', 'completed', 'failed', 'skipped']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Register all autopilot REST routes on the Fastify instance.
 */
export function registerAutopilotRoutes(app: FastifyInstance, ctx: RouteContext & { autopilotService: AutopilotService }): void {
  const { autopilotService, auth } = ctx;

  // List autopilots
  registerWithLegacy(app, 'get', '/v1/autopilots', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const status = (req.query as any).status as string | undefined;
    const autopilots = await autopilotService.list({ status });
    return { autopilots, total: autopilots.length };
  });

  // Get autopilot
  registerWithLegacy(app, 'get', '/v1/autopilots/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const autopilot = await autopilotService.get(req.params.id);
    if (!autopilot) return reply.status(404).send({ error: 'Autopilot not found' });

    const triggers = await autopilotService.listTriggers(req.params.id);
    return { autopilot, triggers };
  });

  // Create autopilot
  registerWithLegacy(app, 'post', '/v1/autopilots', withValidation(createAutopilotSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    try {
      const autopilot = await autopilotService.create(data);
      return reply.status(201).send(autopilot);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Update autopilot
  registerWithLegacy(app, 'patch', '/v1/autopilots/:id', withValidation(updateAutopilotSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const autopilot = await autopilotService.update(req.params.id, data);
    if (!autopilot) return reply.status(404).send({ error: 'Autopilot not found' });
    return autopilot;
  }));

  // Delete autopilot
  registerWithLegacy(app, 'delete', '/v1/autopilots/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const deleted = await autopilotService.delete(req.params.id);
    if (!deleted) return reply.status(404).send({ error: 'Autopilot not found' });
    return { ok: true };
  });

  // Create trigger
  registerWithLegacy(app, 'post', '/v1/autopilots/:id/triggers', withValidation(createTriggerSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    try {
      const trigger = await autopilotService.createTrigger({ autopilotId: req.params.id, ...data });
      return reply.status(201).send(trigger);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // List triggers
  registerWithLegacy(app, 'get', '/v1/autopilots/:id/triggers', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const triggers = await autopilotService.listTriggers(req.params.id);
    return triggers;
  });

  // Delete trigger
  registerWithLegacy(app, 'delete', '/v1/autopilots/:id/triggers/:triggerId', async (req: FastifyRequest<{ Params: { id: string; triggerId: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const deleted = await autopilotService.deleteTrigger(req.params.triggerId);
    if (!deleted) return reply.status(404).send({ error: 'Trigger not found' });
    return { ok: true };
  });

  // List runs
  registerWithLegacy(app, 'get', '/v1/autopilots/:id/runs', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const parsed = runListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }
    const result = await autopilotService.listRuns({ autopilotId: req.params.id, ...parsed.data });
    return result;
  });

  // Get run
  registerWithLegacy(app, 'get', '/v1/autopilots/:id/runs/:runId', async (req: FastifyRequest<{ Params: { id: string; runId: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const run = await autopilotService.getRun(req.params.runId);
    if (!run) return reply.status(404).send({ error: 'Run not found' });
    return run;
  });

  // Manual trigger
  registerWithLegacy(app, 'post', '/v1/autopilots/:id/trigger', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    try {
      const run = await autopilotService.dispatch(req.params.id, 'manual');
      return reply.status(201).send(run);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Webhook receiver (public, no auth)
  app.post<{ Params: { token: string } }>('/api/webhooks/autopilots/:token', async (req, reply) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const payload = req.body as Record<string, unknown>;
    const run = await autopilotService.handleWebhook(req.params.token, payload, signature);
    if (!run) return reply.status(404).send({ error: 'Webhook not found' });
    return reply.status(200).send({ ok: true, runId: run.id });
  });
}
