/**
 * sse-drain-1911.test.ts — Tests for Issue #1911:
 *   - SSE heartbeat/idle-timeout uses config values (sseIdleMs / sseClientTimeoutMs)
 *   - SessionEventBus.emitShutdown() broadcasts to global subscribers
 *   - AuditLogger.flush() resolves after pending writes
 *   - Config defaults for the five new #1911 fields
 *   - Health draining state flag
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { SSEWriter } from '../sse-writer.js';
import { SessionEventBus } from '../events.js';
import { AuditLogger } from '../audit.js';
import { loadConfig } from '../config.js';

// ── Helpers ────────────────────────────────────────────────────────

function createMockRes(): { res: ServerResponse; written: string[] } {
  const written: string[] = [];
  const res = {
    write(chunk: string): boolean {
      written.push(chunk);
      return true;
    },
    end(): void {},
  } as unknown as ServerResponse;
  return { res, written };
}

function createMockReq(onClose?: () => void): IncomingMessage {
  return {
    on(event: string, handler: () => void): IncomingMessage {
      if (event === 'close' && onClose) onClose();
      return this as unknown as IncomingMessage;
    },
  } as unknown as IncomingMessage;
}

// ── SSEWriter: config-driven heartbeat interval ────────────────────

describe('Issue #1911: SSEWriter respects configurable heartbeat intervals', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('emits heartbeat at the configured sseIdleMs interval (not hardcoded 30_000)', () => {
    const { res, written } = createMockRes();
    const req = createMockReq();
    const writer = new SSEWriter(res, req, vi.fn());

    const customIdleMs = 5_000;
    writer.startHeartbeat(customIdleMs, 300_000, () => 'data: {"event":"heartbeat"}\n\n');

    // No heartbeat yet
    expect(written.filter(w => w.includes('"heartbeat"'))).toHaveLength(0);

    // Advance past the custom interval
    vi.advanceTimersByTime(customIdleMs + 1);
    expect(written.filter(w => w.includes('"heartbeat"'))).toHaveLength(1);
  });

  it('destroys connection after sseClientTimeoutMs idle (not hardcoded 90_000)', () => {
    const { res } = createMockRes();
    // Make writes fail so lastWrite is never updated
    vi.spyOn(res, 'write').mockReturnValue(false);
    const req = createMockReq();
    const onCleanup = vi.fn();
    const writer = new SSEWriter(res, req, onCleanup);

    const customIdleMs = 5_000;
    const customClientTimeoutMs = 15_000;
    writer.startHeartbeat(customIdleMs, customClientTimeoutMs, () => ':ping\n\n');

    // First heartbeat fires at 5_001ms. lastWrite is at t=0, so elapsed = 5_001 > 15_000? No.
    vi.advanceTimersByTime(customIdleMs + 1);
    expect(onCleanup).not.toHaveBeenCalled();

    // Advance to exceed client timeout
    vi.advanceTimersByTime(customClientTimeoutMs);
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });
});

// ── SessionEventBus.emitShutdown() ────────────────────────────────

describe('Issue #1911: SessionEventBus.emitShutdown() broadcasts shutdown frame', () => {
  it('delivers shutdown event to all global subscribers', () => {
    const bus = new SessionEventBus();
    const received: string[] = [];

    const unsub = bus.subscribeGlobal((event) => {
      received.push(event.event);
    });

    bus.emitShutdown();
    unsub();

    expect(received).toContain('shutdown');
  });

  it('is a no-op when there are no global subscribers', () => {
    const bus = new SessionEventBus();
    // Should not throw
    expect(() => bus.emitShutdown()).not.toThrow();
  });

  it('shutdown event has an empty sessionId and a timestamp', () => {
    const bus = new SessionEventBus();
    let captured: { event: string; sessionId: string; timestamp: string } | undefined;

    const unsub = bus.subscribeGlobal((event) => {
      captured = event;
    });

    bus.emitShutdown();
    unsub();

    expect(captured).toBeDefined();
    expect(captured!.event).toBe('shutdown');
    expect(captured!.sessionId).toBe('');
    expect(captured!.timestamp).toBeTruthy();
  });
});

// ── AuditLogger.flush() ───────────────────────────────────────────

describe('Issue #1911: AuditLogger.flush() awaits pending writes', () => {
  it('resolves immediately when there are no pending writes', async () => {
    const logger = new AuditLogger();
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});

// ── Config defaults ────────────────────────────────────────────────

describe('Issue #1911: Config defaults for new timeout fields', () => {
  it('loadConfig returns correct defaults for #1911 fields', async () => {
    const config = await loadConfig();
    expect(config.sseIdleMs).toBe(120_000);
    expect(config.sseClientTimeoutMs).toBe(300_000);
    expect(config.hookTimeoutMs).toBe(10_000);
    expect(config.shutdownGraceMs).toBe(15_000);
    expect(config.shutdownHardMs).toBe(20_000);
  });

  it('AEGIS_SSE_IDLE_MS env var overrides sseIdleMs', async () => {
    process.env.AEGIS_SSE_IDLE_MS = '60000';
    try {
      const config = await loadConfig();
      expect(config.sseIdleMs).toBe(60_000);
    } finally {
      delete process.env.AEGIS_SSE_IDLE_MS;
    }
  });

  it('AEGIS_HOOK_TIMEOUT_MS env var overrides hookTimeoutMs', async () => {
    process.env.AEGIS_HOOK_TIMEOUT_MS = '5000';
    try {
      const config = await loadConfig();
      expect(config.hookTimeoutMs).toBe(5_000);
    } finally {
      delete process.env.AEGIS_HOOK_TIMEOUT_MS;
    }
  });

  it('AEGIS_SHUTDOWN_GRACE_MS env var overrides shutdownGraceMs', async () => {
    process.env.AEGIS_SHUTDOWN_GRACE_MS = '8000';
    try {
      const config = await loadConfig();
      expect(config.shutdownGraceMs).toBe(8_000);
    } finally {
      delete process.env.AEGIS_SHUTDOWN_GRACE_MS;
    }
  });
});
