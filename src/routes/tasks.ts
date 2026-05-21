/**
 * routes/tasks.ts — Task queue REST API.
 *
 * CRUD + lifecycle endpoints for the task queue.
 * Ported from Multica's task handler patterns, adapted to Aegis Fastify.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { TaskService } from '../services/task-queue/service.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy, requirePermission, requireRole, withValidation } from './context.js';

// --- Validation schemas ---

const createTaskSchema = z.object({
  agentId: z.string().min(1),
  issueId: z.string().optional(),
  autopilotRunId: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  prompt: z.string().max(100_000).optional(),
  context: z.record(z.unknown()).optional(),
  triggerSummary: z.string().max(500).optional(),
  forceFreshSession: z.boolean().optional(),
  isLeaderTask: z.boolean().optional(),
}).strict();

const completeTaskSchema = z.object({
  result: z.record(z.unknown()).optional(),
  sessionId: z.string().optional(),
  workDir: z.string().optional(),
}).strict();

const failTaskSchema = z.object({
  error: z.string().min(1).max(10_000),
  failureReason: z.enum([
    'agent_error', 'runtime_offline', 'runtime_recovery',
    'timeout', 'cancelled', 'iteration_limit', 'unknown',
  ]).optional(),
  sessionId: z.string().optional(),
  workDir: z.string().optional(),
}).strict();

const taskListQuerySchema = z.object({
  status: z.enum(['queued', 'dispatched', 'running', 'completed', 'failed', 'cancelled']).optional(),
  agentId: z.string().optional(),
  issueId: z.string().optional(),
  autopilotRunId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const pinSessionSchema = z.object({
  sessionId: z.string().min(1),
  workDir: z.string().optional(),
}).strict();

/**
 * Register all task queue REST routes on the Fastify instance.
 */
export function registerTaskRoutes(app: FastifyInstance, ctx: RouteContext & { taskService: TaskService }): void {
  const { taskService, auth } = ctx;

  // List tasks
  registerWithLegacy(app, 'get', '/v1/tasks', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const parsed = taskListQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }
    const result = await taskService.list(parsed.data);
    return result;
  });

  // Get task by ID
  registerWithLegacy(app, 'get', '/v1/tasks/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const task = await taskService.get(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task;
  });

  // Create task
  registerWithLegacy(app, 'post', '/v1/tasks', withValidation(createTaskSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    try {
      const task = await taskService.enqueue(data);
      return reply.status(201).send(task);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Claim next task for agent
  registerWithLegacy(app, 'post', '/v1/tasks/claim', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const { agentId, runtimeId } = req.body as { agentId?: string; runtimeId?: string };
    if (!agentId) {
      return reply.status(400).send({ error: 'agentId is required' });
    }
    const task = await taskService.claim(agentId, runtimeId);
    if (!task) return reply.status(204).send();
    return task;
  });

  // Start task
  registerWithLegacy(app, 'post', '/v1/tasks/:id/start', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const task = await taskService.start(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found or not in dispatched state' });
    return task;
  });

  // Complete task
  registerWithLegacy(app, 'post', '/v1/tasks/:id/complete', withValidation(completeTaskSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const task = await taskService.complete({ taskId: req.params.id, ...data });
    if (!task) return reply.status(404).send({ error: 'Task not found or not in running state' });
    return task;
  }));

  // Fail task
  registerWithLegacy(app, 'post', '/v1/tasks/:id/fail', withValidation(failTaskSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const { task, retried } = await taskService.fail({ taskId: req.params.id, ...data });
    if (!task) return reply.status(404).send({ error: 'Task not found or not in running/dispatched state' });
    return { task, retried: retried ?? null };
  }));

  // Cancel task
  registerWithLegacy(app, 'post', '/v1/tasks/:id/cancel', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const task = await taskService.cancel(req.params.id);
    if (!task) return reply.status(404).send({ error: 'Task not found or already terminal' });
    return task;
  });

  // Retry task
  registerWithLegacy(app, 'post', '/v1/tasks/:id/retry', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const task = await taskService.retry(req.params.id);
    if (!task) return reply.status(400).send({ error: 'Task not retryable (not failed, or max attempts reached)' });
    return reply.status(201).send(task);
  });

  // Pin session (for crash recovery)
  registerWithLegacy(app, 'put', '/v1/tasks/:id/session', withValidation(pinSessionSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const task = await taskService.pinSession(req.params.id, data.sessionId, data.workDir);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return reply.status(204).send();
  }));

  // Recover orphaned tasks for a runtime
  registerWithLegacy(app, 'post', '/v1/tasks/recover-orphaned', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;
    const { runtimeId } = req.body as { runtimeId?: string };
    if (!runtimeId) {
      return reply.status(400).send({ error: 'runtimeId is required' });
    }
    const { recovered, retried } = await taskService.recoverOrphans(runtimeId);
    return { recovered: recovered.length, retried: retried.length, tasks: retried };
  });

  // Task stats for an agent
  registerWithLegacy(app, 'get', '/v1/tasks/stats/:agentId', async (req: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const counts = await taskService.countByStatus(req.params.agentId);
    return counts;
  });
}
