/**
 * Tests for ACP orphan reaper (Issue #4294).
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { reapOrphanAcpRuntimes } from '../services/acp/orphan-reaper.js';

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as import('../logger.js').StructuredLogger;
}

describe('reapOrphanAcpRuntimes', () => {
  it('returns zero when no orphans exist', async () => {
    const shutdown = vi.fn();
    const result = await reapOrphanAcpRuntimes({
      getActiveSessionIds: () => ['a', 'b'],
      getActiveAcpRuntimeIds: () => ['a', 'b'],
      shutdownAcpRuntime: shutdown,
      log: createMockLogger(),
    });
    expect(result.scanned).toBe(2);
    expect(result.reaped).toBe(0);
    expect(result.orphanIds).toEqual([]);
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('reaps runtimes with no matching session', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const result = await reapOrphanAcpRuntimes({
      getActiveSessionIds: () => ['a'],
      getActiveAcpRuntimeIds: () => ['a', 'orphan1', 'orphan2'],
      shutdownAcpRuntime: shutdown,
      log: createMockLogger(),
    });
    expect(result.scanned).toBe(3);
    expect(result.reaped).toBe(2);
    expect(result.orphanIds).toEqual(['orphan1', 'orphan2']);
    expect(shutdown).toHaveBeenCalledTimes(2);
    expect(shutdown).toHaveBeenCalledWith('orphan1');
    expect(shutdown).toHaveBeenCalledWith('orphan2');
  });

  it('continues reaping after individual shutdown failures', async () => {
    const shutdown = vi.fn()
      .mockRejectedValueOnce(new Error('shutdown failed'))
      .mockResolvedValueOnce(undefined);
    const log = createMockLogger();
    const result = await reapOrphanAcpRuntimes({
      getActiveSessionIds: () => [],
      getActiveAcpRuntimeIds: () => ['orphan1', 'orphan2'],
      shutdownAcpRuntime: shutdown,
      log,
    });
    expect(result.reaped).toBe(1);
    expect(result.orphanIds).toEqual(['orphan1', 'orphan2']);
    // Logger should have warned about the failure
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('handles empty runtime list', async () => {
    const result = await reapOrphanAcpRuntimes({
      getActiveSessionIds: () => [],
      getActiveAcpRuntimeIds: () => [],
      shutdownAcpRuntime: vi.fn(),
      log: createMockLogger(),
    });
    expect(result.scanned).toBe(0);
    expect(result.reaped).toBe(0);
  });
});
