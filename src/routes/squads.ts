/**
 * routes/squads.ts — Squad REST API.
 *
 * CRUD + member management for multi-agent teams.
 * Ported from Multica's squad handler patterns.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { SquadService } from '../services/squad/service.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy, requirePermission, requireRole, withValidation } from './context.js';

const createSquadSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(10_000).optional(),
  instructions: z.string().max(50_000).optional(),
  leaderId: z.string().min(1),
  memberIds: z.array(z.string()).max(20).optional(),
}).strict();

const updateSquadSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(10_000).optional(),
  instructions: z.string().max(50_000).optional(),
  leaderId: z.string().min(1).optional(),
}).strict();

const addMemberSchema = z.object({
  memberId: z.string().min(1),
  role: z.enum(['leader', 'worker']),
}).strict();

/**
 * Register all squad REST routes on the Fastify instance.
 */
export function registerSquadRoutes(app: FastifyInstance, ctx: RouteContext & { squadService: SquadService }): void {
  const { squadService, auth } = ctx;

  // List squads
  registerWithLegacy(app, 'get', '/v1/squads', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const squads = await squadService.list();
    return squads;
  });

  // Get squad
  registerWithLegacy(app, 'get', '/v1/squads/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const squad = await squadService.get(req.params.id);
    if (!squad) return reply.status(404).send({ error: 'Squad not found' });

    const members = await squadService.listMembers(req.params.id);
    return { ...squad, members };
  });

  // Create squad
  registerWithLegacy(app, 'post', '/v1/squads', withValidation(createSquadSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const squad = await squadService.create(data);
    const members = await squadService.listMembers(squad.id);
    return reply.status(201).send({ ...squad, members });
  }));

  // Update squad
  registerWithLegacy(app, 'patch', '/v1/squads/:id', withValidation(updateSquadSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const squad = await squadService.update(req.params.id, data);
    if (!squad) return reply.status(404).send({ error: 'Squad not found' });
    return squad;
  }));

  // Archive squad
  registerWithLegacy(app, 'delete', '/v1/squads/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const squad = await squadService.archive(req.params.id);
    if (!squad) return reply.status(404).send({ error: 'Squad not found' });
    return { ok: true };
  });

  // List members
  registerWithLegacy(app, 'get', '/v1/squads/:id/members', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const members = await squadService.listMembers(req.params.id);
    return members;
  });

  // Add member
  registerWithLegacy(app, 'post', '/v1/squads/:id/members', withValidation(addMemberSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const member = await squadService.addMember({ squadId: req.params.id, ...data });
    return reply.status(201).send(member);
  }));

  // Remove member
  registerWithLegacy(app, 'delete', '/v1/squads/:id/members/:memberId', async (req: FastifyRequest<{ Params: { id: string; memberId: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const removed = await squadService.removeMember(req.params.id, req.params.memberId);
    if (!removed) return reply.status(404).send({ error: 'Member not found' });
    return { ok: true };
  });

  // Dispatch task to squad leader
  registerWithLegacy(app, 'post', '/v1/squads/:id/dispatch', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const { prompt, issueId } = req.body as { prompt?: string; issueId?: string };
    const task = await squadService.dispatchToLeader(req.params.id, { prompt, issueId });
    if (!task) return reply.status(404).send({ error: 'Squad not found or archived' });
    return reply.status(201).send(task);
  });
}
