/**
 * routes/agents.ts — Agent Profile REST API.
 *
 * CRUD for first-class agent entities. Ported from Multica's agent handler.
 * Follows Aegis patterns: Fastify routes, Zod validation, permission checks.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AgentProfileService } from '../services/agent-profile/service.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy, requirePermission, requireRole, withValidation } from './context.js';

const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(255).optional(),
  avatar_url: z.string().url().optional(),
  runtime_mode: z.enum(['daemon', 'cloud']).optional(),
  runtime_config: z.record(z.unknown()).optional(),
  runtime_id: z.string().optional(),
  model: z.string().optional(),
  thinking_level: z.enum(['none', 'low', 'medium', 'high']).optional(),
  max_concurrent_tasks: z.number().int().min(1).max(20).optional(),
  instructions: z.string().max(50_000).optional(),
  custom_env: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  custom_args: z.array(z.string()).optional(),
  mcp_config: z.record(z.unknown()).optional(),
  visibility: z.enum(['workspace', 'private']).optional(),
}).strict();

const updateAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(255).optional(),
  avatar_url: z.string().url().optional(),
  runtime_mode: z.enum(['daemon', 'cloud']).optional(),
  runtime_config: z.record(z.unknown()).optional(),
  runtime_id: z.string().optional(),
  model: z.string().optional(),
  thinking_level: z.enum(['none', 'low', 'medium', 'high']).optional(),
  max_concurrent_tasks: z.number().int().min(1).max(20).optional(),
  instructions: z.string().max(50_000).optional(),
  custom_env: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  custom_args: z.array(z.string()).optional(),
  mcp_config: z.record(z.unknown()).optional(),
  visibility: z.enum(['workspace', 'private']).optional(),
}).strict();

/**
 * Register all agent profile REST routes on the Fastify instance.
 */
export function registerAgentRoutes(app: FastifyInstance, ctx: RouteContext & { agentProfileService: AgentProfileService }): void {
  const { agentProfileService, auth } = ctx;

  // List agents
  registerWithLegacy(app, 'get', '/v1/agents', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const query = req.query as Record<string, string>;
    const result = await agentProfileService.list({
      workspaceId: query.workspace_id,
      visibility: query.visibility as any,
      includeArchived: query.include_archived === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return result;
  });

  // Get agent
  registerWithLegacy(app, 'get', '/v1/agents/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'admin', 'operator', 'viewer')) return;
    const agent = await agentProfileService.get(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    if (agent.archivedAt) return reply.status(410).send({ error: 'Agent archived' });
    return agent;
  });

  // Create agent
  registerWithLegacy(app, 'post', '/v1/agents', withValidation(createAgentSchema, async (req: FastifyRequest, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    try {
      const agent = await agentProfileService.create({
        name: data.name,
        description: data.description,
        avatarUrl: data.avatar_url,
        runtimeMode: data.runtime_mode,
        runtimeConfig: data.runtime_config,
        runtimeId: data.runtime_id,
        model: data.model,
        thinkingLevel: data.thinking_level,
        maxConcurrentTasks: data.max_concurrent_tasks,
        instructions: data.instructions,
        customEnv: data.custom_env,
        customArgs: data.custom_args,
        mcpConfig: data.mcp_config,
        visibility: data.visibility,
      });
      return reply.status(201).send(agent);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Update agent
  registerWithLegacy(app, 'patch', '/v1/agents/:id', withValidation(updateAgentSchema, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, data) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    try {
      const agent = await agentProfileService.update(req.params.id, {
        name: data.name,
        description: data.description,
        avatarUrl: data.avatar_url,
        runtimeMode: data.runtime_mode,
        runtimeConfig: data.runtime_config,
        runtimeId: data.runtime_id,
        model: data.model,
        thinkingLevel: data.thinking_level,
        maxConcurrentTasks: data.max_concurrent_tasks,
        instructions: data.instructions,
        customEnv: data.custom_env,
        customArgs: data.custom_args,
        mcpConfig: data.mcp_config,
        visibility: data.visibility,
      });
      if (!agent) return reply.status(404).send({ error: 'Agent not found' });
      return agent;
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  }));

  // Archive agent (soft delete)
  registerWithLegacy(app, 'delete', '/v1/agents/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'kill')) return;
    const agent = await agentProfileService.archive(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return { ok: true };
  });

  // Restore archived agent
  registerWithLegacy(app, 'post', '/v1/agents/:id/restore', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (!requirePermission(auth, req, reply, 'create')) return;
    const agent = await agentProfileService.restore(req.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found or not archived' });
    return agent;
  });
}
