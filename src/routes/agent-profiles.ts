/**
 * routes/agent-profiles.ts — Agent Profile CRUD endpoints (Issue #3971).
 *
 * v1 scope cuts (ADR-0029 single-tenant):
 *   - visibility removed from create/update schemas
 *   - workspaceId optional
 *
 * Security (Themis audit):
 *   - Name validated via SAFE_NAME_RE at route + model layers
 *   - customEnv validated against denylist at route + model layers
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type RouteContext,
  requireRole,
  registerWithLegacy,
} from './context.js';
import { SAFE_NAME_RE } from '../services/agents/types.js';
import {
  AgentProfileNotFoundError,
  AgentProfileArchivedError,
  AgentProfileNameError,
  AgentProfileEnvError,
} from '../services/agents/AgentProfileManager.js';

// ── Schemas ─────────────────────────────────────────────────────

const envVarSchema = z.object({ key: z.string().min(1), value: z.string() });

const createProfileSchema = z.object({
  agentId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  name: z.string().regex(SAFE_NAME_RE, `Agent name must match ${SAFE_NAME_RE.source}`),
  description: z.string().max(2000).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  runnerName: z.enum(['claude-code', 'daemon']).optional(),
  runtimeConfig: z.record(z.string(), z.unknown()).optional(),
  model: z.string().max(200).optional(),
  thinkingLevel: z.enum(['none', 'low', 'medium', 'high']).optional(),
  maxConcurrentTasks: z.number().int().min(1).max(100).optional(),
  instructions: z.string().max(50_000).optional(),
  customEnv: z.array(envVarSchema).max(50).optional(),
  customArgs: z.array(z.string().max(500)).max(50).optional(),
  mcpConfig: z.record(z.string(), z.unknown()).optional(),
}).strict();

const updateProfileSchema = z.object({
  name: z.string().regex(SAFE_NAME_RE, `Agent name must match ${SAFE_NAME_RE.source}`).optional(),
  description: z.string().max(2000).nullable().optional(),
  avatarUrl: z.string().url().max(500).nullable().optional(),
  runnerName: z.enum(['claude-code', 'daemon']).nullable().optional(),
  runtimeConfig: z.record(z.string(), z.unknown()).optional(),
  model: z.string().max(200).nullable().optional(),
  thinkingLevel: z.enum(['none', 'low', 'medium', 'high']).nullable().optional(),
  maxConcurrentTasks: z.number().int().min(1).max(100).optional(),
  instructions: z.string().max(50_000).nullable().optional(),
  customEnv: z.array(envVarSchema).max(50).optional(),
  customArgs: z.array(z.string().max(500)).max(50).optional(),
  mcpConfig: z.record(z.string(), z.unknown()).optional(),
}).strict();

const listQuerySchema = z.object({
  includeArchived: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});

// ── Routes ──────────────────────────────────────────────────────

export function registerAgentProfileRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { auth, agentProfileManager } = ctx;
  if (!agentProfileManager) return;

  // GET /v1/agents — list profiles
  registerWithLegacy(app, 'get', '/v1/agents', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'operator')) return;

    const parsed = listQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.issues });
    }

    const profiles = agentProfileManager.list({ includeArchived: parsed.data.includeArchived });
    return { profiles };
  });

  // GET /v1/agents/:id — get single profile
  registerWithLegacy(app, 'get', '/v1/agents/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'operator')) return;

    const { id } = req.params as { id: string };
    const profile = agentProfileManager.get(id);
    if (!profile) {
      return reply.status(404).send({ error: 'Agent profile not found', code: 'NOT_FOUND' });
    }
    return profile;
  });

  // POST /v1/agents — create profile
  registerWithLegacy(app, 'post', '/v1/agents', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'operator')) return;

    const parsed = createProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    const ownerKeyId = req.authKeyId ?? 'master';
    try {
      const profile = await agentProfileManager.create(
        parsed.data.workspaceId ?? null,
        ownerKeyId,
        parsed.data,
      );
      return reply.status(201).send(profile);
    } catch (err) {
      if (err instanceof AgentProfileNameError) {
        return reply.status(400).send({ error: err.message, code: 'INVALID_NAME' });
      }
      if (err instanceof AgentProfileEnvError) {
        return reply.status(400).send({ error: err.message, code: 'FORBIDDEN_ENV' });
      }
      throw err;
    }
  });

  // PATCH /v1/agents/:id — update profile
  registerWithLegacy(app, 'patch', '/v1/agents/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'operator')) return;

    const { id } = req.params as { id: string };
    const parsed = updateProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    }

    try {
      const profile = await agentProfileManager.update(id, parsed.data);
      return profile;
    } catch (err) {
      if (err instanceof AgentProfileNotFoundError) {
        return reply.status(404).send({ error: err.message, code: 'NOT_FOUND' });
      }
      if (err instanceof AgentProfileArchivedError) {
        return reply.status(409).send({ error: err.message, code: 'ARCHIVED' });
      }
      if (err instanceof AgentProfileNameError) {
        return reply.status(400).send({ error: err.message, code: 'INVALID_NAME' });
      }
      if (err instanceof AgentProfileEnvError) {
        return reply.status(400).send({ error: err.message, code: 'FORBIDDEN_ENV' });
      }
      throw err;
    }
  });

  // DELETE /v1/agents/:id — archive (soft delete)
  registerWithLegacy(app, 'delete', '/v1/agents/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'operator')) return;

    const { id } = req.params as { id: string };
    const archivedBy = req.authKeyId ?? 'master';

    try {
      const profile = await agentProfileManager.archive(id, archivedBy);
      return profile;
    } catch (err) {
      if (err instanceof AgentProfileNotFoundError) {
        return reply.status(404).send({ error: err.message, code: 'NOT_FOUND' });
      }
      throw err;
    }
  });

  // POST /v1/agents/:id/restore — restore archived profile
  registerWithLegacy(app, 'post', '/v1/agents/:id/restore', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireRole(auth, req, reply, 'operator')) return;

    const { id } = req.params as { id: string };

    try {
      const profile = await agentProfileManager.restore(id);
      return profile;
    } catch (err) {
      if (err instanceof AgentProfileNotFoundError) {
        return reply.status(404).send({ error: err.message, code: 'NOT_FOUND' });
      }
      throw err;
    }
  });
}
