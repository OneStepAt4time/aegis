/**
 * sse-writer.test.ts — Tests for Issue #302: SSE back-pressure handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ServerResponse, IncomingMessage } from 'node:http';
import { SSEWriter } from '../sse-writer.js';

/** Create a mock ServerResponse for testing. */
function createMockRes(): { res: ServerResponse; ended: boolean; written: string[]; corkCalls: number } {
  const written: string[] = [];
  let corkCalls = 0;
  let ended = false;

  const res = {
    write(chunk: string): boolean {
      if (ended) throw new Error('Response was ended');
      written.push(chunk);
      return true; // buffer not full by default
    },
    end(): void {
      ended = true;
    },
    cork(): void {
      corkCalls++;
    },
    setHeader(): ServerResponse { return res as unknown as ServerResponse; },
    writeHead(): ServerResponse { return res as unknown as ServerResponse; },
  } as unknown as ServerResponse;

  return { res, ended: false, written, corkCalls: 0 };
}

describe('SSEWriter (Issue #302)', () => {
  it('should write SSE data to the response', () => {
    const { res, written } = createMockRes();
    const req = { on: vi.fn() } as unknown as IncomingMessage;
    const writer = new SSEWriter(res, req, vi.fn());

    const ok = writer.write('data: {"event":"test"}\n\n');

    expect(ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]).toBe('data: {"event":"test"}\n\n');
  });

  it('should return false and destroy connection after MAX_CONSECUTIVE_FAILURES failed writes', () => {
    const { res, written } = createMockRes();
    // Make write return false (buffer full)
    vi.spyOn(res, 'write').mockReturnValue(false);
    const req = { on: vi.fn() } as unknown as IncomingMessage;
    const writer = new SSEWriter(res, req, vi.fn());

    // 1st failure
    expect(writer.write('data: 1\n\n')).toBe(true); // still within threshold
    // 2nd failure
    expect(writer.write('data: 2\n\n')).toBe(true); // still within threshold
    // 3rd failure — should destroy
    expect(writer.write('data: 3\n\n')).toBe(false);
    expect(written).toHaveLength(0); // never actually wrote (or wrote but we track failures)
  });

  it('should reset failure counter on successful write', () => {
    const { res, written } = createMockRes();
    const writeMock = vi.spyOn(res, 'write');
    const req = { on: vi.fn() } as unknown as IncomingMessage;
    const writer = new SSEWriter(res, req, vi.fn());

    // Fail twice
    writeMock.mockReturnValue(false);
    writer.write('data: fail1\n\n');
    writer.write('data: fail2\n\n');

    // Succeed — resets counter
    writeMock.mockReturnValue(true);
    expect(writer.write('data: ok\n\n')).toBe(true);

    // Fail twice more — should NOT destroy (counter was reset)
    writeMock.mockReturnValue(false);
    writer.write('data: fail3\n\n');
    writer.write('data: fail4\n\n');
    // 3rd failure after reset should destroy
    expect(writer.write('data: fail5\n\n')).toBe(false);
  });

  it('should call onCleanup when destroyed due to back-pressure', () => {
    const { res } = createMockRes();
    vi.spyOn(res, 'write').mockReturnValue(false);
    const req = { on: vi.fn() } as unknown as IncomingMessage;
    const onCleanup = vi.fn();
    const writer = new SSEWriter(res, req, onCleanup);

    // Trigger destroy via consecutive failures
    writer.write('data: 1\n\n');
    writer.write('data: 2\n\n');
    writer.write('data: 3\n\n');

    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it('should register close listener on req', () => {
    const { res } = createMockRes();
    let closeHandler: (() => void) | undefined;
    const req = {
      on(event: string, handler: () => void): IncomingMessage {
        if (event === 'close') closeHandler = handler;
        return req as unknown as IncomingMessage;
      },
    } as unknown as IncomingMessage;
    const onCleanup = vi.fn();
    new SSEWriter(res, req, onCleanup);

    expect(closeHandler).toBeDefined();
    closeHandler!();
    expect(onCleanup).toHaveBeenCalledTimes(1);
  });

  it('should not write after connection is destroyed', () => {
    const { res, written } = createMockRes();
    vi.spyOn(res, 'write').mockReturnValue(false);
    const req = { on: vi.fn() } as unknown as IncomingMessage;
    const writer = new SSEWriter(res, req, vi.fn());

    // Destroy via back-pressure
    writer.write('data: 1\n\n');
    writer.write('data: 2\n\n');
    writer.write('data: 3\n\n');

    // Further writes should be no-ops
    writer.write('data: after\n\n');
    expect(written).toHaveLength(0);
  });

  describe('heartbeat', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should send heartbeat at interval', () => {
      const { res, written } = createMockRes();
      const req = { on: vi.fn() } as unknown as IncomingMessage;
      const writer = new SSEWriter(res, req, vi.fn());

      writer.startHeartbeat(30_000, 90_000, () => 'data: {"event":"heartbeat"}\n\n');

      vi.advanceTimersByTime(30_000);
      expect(written.some(w => w.includes('"heartbeat"'))).toBe(true);
    });

    it('should destroy connection after idle timeout', () => {
      const { res } = createMockRes();
      // Make writes fail so heartbeat doesn't reset the idle timer
      vi.spyOn(res, 'write').mockReturnValue(false);
      const req = { on: vi.fn() } as unknown as IncomingMessage;
      const onCleanup = vi.fn();
      const writer = new SSEWriter(res, req, onCleanup);

      writer.startHeartbeat(30_000, 90_000, () => 'data: {"event":"heartbeat"}\n\n');

      // Advance past idle timeout. Since writes fail, lastWrite is never updated.
      // At 120s interval fire, Date.now()-lastWrite = 120000 > 90000
      vi.advanceTimersByTime(120_001);

      expect(onCleanup).toHaveBeenCalledTimes(1);
    });

    it('should clean up interval when stopped', () => {
      const { res, written } = createMockRes();
      const req = { on: vi.fn() } as unknown as IncomingMessage;
      const writer = new SSEWriter(res, req, vi.fn());

      const stop = writer.startHeartbeat(30_000, 90_000, () => 'data: {"event":"heartbeat"}\n\n');

      stop();
      const countBefore = written.filter(w => w.includes('"heartbeat"')).length;
      vi.advanceTimersByTime(120_000);
      const countAfter = written.filter(w => w.includes('"heartbeat"')).length;
      expect(countAfter).toBe(countBefore);
    });
  });

  // Issue #825: res.end() instead of res.destroy() for clean termination
  describe('clean socket termination (Issue #825)', () => {
    it('should call res.end() instead of res.destroy() on back-pressure disconnect', () => {
      const { res, ended } = createMockRes();
      vi.spyOn(res, 'write').mockReturnValue(false);
      const endSpy = vi.spyOn(res, 'end');
      const req = { on: vi.fn() } as unknown as IncomingMessage;
      const writer = new SSEWriter(res, req, vi.fn());

      // Trigger destroy via consecutive failures
      writer.write('data: 1\n\n');
      writer.write('data: 2\n\n');
      writer.write('data: 3\n\n');

      expect(endSpy).toHaveBeenCalledTimes(1);
    });

    it('should call res.end() instead of res.destroy() on write exception', () => {
      const { res } = createMockRes();
      vi.spyOn(res, 'write').mockImplementation(() => { throw new Error('write failed'); });
      const endSpy = vi.spyOn(res, 'end');
      const req = { on: vi.fn() } as unknown as IncomingMessage;
      const writer = new SSEWriter(res, req, vi.fn());

      writer.write('data: boom\n\n');

      expect(endSpy).toHaveBeenCalledTimes(1);
    });
  });
});
