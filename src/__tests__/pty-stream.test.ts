/**
 * pty-stream.test.ts — Tests for the PtyStream class.
 *
 * Tests the catchup buffer, lifecycle, and callback delegation.
 * External dependencies (mkfifo, pipe-pane, createReadStream) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PtyStream, CATCHUP_BUFFER_SIZE } from '../pty-stream.js';
import type { TmuxManager } from '../tmux.js';
import type { PtyStreamCallbacks } from '../pty-stream.js';

// --- Mocks ---

// Mock child_process.execFile for mkfifo
vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd: string, args: string[], cb: (err: null, stdout: string) => void) => {
    cb(null, '');
  }),
}));

// Mock node:fs — createReadStream returns a mock emitter
const mockReadStream = {
  on: vi.fn(),
  destroy: vi.fn(),
};
vi.mock('node:fs', () => ({
  createReadStream: vi.fn(() => mockReadStream),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

// Mock node:crypto for predictable FIFO paths
vi.mock('node:crypto', () => ({
  randomBytes: vi.fn((_size: number) => Buffer.from('deadbeefcafebabe', 'hex')),
}));

function makeTmuxManager(): TmuxManager {
  return {
    pipePane: vi.fn(async () => {}),
    unpipePane: vi.fn(async () => {}),
  } as unknown as TmuxManager;
}

function makeCallbacks(): PtyStreamCallbacks & {
  data: string[];
  errors: Error[];
  ended: boolean;
} {
  return {
    data: [],
    errors: [],
    ended: false,
    onData(chunk: string) { this.data.push(chunk); },
    onError(err: Error) { this.errors.push(err); },
    onEnd() { this.ended = true; },
  };
}

// --- Tests ---

describe('PtyStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a FIFO path in tmpdir', () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      expect(stream.fifoPath).toMatch(/aegis-pty-.*\.fifo$/);
      expect(stream.active).toBe(false);
    });
  });

  describe('start()', () => {
    it('should call mkfifo and pipePane', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      await stream.start();

      const { execFile } = await import('node:child_process');
      expect(execFile).toHaveBeenCalledWith('mkfifo', [stream.fifoPath], expect.any(Function));
      expect(tmux.pipePane).toHaveBeenCalledWith('@0', `cat > ${stream.fifoPath}`);
      expect(stream.active).toBe(true);
    });

    it('should register data/error/end handlers on the read stream', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      await stream.start();

      // createReadStream should have been called
      const { createReadStream } = await import('node:fs');
      expect(createReadStream).toHaveBeenCalledWith(
        stream.fifoPath,
        expect.objectContaining({ encoding: 'utf-8' }),
      );

      // Handlers should be registered
      expect(mockReadStream.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(mockReadStream.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockReadStream.on).toHaveBeenCalledWith('end', expect.any(Function));
    });
  });

  describe('stop()', () => {
    it('should call unpipePane and destroy the read stream', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      await stream.start();
      await stream.stop();

      expect(tmux.unpipePane).toHaveBeenCalledWith('@0');
      expect(mockReadStream.destroy).toHaveBeenCalled();
      expect(stream.active).toBe(false);
    });

    it('should remove the FIFO file', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      await stream.start();
      await stream.stop();

      const { unlinkSync } = await import('node:fs');
      expect(unlinkSync).toHaveBeenCalledWith(stream.fifoPath);
    });

    it('should handle stop when not started', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      // Should not throw
      await stream.stop();
      expect(stream.active).toBe(false);
    });

    it('should handle unpipePane failure gracefully', async () => {
      const tmux = makeTmuxManager();
      (tmux.unpipePane as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no pane'));
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      await stream.start();
      await stream.stop();

      expect(stream.active).toBe(false);
    });
  });

  describe('catchup buffer', () => {
    it('should be empty initially', () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      expect(stream.getCatchup()).toBe('');
    });

    it('should store initial catchup content', () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      stream.setInitialCatchup('initial pane content');
      expect(stream.getCatchup()).toBe('initial pane content');
    });

    it('should accumulate streamed data into catchup', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);
      await stream.start();

      // Find the 'data' handler that was registered on mockReadStream
      const dataHandler = mockReadStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      )?.[1] as (chunk: string) => void;

      dataHandler('chunk1');
      dataHandler('chunk2');

      expect(stream.getCatchup()).toBe('chunk1chunk2');
    });

    it('should combine initial catchup with streamed data', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      stream.setInitialCatchup('initial ');
      await stream.start();

      const dataHandler = mockReadStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      )?.[1] as (chunk: string) => void;

      dataHandler('streamed');
      expect(stream.getCatchup()).toBe('initial streamed');
    });

    it('should trim catchup when it exceeds 2x budget', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);
      await stream.start();

      const dataHandler = mockReadStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      )?.[1] as (chunk: string) => void;

      // Push data exceeding 2x CATCHUP_BUFFER_SIZE
      const bigChunk = 'x'.repeat(CATCHUP_BUFFER_SIZE);
      dataHandler(bigChunk);
      dataHandler(bigChunk);
      dataHandler('tail');

      const catchup = stream.getCatchup();
      expect(catchup.length).toBeLessThanOrEqual(CATCHUP_BUFFER_SIZE);
      expect(catchup.endsWith('tail')).toBe(true);
    });
  });

  describe('cleanup()', () => {
    it('should remove the FIFO file without going through tmux', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);

      stream.cleanup();

      const { unlinkSync } = await import('node:fs');
      expect(unlinkSync).toHaveBeenCalled();
      expect(tmux.unpipePane).not.toHaveBeenCalled();
    });
  });

  describe('callbacks', () => {
    it('should delegate data events to onData callback', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);
      await stream.start();

      const dataHandler = mockReadStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'data',
      )?.[1] as (chunk: string) => void;

      dataHandler('hello');
      expect(callbacks.data).toEqual(['hello']);
    });

    it('should delegate error events to onError callback', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);
      await stream.start();

      const errorHandler = mockReadStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'error',
      )?.[1] as (err: Error) => void;

      const err = new Error('FIFO broken');
      errorHandler(err);

      expect(callbacks.errors).toEqual([err]);
      expect(stream.active).toBe(false);
    });

    it('should delegate end events to onEnd callback', async () => {
      const tmux = makeTmuxManager();
      const callbacks = makeCallbacks();
      const stream = new PtyStream('@0', tmux, callbacks);
      await stream.start();

      const endHandler = mockReadStream.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'end',
      )?.[1] as () => void;

      endHandler();

      expect(callbacks.ended).toBe(true);
      expect(stream.active).toBe(false);
    });
  });
});
