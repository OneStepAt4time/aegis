/**
 * send-message-stall-1798.test.ts — Issue #1798: send_message stall fix.
 *
 * Tests that sendMessage waits for CC to become idle before sending,
 * preventing Enter from disrupting active work (extended thinking, etc.)
 */

import { describe, it, expect, vi } from 'vitest';
import { detectUIState } from '../terminal-parser.js';

// Real CC pane fixtures (from terminal-parser.test.ts)

const IDLE_PANE = `
────────────────────────────────────────────────────────────────────────────────
❯
`;

const IDLE_WITH_PROMPT = `
Some previous output here...

────────────────────────────────────────────────────────────────────────────────
❯ Type your message...
`;

const WORKING_SPINNER = `
· Reading files...

────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_STATUS = `
✻ Working on your request...

Some content being generated...

────────────────────────────────────────────────────────────────────────────────
`;

const WORKING_PERAMBULATING = `
* Perambulating… (2m 27s · ↑ 4.5k tokens)

────────────────────────────────────────────────────────────────────────────────
`;

const PERMISSION_PROMPT = `
Do you want to proceed?

  1. Yes
  2. No

  (a) Always allow for this session
  (b) Always allow

Choice: _
`;

const UNKNOWN_PANE = `
some random terminal output
without any recognized patterns
`;

describe('Issue #1798: sendMessage idle-wait', () => {
  // Verify our test fixtures map to the expected UI states
  describe('pane fixture state verification', () => {
    it('IDLE_PANE is detected as idle', () => {
      expect(detectUIState(IDLE_PANE)).toBe('idle');
    });

    it('IDLE_WITH_PROMPT is detected as idle', () => {
      expect(detectUIState(IDLE_WITH_PROMPT)).toBe('idle');
    });

    it('WORKING_SPINNER is detected as working', () => {
      expect(detectUIState(WORKING_SPINNER)).toBe('working');
    });

    it('WORKING_STATUS is detected as working', () => {
      expect(detectUIState(WORKING_STATUS)).toBe('working');
    });

    it('WORKING_PERAMBULATING is detected as working', () => {
      expect(detectUIState(WORKING_PERAMBULATING)).toBe('working');
    });

    it('PERMISSION_PROMPT is detected as a non-waitable state', () => {
      const state = detectUIState(PERMISSION_PROMPT);
      expect(state).not.toBe('working');
      expect(state).not.toBe('compacting');
    });

    it('UNKNOWN_PANE is detected as unknown', () => {
      expect(detectUIState(UNKNOWN_PANE)).toBe('unknown');
    });
  });

  /**
   * Inline sendMessage + waitForIdleState logic for isolated unit testing.
   * Mirrors session.ts implementation exactly.
   */
  async function sendMessageLogic(
    capturePane: (windowId: string) => Promise<string>,
    sendKeysVerified: (windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>,
    windowId: string,
    text: string,
    timeoutMs = 30_000,
    pollMs = 2,
  ): Promise<{ delivered: boolean; attempts: number }> {
    const start = Date.now();
    let idle = false;
    while (Date.now() - start < timeoutMs) {
      const paneText = await capturePane(windowId);
      const uiState = detectUIState(paneText);
      if (uiState === 'idle' || uiState === 'waiting_for_input') {
        idle = true;
        break;
      }
      if (uiState !== 'working' && uiState !== 'compacting' && uiState !== 'context_warning') {
        idle = true;
        break;
      }
      await new Promise(r => setTimeout(r, pollMs));
    }

    if (!idle) {
      return { delivered: false, attempts: 0 };
    }

    return await sendKeysVerified(windowId, text);
  }

  it('sends immediately when CC is already idle', async () => {
    const capturePane = vi.fn<(windowId: string) => Promise<string>>().mockResolvedValue(IDLE_PANE);
    const sendKeysVerified = vi.fn<(windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>>()
      .mockResolvedValue({ delivered: true, attempts: 1 });

    const result = await sendMessageLogic(capturePane, sendKeysVerified, '@1', 'Hello CC');

    expect(result.delivered).toBe(true);
    expect(capturePane).toHaveBeenCalledTimes(1);
    expect(sendKeysVerified).toHaveBeenCalledWith('@1', 'Hello CC');
  });

  it('waits for idle when CC is working, then sends', async () => {
    const capturePane = vi.fn<(windowId: string) => Promise<string>>()
      .mockResolvedValueOnce(WORKING_SPINNER)
      .mockResolvedValueOnce(IDLE_PANE);
    const sendKeysVerified = vi.fn<(windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>>()
      .mockResolvedValue({ delivered: true, attempts: 1 });

    const result = await sendMessageLogic(capturePane, sendKeysVerified, '@1', 'Hello CC', 5_000, 2);

    expect(result.delivered).toBe(true);
    expect(capturePane).toHaveBeenCalledTimes(2);
    expect(sendKeysVerified).toHaveBeenCalledWith('@1', 'Hello CC');
  });

  it('returns failure when CC stays working past timeout', async () => {
    const capturePane = vi.fn<(windowId: string) => Promise<string>>().mockResolvedValue(WORKING_STATUS);
    const sendKeysVerified = vi.fn<(windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>>()
      .mockResolvedValue({ delivered: true, attempts: 1 });

    const result = await sendMessageLogic(capturePane, sendKeysVerified, '@1', 'Hello CC', 20, 2);

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(0);
    expect(sendKeysVerified).not.toHaveBeenCalled();
  });

  it('sends immediately when CC is in permission_prompt (non-waitable state)', async () => {
    const capturePane = vi.fn<(windowId: string) => Promise<string>>().mockResolvedValue(PERMISSION_PROMPT);
    const sendKeysVerified = vi.fn<(windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>>()
      .mockResolvedValue({ delivered: true, attempts: 1 });

    const result = await sendMessageLogic(capturePane, sendKeysVerified, '@1', 'Hello CC');

    expect(result.delivered).toBe(true);
    expect(capturePane).toHaveBeenCalledTimes(1);
    expect(sendKeysVerified).toHaveBeenCalledWith('@1', 'Hello CC');
  });

  it('sends immediately for unknown state (non-waitable)', async () => {
    const capturePane = vi.fn<(windowId: string) => Promise<string>>().mockResolvedValue(UNKNOWN_PANE);
    const sendKeysVerified = vi.fn<(windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>>()
      .mockResolvedValue({ delivered: true, attempts: 1 });

    const result = await sendMessageLogic(capturePane, sendKeysVerified, '@1', 'Hello CC');

    expect(result.delivered).toBe(true);
    expect(capturePane).toHaveBeenCalledTimes(1);
  });

  it('polls multiple times when CC stays working for several checks', async () => {
    const capturePane = vi.fn<(windowId: string) => Promise<string>>()
      .mockResolvedValueOnce(WORKING_SPINNER)
      .mockResolvedValueOnce(WORKING_STATUS)
      .mockResolvedValueOnce(WORKING_PERAMBULATING)
      .mockResolvedValueOnce(IDLE_WITH_PROMPT);
    const sendKeysVerified = vi.fn<(windowId: string, text: string) => Promise<{ delivered: boolean; attempts: number }>>()
      .mockResolvedValue({ delivered: true, attempts: 1 });

    const result = await sendMessageLogic(capturePane, sendKeysVerified, '@1', 'Hello CC', 5_000, 2);

    expect(result.delivered).toBe(true);
    expect(capturePane).toHaveBeenCalledTimes(4);
    expect(sendKeysVerified).toHaveBeenCalledTimes(1);
  });
});
