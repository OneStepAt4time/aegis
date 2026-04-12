/**
 * routes/pipelines.ts — Batch session creation and pipeline CRUD (Issue #36).
 */

import type { FastifyInstance } from 'fastify';
import { batchSessionSchema, pipelineSchema } from '../validation.js';
import type { RouteContext } from './context.js';
import { makePayload } from './context.js';
import { cleanupTerminatedSessionState } from '../session-cleanup.js';

const MAX_CONCURRENT_SESSIONS = 200;

export function registerPipelineRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { sessions, auth, metrics, monitor, eventBus, channels, pipelines, toolRegistry, requestKeyMap, validateWorkDir } = ctx;

  // Batch create (Issue #36, #583: per-key batch rate limit + global session cap)
  app.post('/v1/sessions/batch', async (req, reply) => {
    const parsed = batchSessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const specs = parsed.data.sessions;

    // #583: Per-key batch rate limit (max 1 batch per 5 seconds)
    const keyId = requestKeyMap.get(req.id) ?? 'anonymous';
    if (auth.checkBatchRateLimit(keyId)) {
      return reply.status(429).send({ error: 'Batch rate limit exceeded — 1 batch per 5 seconds per key' });
    }

    // #583: Global concurrent session cap
    const currentCount = sessions.listSessions().length;
    if (currentCount + specs.length > MAX_CONCURRENT_SESSIONS) {
      return reply.status(429).send({ error: `Session cap exceeded — ${currentCount} active, max ${MAX_CONCURRENT_SESSIONS}` });
    }

    for (const spec of specs) {
      const safeWorkDir = await validateWorkDir(spec.workDir);
      if (typeof safeWorkDir === 'object') {
        return reply.status(400).send({ error: `Invalid workDir "${spec.workDir}": ${safeWorkDir.error}`, code: safeWorkDir.code });
      }
      spec.workDir = safeWorkDir;
      // Issue #1429: Stamp owner on batch-created sessions
      if (req.authKeyId) (spec as Record<string, unknown>).ownerKeyId = req.authKeyId;
    }
    const result = await pipelines.batchCreate(specs);
    return reply.status(201).send(result);
  });

  // Pipeline create (Issue #36)
  app.post('/v1/pipelines', async (req, reply) => {
    const parsed = pipelineSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const pipeConfig = parsed.data;
    const safeWorkDir = await validateWorkDir(pipeConfig.workDir);
    if (typeof safeWorkDir === 'object') {
      return reply.status(400).send({ error: `Invalid workDir: ${safeWorkDir.error}`, code: safeWorkDir.code });
    }
    pipeConfig.workDir = safeWorkDir;
    // Validate per-stage workDir overrides for path traversal (#631)
    for (const stage of pipeConfig.stages) {
      if (stage.workDir) {
        const safeStageWorkDir = await validateWorkDir(stage.workDir);
        if (typeof safeStageWorkDir === 'object') {
          return reply.status(400).send({ error: `Invalid workDir for stage "${stage.name}": ${safeStageWorkDir.error}`, code: safeStageWorkDir.code });
        }
        stage.workDir = safeStageWorkDir;
      }
    }
    try {
      const pipeline = await pipelines.createPipeline(pipeConfig);
      return reply.status(201).send(pipeline);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Pipeline status
  app.get<{ Params: { id: string } }>('/v1/pipelines/:id', async (req, reply) => {
    const pipeline = pipelines.getPipeline(req.params.id);
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline not found' });
    return pipeline;
  });

  // List pipelines
  app.get('/v1/pipelines', async () => pipelines.listPipelines());
}
