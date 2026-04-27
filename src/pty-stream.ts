/**
 * pty-stream.ts — PTY output streaming via tmux pipe-pane + FIFO.
 *
 * Issue #2202: Replaces the 500ms polling approach with real-time streaming.
 *
 * Architecture:
 *   tmux pane output → pipe-pane → cat > FIFO → Node.js ReadStream → callbacks
 *
 * Each session with active WebSocket subscribers gets one PtyStream instance.
 * The FIFO is created in the system temp directory and cleaned up on stop.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { TmuxManager } from './tmux.js';

const execFileAsync = promisify(execFile);

/** Maximum characters kept in the catchup buffer for late-joining subscribers. */
export const CATCHUP_BUFFER_SIZE = 65_536; // ~64KB

export interface PtyStreamCallbacks {
  /** Called with each chunk of raw PTY output. */
  onData(chunk: string): void;
  /** Called on unrecoverable stream error. */
  onError(err: Error): void;
  /** Called when the pipe closes (session ended or pipe-pane stopped). */
  onEnd(): void;
}

/**
 * Manages a real-time PTY output stream for a tmux pane.
 *
 * Lifecycle:
 *  1. `start()` — create FIFO, open read stream, start pipe-pane
 *  2. Data flows: tmux → pipe-pane → cat → FIFO → Node.js → callbacks
 *  3. `stop()` — stop pipe-pane, close read stream, remove FIFO
 */
export class PtyStream {
  readonly fifoPath: string;
  private readStream: import('node:fs').ReadStream | null = null;
  private _active = false;

  // Catchup buffer: stores recent output for late-joining subscribers.
  // Uses string chunks with size tracking; trims when over budget.
  private catchupChunks: string[] = [];
  private catchupSize = 0;

  constructor(
    private readonly windowId: string,
    private readonly tmux: TmuxManager,
    private readonly callbacks: PtyStreamCallbacks,
  ) {
    const id = randomBytes(8).toString('hex');
    this.fifoPath = join(tmpdir(), `aegis-pty-${id}.fifo`);
  }

  /** Start streaming. Creates the FIFO, opens the read end, and starts pipe-pane. */
  async start(): Promise<void> {
    // 1. Create FIFO
    await execFileAsync('mkfifo', [this.fifoPath]);

    // 2. Open read stream.
    //    For a FIFO, the open completes when both reader and writer connect.
    //    pipe-pane starts cat (the writer) concurrently below.
    this.readStream = createReadStream(this.fifoPath, {
      encoding: 'utf-8',
      highWaterMark: 64 * 1024,
    });

    this.readStream.on('data', (chunk: string) => {
      this.pushCatchup(chunk);
      this.callbacks.onData(chunk);
    });

    this.readStream.on('error', (err: Error) => {
      this._active = false;
      this.callbacks.onError(err);
    });

    this.readStream.on('end', () => {
      this._active = false;
      this.callbacks.onEnd();
    });

    // 3. Start pipe-pane — cat writes pane output to the FIFO.
    //    Must happen after the readStream is created so both ends connect.
    await this.tmux.pipePane(this.windowId, `cat > ${this.fifoPath}`);
    this._active = true;
  }

  /** Stop streaming and clean up all resources. */
  async stop(): Promise<void> {
    this._active = false;

    // Stop pipe-pane first so cat exits cleanly.
    try {
      await this.tmux.unpipePane(this.windowId);
    } catch { /* pipe-pane may have already stopped */ }

    // Close read stream.
    if (this.readStream) {
      this.readStream.destroy();
      this.readStream = null;
    }

    // Remove FIFO file.
    this.removeFifo();
  }

  /** Whether the stream is actively receiving data. */
  get active(): boolean {
    return this._active;
  }

  /** Set the initial catchup content (e.g., a full pane capture before streaming). */
  setInitialCatchup(content: string): void {
    this.catchupChunks = [content];
    this.catchupSize = content.length;
  }

  /** Get the catchup buffer — recent PTY output for late-joining subscribers. */
  getCatchup(): string {
    if (this.catchupSize <= CATCHUP_BUFFER_SIZE) {
      return this.catchupChunks.join('');
    }
    // Over budget — trim from the front, keeping the last CATCHUP_BUFFER_SIZE chars.
    const joined = this.catchupChunks.join('');
    return joined.slice(joined.length - CATCHUP_BUFFER_SIZE);
  }

  /** Clean up FIFO without going through tmux (for crash recovery / test teardown). */
  cleanup(): void {
    this.removeFifo();
  }

  // ── Private ──────────────────────────────────────────────────────

  private pushCatchup(chunk: string): void {
    this.catchupChunks.push(chunk);
    this.catchupSize += chunk.length;

    // Trim when over 2x budget to avoid unbounded growth.
    if (this.catchupSize > CATCHUP_BUFFER_SIZE * 2) {
      this.trimCatchup();
    }
  }

  private trimCatchup(): void {
    // Keep last CATCHUP_BUFFER_SIZE characters.
    const joined = this.catchupChunks.join('');
    const trimmed = joined.slice(joined.length - CATCHUP_BUFFER_SIZE);
    this.catchupChunks = [trimmed];
    this.catchupSize = trimmed.length;
  }

  private removeFifo(): void {
    try {
      if (existsSync(this.fifoPath)) {
        unlinkSync(this.fifoPath);
      }
    } catch { /* best effort */ }
  }
}
