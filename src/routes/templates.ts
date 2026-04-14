/**
 * routes/templates.ts — Session template CRUD (Issue #467).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import * as templateStore from '../template-store.js';
import type { RouteContext } from './context.js';
import { registerWithLegacy } from './context.js';

// #1393: claudeCommand must not contain shell metacharacters
const SAFE_COMMAND_RE = /^[a-zA-Z0-9_./@:= -]+$/;

const createTemplateSchema = z.object({
  name: z.string().max(100),
  description: z.string().max(500).optional(),
  sessionId: z.string().uuid().optional(),
  workDir: z.string().min(1).optional(),
  prompt: z.string().max(100_000).optional(),
  claudeCommand: z.string().max(500).regex(SAFE_COMMAND_RE).optional(),
  env: z.record(z.string(), z.string()).optional(),
  stallThresholdMs: z.number().int().positive().max(3_600_000).optional(),
  permissionMode: z.enum(['default', 'bypassPermissions', 'plan', 'acceptEdits', 'dontAsk', 'auto']).optional(),
  autoApprove: z.boolean().optional(),
  memoryKeys: z.array(z.string()).max(50).optional(),
}).strict();

interface CreateTemplateRequest {
  name: string;
  description?: string;
  sessionId?: string;
  workDir?: string;
  prompt?: string;
  claudeCommand?: string;
  env?: Record<string, string>;
  stallThresholdMs?: number;
  permissionMode?: 'default' | 'bypassPermissions' | 'plan' | 'acceptEdits' | 'dontAsk' | 'auto';
  autoApprove?: boolean;
  memoryKeys?: string[];
}

export function registerTemplateRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
): void {
  const { sessions, validateWorkDir } = ctx;

  const templateRateLimit = {
    max: 60,
    timeWindow: '1 minute',
  } as const;

  // POST /v1/templates — Create a new template
  registerWithLegacy(app, 'post', '/v1/templates', {
    config: { rateLimit: templateRateLimit },
    handler: async (req: FastifyRequest<{ Body: CreateTemplateRequest }>, reply: FastifyReply) => {
      const parsed = createTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
      }

      const { name, description, sessionId, ...templateData } = parsed.data;

      const finalData = { ...templateData };
      if (sessionId) {
        const session = sessions.getSession(sessionId);
        if (!session) return reply.status(404).send({ error: 'Session not found' });
        if (!finalData.workDir) finalData.workDir = session.workDir;
        if (!finalData.stallThresholdMs && session.stallThresholdMs) finalData.stallThresholdMs = session.stallThresholdMs;
        if (!finalData.permissionMode && session.permissionMode !== 'default') {
          finalData.permissionMode = session.permissionMode as CreateTemplateRequest['permissionMode'];
        }
      }

      if (!finalData.workDir) {
        return reply.status(400).send({ error: 'workDir is required (provide sessionId or explicit workDir)' });
      }

      const safeWorkDir = await validateWorkDir(finalData.workDir);
      if (typeof safeWorkDir === 'object') {
        return reply.status(400).send({ error: `Invalid workDir: ${safeWorkDir.error}`, code: safeWorkDir.code });
      }

      try {
        const template = await templateStore.createTemplate({
          name,
          description,
          workDir: safeWorkDir,
          prompt: finalData.prompt,
          claudeCommand: finalData.claudeCommand,
          env: finalData.env,
          stallThresholdMs: finalData.stallThresholdMs,
          permissionMode: finalData.permissionMode,
          autoApprove: finalData.autoApprove,
          memoryKeys: finalData.memoryKeys,
        });
        return reply.status(201).send(template);
      } catch (e: unknown) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to create template' });
      }
    },
  });

  // GET /v1/templates — List all templates
  registerWithLegacy(app, 'get', '/v1/templates', {
    config: { rateLimit: templateRateLimit },
    handler: async (_req: FastifyRequest, _reply: FastifyReply) => {
      try { return await templateStore.listTemplates(); } catch { return []; }
    },
  });

  // GET /v1/templates/:id
  registerWithLegacy(app, 'get', '/v1/templates/:id', {
    config: { rateLimit: templateRateLimit },
    handler: async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const template = await templateStore.getTemplate(req.params.id);
        if (!template) return reply.status(404).send({ error: 'Template not found' });
        return template;
      } catch (e: unknown) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to get template' });
      }
    },
  });

  // PUT /v1/templates/:id
  registerWithLegacy(app, 'put', '/v1/templates/:id', {
    config: { rateLimit: templateRateLimit },
    handler: async (req: FastifyRequest<{ Params: { id: string }; Body: Partial<CreateTemplateRequest> }>, reply: FastifyReply) => {
      try {
        const updates = createTemplateSchema.partial().safeParse(req.body);
        if (!updates.success) {
          return reply.status(400).send({ error: 'Invalid request body', details: updates.error.issues });
        }
        const template = await templateStore.updateTemplate(req.params.id, updates.data as Parameters<typeof templateStore.updateTemplate>[1]);
        if (!template) return reply.status(404).send({ error: 'Template not found' });
        return template;
      } catch (e: unknown) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to update template' });
      }
    },
  });

  // DELETE /v1/templates/:id
  registerWithLegacy(app, 'delete', '/v1/templates/:id', {
    config: { rateLimit: templateRateLimit },
    handler: async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      try {
        const deleted = await templateStore.deleteTemplate(req.params.id);
        if (!deleted) return reply.status(404).send({ error: 'Template not found' });
        return { ok: true };
      } catch (e: unknown) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Failed to delete template' });
      }
    },
  });
}
