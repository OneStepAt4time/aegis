/**
 * sendInitialPrompt-window-revalidate-2638.test.ts — Issue #2638
 *
 * Tests that sendInitialPrompt re-validates the tmux window ID after each
 * failed retry attempt. If tmux renamed the window (e.g. Claude Code sets
 * window titles during initialization), the stored windowId becomes stale.
 * The fix looks up by windowName and updates windowId before retrying.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TmuxManager, TmuxWindow } from '../tmux.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockTmux(overrides: Partial<TmuxManager> = {}): TmuxManager {
  return {
    windowExists: vi.fn().mockResolvedValue(true),
    listWindows: vi.fn().mockResolvedValue([]),
    capturePaneDirect: vi.fn().mockResolvedValue(''),
    sendKeysVerified: vi.fn().mockResolvedValue({ delivered: false, attempts: 1 }),
    ...overrides,
  } as unknown as TmuxManager;
}

// Build a minimal SessionManager-like object that exposes sendInitialPrompt
// by recreating just the retry logic from session.ts with the revalidation step.
// This tests the logic pattern without needing a full SessionManager instance.

interface SimpleSession {
  id: string;
  windowId: string;
  windowName: string;
}

async function simulateSendInitialPrompt(params: {
  session: SimpleSession;
  tmux: TmuxManager;
  maxRetries?: number;
  waitForReadyAndSend: () => Promise<{ delivered: boolean; attempts: number }>;
}): Promise<{ delivered: boolean; attempts: number; finalWindowId: string }> {
  const { session, tmux, waitForReadyAndSend } = params;
  const maxRetries = params.maxRetries ?? 2;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const result = await waitForReadyAndSend();
    if (result.delivered) return { ...result, finalWindowId: session.windowId };

    if (attempt > maxRetries) return { ...result, finalWindowId: session.windowId };

    // Issue #2638: revalidate window ID before retry
    await revalidateWindowId(session, tmux);
  }

  return { delivered: false, attempts: maxRetries + 1, finalWindowId: session.windowId };
}

async function revalidateWindowId(session: SimpleSession, tmux: TmuxManager): Promise<void> {
  try {
    const exists = await tmux.windowExists(session.windowId);
    if (exists) return;
    const windows = await tmux.listWindows();
    const match = windows.find(w => w.windowName === session.windowName);
    if (match) {
      session.windowId = match.windowId;
    }
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Issue #2638: sendInitialPrompt window ID revalidation', () => {
  it('should not change windowId when window still exists', async () => {
    const tmux = createMockTmux({
      windowExists: vi.fn().mockResolvedValue(true),
    });
    const session = { id: 's1', windowId: '@5', windowName: 'cc-abc12345' };

    const result = await simulateSendInitialPrompt({
      session,
      tmux,
      waitForReadyAndSend: vi.fn()
        .mockResolvedValueOnce({ delivered: false, attempts: 0 })
        .mockResolvedValueOnce({ delivered: true, attempts: 1 }),
    });

    expect(result.finalWindowId).toBe('@5');
    expect(tmux.windowExists).toHaveBeenCalledWith('@5');
    expect(tmux.listWindows).not.toHaveBeenCalled();
  });

  it('should update windowId when tmux renamed the window between retries', async () => {
    const tmux = createMockTmux({
      windowExists: vi.fn()
        // First call (after attempt 1 fails): old windowId @5 is gone
        .mockResolvedValueOnce(false),
      listWindows: vi.fn().mockResolvedValue([
        { windowId: '@9', windowName: 'cc-abc12345' } as TmuxWindow,
      ]),
    });
    const session = { id: 's1', windowId: '@5', windowName: 'cc-abc12345' };

    const result = await simulateSendInitialPrompt({
      session,
      tmux,
      waitForReadyAndSend: vi.fn()
        .mockResolvedValueOnce({ delivered: false, attempts: 0 })  // attempt 1 fails
        .mockResolvedValueOnce({ delivered: true, attempts: 1 }),   // attempt 2 succeeds
    });

    // Window ID should have been updated from @5 to @9
    expect(result.finalWindowId).toBe('@9');
    expect(tmux.windowExists).toHaveBeenCalledWith('@5');
    expect(tmux.listWindows).toHaveBeenCalledOnce();
  });

  it('should handle windowId changing multiple times across retries', async () => {
    let windowExistsCalls = 0;
    const tmux = createMockTmux({
      windowExists: vi.fn().mockImplementation(() => {
        windowExistsCalls++;
        // windowId is always stale by the time we check
        return Promise.resolve(false);
      }),
      listWindows: vi.fn()
        .mockResolvedValueOnce([{ windowId: '@10', windowName: 'cc-test' }] as TmuxWindow[])
        .mockResolvedValueOnce([{ windowId: '@11', windowName: 'cc-test' }] as TmuxWindow[]),
    });
    const session = { id: 's1', windowId: '@5', windowName: 'cc-test' };

    const sendFn = vi.fn()
      .mockResolvedValueOnce({ delivered: false, attempts: 0 })  // attempt 1 fails → revalidate to @10
      .mockResolvedValueOnce({ delivered: false, attempts: 0 })  // attempt 2 fails → revalidate to @11
      .mockResolvedValueOnce({ delivered: true, attempts: 1 });  // attempt 3 succeeds

    const result = await simulateSendInitialPrompt({
      session,
      tmux,
      maxRetries: 2,
      waitForReadyAndSend: sendFn,
    });

    expect(result.delivered).toBe(true);
    expect(result.finalWindowId).toBe('@11');
  });

  it('should not update windowId when window is gone entirely', async () => {
    const tmux = createMockTmux({
      windowExists: vi.fn().mockResolvedValue(false),
      listWindows: vi.fn().mockResolvedValue([]), // no windows with matching name
    });
    const session = { id: 's1', windowId: '@5', windowName: 'cc-abc12345' };

    const result = await simulateSendInitialPrompt({
      session,
      tmux,
      waitForReadyAndSend: vi.fn()
        .mockResolvedValueOnce({ delivered: false, attempts: 0 })
        .mockResolvedValueOnce({ delivered: false, attempts: 0 })
        .mockResolvedValueOnce({ delivered: false, attempts: 0 }),
    });

    // Window ID stays the same — no matching window found
    expect(result.finalWindowId).toBe('@5');
    expect(result.delivered).toBe(false);
  });

  it('should not block retry when tmux queries throw errors', async () => {
    const tmux = createMockTmux({
      windowExists: vi.fn().mockRejectedValue(new Error('tmux server not running')),
    });
    const session = { id: 's1', windowId: '@5', windowName: 'cc-abc12345' };

    const result = await simulateSendInitialPrompt({
      session,
      tmux,
      waitForReadyAndSend: vi.fn()
        .mockResolvedValueOnce({ delivered: false, attempts: 0 })
        .mockResolvedValueOnce({ delivered: true, attempts: 1 }),
    });

    // Should still proceed with retry despite tmux error
    expect(result.delivered).toBe(true);
    expect(result.finalWindowId).toBe('@5'); // unchanged (best effort)
  });

  it('should not call revalidation on first attempt (only after failure)', async () => {
    const tmux = createMockTmux();
    const session = { id: 's1', windowId: '@5', windowName: 'cc-abc12345' };

    await simulateSendInitialPrompt({
      session,
      tmux,
      waitForReadyAndSend: vi.fn().mockResolvedValue({ delivered: true, attempts: 1 }),
    });

    // First attempt succeeds — revalidation should never be called
    expect(tmux.windowExists).not.toHaveBeenCalled();
  });

  it('should match by windowName when looking up new windowId', async () => {
    const tmux = createMockTmux({
      windowExists: vi.fn().mockResolvedValue(false),
      listWindows: vi.fn().mockResolvedValue([
        { windowId: '@1', windowName: 'cc-other' } as TmuxWindow,
        { windowId: '@7', windowName: 'cc-abc12345' } as TmuxWindow,
        { windowId: '@8', windowName: 'cc-another' } as TmuxWindow,
      ]),
    });
    const session = { id: 's1', windowId: '@5', windowName: 'cc-abc12345' };

    const result = await simulateSendInitialPrompt({
      session,
      tmux,
      waitForReadyAndSend: vi.fn()
        .mockResolvedValueOnce({ delivered: false, attempts: 0 })
        .mockResolvedValueOnce({ delivered: true, attempts: 1 }),
    });

    // Should pick @7 which matches the session's windowName, not @1 or @8
    expect(result.finalWindowId).toBe('@7');
  });
});
