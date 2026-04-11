/**
 * model-router.ts — Issue #743: Tiered Model Routing
 *
 * Scores task complexity from metadata (title, labels, description) and routes
 * to the optimal model tier: fast | standard | power.
 *
 * Scoring (0–100):
 *   0–30  → fast     (cheapest, e.g. Haiku-class)
 *   31–70 → standard (balanced, e.g. Sonnet-class)
 *   71–100 → power   (most capable, e.g. Opus-class)
 *
 * Concrete model names are configurable via environment variables:
 *   MODEL_FAST, MODEL_STANDARD, MODEL_POWER
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export type ModelTier = 'fast' | 'standard' | 'power';

export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  score: number;
  reasoning: string[];
}

/** Keyword signals mapped to model tier. First match in each tier wins. */
const ROUTING_KEYWORDS: Record<ModelTier, readonly string[]> = {
  power: [
    'security', 'auth', 'authentication', 'authorization',
    'architecture', 'redesign', 'migration', 'critical',
    'vulnerability', 'injection', 'cryptography', 'encryption',
    'race condition', 'concurrency', 'breaking change',
    'permission', 'privilege', 'escalation',
  ],
  standard: [
    'feature', 'enhancement', 'refactor', 'type-safety',
    'integration', 'api', 'endpoint', 'validation',
    'test', 'coverage', 'hook', 'pipeline', 'routing',
    'module', 'performance', 'optimization',
  ],
  fast: [
    'typo', 'docs', 'documentation', 'label', 'rename',
    'bump', 'chore', 'formatting', 'comment', 'readme',
    'changelog', 'version', 'lint', 'whitespace',
  ],
};

/** Default model names per tier (overridable via env vars). */
export const MODEL_TIERS: Record<ModelTier, string> = {
  fast: process.env.MODEL_FAST ?? 'claude-haiku-4-5',
  standard: process.env.MODEL_STANDARD ?? 'claude-sonnet-4-6',
  power: process.env.MODEL_POWER ?? 'claude-opus-4-6',
};

/**
 * Score a task 0–100 based on its metadata.
 * Returns the score and a human-readable reasoning list.
 */
export function scoreTaskComplexity(
  title: string,
  labels: string[],
  description: string,
): { score: number; reasoning: string[] } {
  const reasoning: string[] = [];
  let score = 35; // baseline: low-standard

  const text = `${title} ${description}`.toLowerCase();

  // Power keywords → raise score to at least power tier threshold
  for (const kw of ROUTING_KEYWORDS.power) {
    if (text.includes(kw)) {
      score = Math.max(score, 75);
      reasoning.push(`power keyword: "${kw}"`);
      break;
    }
  }

  // Fast keywords → lower score to at most fast tier threshold
  for (const kw of ROUTING_KEYWORDS.fast) {
    if (text.includes(kw)) {
      score = Math.min(score, 20);
      reasoning.push(`fast keyword: "${kw}"`);
      break;
    }
  }

  // Standard keywords → minor boost (avoid staying at baseline)
  if (reasoning.length === 0) {
    for (const kw of ROUTING_KEYWORDS.standard) {
      if (text.includes(kw)) {
        score += 5;
        reasoning.push(`standard keyword: "${kw}"`);
        break;
      }
    }
  }

  // Label overrides — applied after keyword signals
  for (const label of labels) {
    const l = label.toLowerCase();
    if (l === 'security' || l === 'critical' || l === 'breaking-change') {
      score = Math.max(score, 80);
      reasoning.push(`label override: "${l}" → power tier`);
    } else if (l === 'docs' || l === 'documentation' || l === 'chore') {
      score = Math.min(score, 20);
      reasoning.push(`label override: "${l}" → fast tier`);
    }
  }

  // Priority labels
  for (const label of labels) {
    if (label === 'P0' || label === 'P1') {
      score = Math.max(score, 72);
      reasoning.push(`priority label: "${label}" → elevate to power`);
    } else if (label === 'P3') {
      score = Math.min(score, 55);
      reasoning.push(`priority label: "P3" → cap at standard`);
    }
  }

  if (reasoning.length === 0) reasoning.push('baseline score — no keyword or label signals');

  return { score: Math.max(0, Math.min(100, score)), reasoning };
}

/** Map a 0–100 score to a model tier. */
export function scoreToTier(score: number): ModelTier {
  if (score <= 30) return 'fast';
  if (score <= 70) return 'standard';
  return 'power';
}

/**
 * Route a task to the optimal model tier and concrete model name.
 *
 * @example
 *   routeTask({ title: 'fix typo in README', labels: ['docs'] })
 *   // → { tier: 'fast', model: 'claude-haiku-4-5', score: 15, reasoning: [...] }
 */
export function routeTask(opts: {
  title: string;
  labels?: string[];
  description?: string;
}): RoutingDecision {
  const { title, labels = [], description = '' } = opts;
  const { score, reasoning } = scoreTaskComplexity(title, labels, description);
  const tier = scoreToTier(score);
  const model = MODEL_TIERS[tier];
  return { tier, model, score, reasoning };
}

/** Zod schema for POST /v1/dev/route-task request body. */
const routeTaskSchema = z.object({
  title: z.string().min(1).max(500),
  labels: z.array(z.string().max(100)).max(50).optional(),
  description: z.string().max(10_000).optional(),
});

/**
 * Register the model-routing endpoint on the Fastify app.
 *
 * POST /v1/dev/route-task — score a task and return model recommendation.
 * GET  /v1/dev/model-tiers — return current model-tier configuration.
 */
export function registerModelRouterRoutes(app: FastifyInstance): void {
  app.post('/v1/dev/route-task', async (req, reply) => {
    const parsed = routeTaskSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }
    const { title, labels, description } = parsed.data;
    return routeTask({ title, labels, description });
  });

  app.get('/v1/dev/model-tiers', async () => {
    return { tiers: MODEL_TIERS };
  });
}
