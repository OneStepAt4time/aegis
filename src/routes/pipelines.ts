import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './route-deps.js';
import { z } from 'zod';
import { pipelineSchema } from '../validation.js';

export function registerPipelineRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Pipeline create (Issue #36)
  app.post('/v1/pipelines', async (req, reply) => {
    const parsed = pipelineSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.issues });
    const pipeConfig = parsed.data;
    const safeWorkDir = await deps.validateWorkDir(pipeConfig.workDir);
    if (typeof safeWorkDir === 'object') {
      return reply.status(400).send({ error: `Invalid workDir: ${safeWorkDir.error}`, code: safeWorkDir.code });
    }
    pipeConfig.workDir = safeWorkDir;
    for (const stage of pipeConfig.stages) {
      if (stage.workDir) {
        const safeStageWorkDir = await deps.validateWorkDir(stage.workDir);
        if (typeof safeStageWorkDir === 'object') {
          return reply.status(400).send({ error: `Invalid workDir for stage "${stage.name}": ${safeStageWorkDir.error}`, code: safeStageWorkDir.code });
        }
        stage.workDir = safeStageWorkDir;
      }
    }
    try {
      const pipeline = await deps.pipelines.createPipeline(pipeConfig);
      return reply.status(201).send(pipeline);
    } catch (e: unknown) {
      return reply.status(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Pipeline status
  app.get<{ Params: { id: string } }>('/v1/pipelines/:id', async (req, reply) => {
    const pipeline = deps.pipelines.getPipeline(req.params.id);
    if (!pipeline) return reply.status(404).send({ error: 'Pipeline not found' });
    return pipeline;
  });

  // List pipelines
  app.get('/v1/pipelines', async () => deps.pipelines.listPipelines());
}
