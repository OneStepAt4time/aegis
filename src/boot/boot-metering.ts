/**
 * boot-metering.ts — Metering, budget, and JSONL watcher initialization.
 *
 * Extracted from server.ts as part of #4243 (god object reduction).
 * Creates MeteringService, BudgetStore/Evaluator/Timer, wires JSONL watcher
 * events to metrics and metering, and replays historical data for backfill.
 */

import path from 'node:path';

import { logger } from '../logger.js';
import type { AppContext } from '../app-context.js';
import type { MeteringService } from '../metering.js';
import type { SessionEventBus } from '../events.js';
import { readNewEntries, extractTokenDelta } from '../transcript.js';

/**
 * Initialize metering service, budget alerts, and wire JSONL watcher events.
 * Returns the MeteringService instance for periodic save and shutdown.
 */
export async function bootMetering(
  ctx: AppContext,
  metering: MeteringService,
  eventBus: SessionEventBus,
): Promise<void> {
  // Issue #3310: Load persisted metering records from previous runs.
  try {
    await metering.load();
    metering.start();
  } catch (e) {
    logger.error({ component: 'server', operation: 'metering_load_failed', attributes: { error: e instanceof Error ? e.message : String(e) } });
  }

  // Issue #488: Accumulate token usage from JSONL events into per-session metrics.
  // Issue #2536: Also count messages and tool calls from JSONL events.
  ctx.jsonlWatcher.onEntries((event) => {
    if (ctx.metrics) {
      const { tokenUsageDelta } = event;
      if (tokenUsageDelta.inputTokens > 0 || tokenUsageDelta.outputTokens > 0) {
        const model = ctx.sessions.getSession(event.sessionId)?.model;
        ctx.metrics.recordTokenUsage(event.sessionId, tokenUsageDelta, model);
        // Issue #3264: Persist token usage to MeteringService for cost API queries.
        metering.recordTokenUsage(event.sessionId, tokenUsageDelta, model);
      }
      // Issue #2536: Count messages and tool calls from parsed entries.
      for (const msg of event.messages) {
        ctx.metrics.messageReceived(event.sessionId);
        if (msg.contentType === 'tool_use') {
          ctx.metrics.toolCallReceived(event.sessionId);
        }
      }
    }
  });

  // Start watching JSONL files for already-discovered sessions
  for (const session of ctx.sessions.listSessions()) {
    if (session.jsonlPath) {
      ctx.jsonlWatcher.watch(session.id, session.jsonlPath, session.monitorOffset);
    }
  }

  // Issue #3310: Initial replay of existing JSONL data for metering backfill.
  // The JSONL watcher only fires on file changes, so historical token data
  // from sessions that were already completed would never be metered.
  for (const session of ctx.sessions.listSessions()) {
    if (session.jsonlPath && session.monitorOffset > 0) {
      try {
        const result = await readNewEntries(session.jsonlPath, 0);
        const delta = extractTokenDelta(result.raw);
        if (delta.inputTokens > 0 || delta.outputTokens > 0) {
          const model = ctx.sessions.getSession(session.id)?.model;
          metering.recordTokenUsage(session.id, delta, model);
        }
      } catch {
        // Non-critical: backfill failure should not block server startup.
      }
    }
  }

  // Persist the backfilled metering data.
  try {
    await metering.save();
  } catch {
    // Non-critical.
  }
}
