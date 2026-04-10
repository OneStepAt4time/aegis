import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './route-deps.js';
import { z } from 'zod';
import { readNewEntries } from '../transcript.js';
import { diagnosticsBus } from '../diagnostics.js';

const diagnosticsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function registerDiagnosticRoutes(app: FastifyInstance, deps: RouteDeps): void {
  // Global metrics (Issue #40)
  app.get('/v1/metrics', async () => deps.metrics.getGlobalMetrics(deps.sessions.listSessions().length));

  // Bounded no-PII diagnostics channel (Issue #881)
  app.get('/v1/diagnostics', async (req, reply) => {
    const parsed = diagnosticsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid diagnostics query params', details: parsed.error.issues });
    }
    const limit = parsed.data.limit ?? 50;
    const events = diagnosticsBus.getRecent(limit);
    return { count: events.length, events };
  });

  // Per-session metrics (Issue #40)
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/metrics', async (req, reply) => {
    const m = deps.metrics.getSessionMetrics(req.params.id);
    if (!m) return reply.status(404).send({ error: 'No metrics for this session' });
    return m;
  });

  // Issue #704: Tool usage endpoints
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/tools', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = deps.sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    if (session.jsonlPath) {
      try {
        const result = await readNewEntries(session.jsonlPath, 0);
        deps.toolRegistry.processEntries(req.params.id, result.entries);
      } catch { /* JSONL not available */ }
    }
    const tools = deps.toolRegistry.getSessionTools(req.params.id);
    return { sessionId: req.params.id, tools, totalCalls: tools.reduce((sum, t) => sum + t.count, 0) };
  });

  app.get('/v1/tools', async () => {
    const definitions = deps.toolRegistry.getToolDefinitions();
    const categories = [...new Set(definitions.map(t => t.category))];
    return { tools: definitions, categories, totalTools: definitions.length };
  });

  // Issue #89 L14: Webhook dead letter queue
  app.get('/v1/webhooks/dead-letter', async () => {
    for (const ch of deps.channels.getChannels()) {
      if (ch.name === 'webhook' && typeof ch.getDeadLetterQueue === 'function') {
        return ch.getDeadLetterQueue();
      }
    }
    return [];
  });

  // Issue #89 L15: Per-channel health reporting
  app.get('/v1/channels/health', async () => {
    return deps.channels.getChannels().map(ch => {
      const health = ch.getHealth?.();
      if (health) return health;
      return { channel: ch.name, healthy: true, lastSuccess: null, lastError: null, pendingCount: 0 };
    });
  });

  // Issue #87: Per-session latency metrics
  app.get<{ Params: { id: string } }>('/v1/sessions/:id/latency', async (req, reply) => {
    const sessionId = (req.params as { id: string }).id;
    const session = deps.sessions.getSession(sessionId);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    const realtimeLatency = deps.sessions.getLatencyMetrics(req.params.id);
    const aggregatedLatency = deps.metrics.getSessionLatency(req.params.id);
    return { sessionId: req.params.id, realtime: realtimeLatency, aggregated: aggregatedLatency };
  });
}
