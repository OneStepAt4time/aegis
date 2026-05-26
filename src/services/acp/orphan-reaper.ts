/**
 * orphan-reaper.ts — Periodic reaper for orphaned ACP processes.
 *
 * Issue #4294: ACP Node wrapper processes can survive session kills when:
 * - The claude child exits before the ACP Node wrapper
 * - SIGTERM is sent but the Node process doesn't handle it
 * - Multiple rapid kills race with process cleanup
 *
 * This reaper runs periodically and shuts down ACP runtimes that no longer
 * correspond to active Aegis sessions.
 */

import type { StructuredLogger } from '../../logger.js';

export interface OrphanReaperDeps {
  /** Returns IDs of sessions known to the session manager. */
  getActiveSessionIds: () => string[];
  /** Returns IDs of sessions with active ACP runtimes. */
  getActiveAcpRuntimeIds: () => string[];
  /** Shuts down an ACP runtime for the given session ID. */
  shutdownAcpRuntime: (sessionId: string) => Promise<void>;
  /** Logger for structured output. */
  log: StructuredLogger;
}

export interface OrphanReaperResult {
  scanned: number;
  reaped: number;
  orphanIds: string[];
}

/**
 * Scan for ACP runtimes that don't correspond to any active session.
 * Returns the list of orphaned runtime IDs that were reaped.
 */
export async function reapOrphanAcpRuntimes(deps: OrphanReaperDeps): Promise<OrphanReaperResult> {
  const activeSessionIds = new Set(deps.getActiveSessionIds());
  const runtimeIds = deps.getActiveAcpRuntimeIds();

  const orphanIds = runtimeIds.filter(id => !activeSessionIds.has(id));

  if (orphanIds.length === 0) {
    return { scanned: runtimeIds.length, reaped: 0, orphanIds: [] };
  }

  deps.log.info({
    component: 'acp-orphan-reaper',
    operation: 'reap_orphan_runtimes',
    attributes: {
      scanned: runtimeIds.length,
      orphaned: orphanIds.length,
      orphanIds: orphanIds.join(','),
    },
  });

  let reaped = 0;
  for (const id of orphanIds) {
    try {
      await deps.shutdownAcpRuntime(id);
      reaped++;
    } catch (e) {
      deps.log.warn({
        component: 'acp-orphan-reaper',
        operation: 'reap_orphan_failed',
        attributes: {
          sessionId: id,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  return { scanned: runtimeIds.length, reaped, orphanIds };
}
