/**
 * budgets/routes.ts — REST API for budget management.
 *
 * POST   /v1/budgets               — create
 * GET    /v1/budgets               — list (with keyId/enabled filters)
 * GET    /v1/budgets/:budgetId     — get single
 * PATCH  /v1/budgets/:budgetId     — partial update
 * DELETE /v1/budgets/:budgetId     — delete
 * POST   /v1/budgets/:budgetId/evaluate — manual evaluation
 *
 * All endpoints require admin role (Bearer auth).
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createBudgetSchema, updateBudgetSchema } from './types.js';
import type { BudgetStore } from './store.js';
import type { BudgetEvaluator } from './evaluator.js';
import { requireRole } from '../routes/context.js';
import type { AuthManager } from '../services/auth/index.js';
import { StructuredLogger } from '../logger.js';

const log = new StructuredLogger();

export interface BudgetRouteContext {
  auth: AuthManager;
  budgetStore: BudgetStore;
  budgetEvaluator: BudgetEvaluator;
}

export function registerBudgetRoutes(app: FastifyInstance, ctx: BudgetRouteContext): void {
  const { auth, budgetStore, budgetEvaluator } = ctx;

  /** POST /v1/budgets — create a budget */
  app.post('/v1/budgets', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;

    const parsed = createBudgetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.issues });
    }

    const budget = await budgetStore.createBudget(parsed.data);

    log.info({ component: 'budget-routes', operation: 'budgetCreated', attributes: { budgetId: budget.id, name: budget.name, limitUsd: budget.limitUsd } });
    return reply.status(201).send({ budget });
  });

  /** GET /v1/budgets — list budgets with optional filters */
  app.get('/v1/budgets', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

    const query = req.query as { keyId?: string; enabled?: string };
    const filters: { keyId?: string | null; enabled?: boolean } = {};

    if (query.keyId !== undefined) {
      filters.keyId = query.keyId === 'null' ? null : query.keyId;
    }
    if (query.enabled !== undefined) {
      filters.enabled = query.enabled === 'true';
    }

    const budgets = await budgetStore.listBudgets(filters);
    return reply.send({ budgets, total: budgets.length });
  });

  /** GET /v1/budgets/:budgetId — get single budget */
  app.get('/v1/budgets/:budgetId', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;

    const { budgetId } = req.params as { budgetId: string };
    const budget = await budgetStore.getBudget(budgetId);
    if (!budget) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Budget not found' });
    }
    return reply.send({ budget });
  });

  /** PATCH /v1/budgets/:budgetId — partial update */
  app.patch('/v1/budgets/:budgetId', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;

    const { budgetId } = req.params as { budgetId: string };

    const existing = await budgetStore.getBudget(budgetId);
    if (!existing) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Budget not found' });
    }

    const parsed = updateBudgetSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.issues });
    }

    const updated = await budgetStore.updateBudget(budgetId, parsed.data);
    if (!updated) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Budget not found' });
    }

    const changedFields = Object.keys(parsed.data);
    log.info({ component: 'budget-routes', operation: 'budgetUpdated', attributes: { budgetId, changedFields } });
    return reply.send({ budget: updated });
  });

  /** DELETE /v1/budgets/:budgetId — delete a budget */
  app.delete('/v1/budgets/:budgetId', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;

    const { budgetId } = req.params as { budgetId: string };
    const deleted = await budgetStore.deleteBudget(budgetId);
    if (!deleted) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Budget not found' });
    }
    // Clean up evaluation state (best-effort)
    await budgetStore.clearEvalState(budgetId).catch(() => undefined);

    log.info({ component: 'budget-routes', operation: 'budgetDeleted', attributes: { budgetId } });
    return reply.status(204).send();
  });

  /** POST /v1/budgets/:budgetId/evaluate — manual evaluation trigger */
  app.post('/v1/budgets/:budgetId/evaluate', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin')) return;

    const { budgetId } = req.params as { budgetId: string };
    const budget = await budgetStore.getBudget(budgetId);
    if (!budget) {
      return reply.status(404).send({ code: 'NOT_FOUND', message: 'Budget not found' });
    }

    const result = await budgetEvaluator.evaluate(budget);
    return reply.send(result);
  });
}
