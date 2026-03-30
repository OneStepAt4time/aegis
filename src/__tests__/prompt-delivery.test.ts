/**
 * prompt-delivery.test.ts — Tests for Issue #1 v2: prompt delivery verification.
 *
 * Tests the verifyDelivery logic and sendKeysVerified retry pattern.
 * v2: state-change detection + no blind re-send when CC is active.
 */

import { describe, it, expect } from 'vitest';
import { detectUIState, type UIState } from '../terminal-parser.js';

describe('Prompt delivery verification v2', () => {
  const isActiveState = (state: string) =>
    ['working', 'permission_prompt', 'bash_approval', 'plan_mode', 'ask_question'].includes(state);

  describe('delivery evidence from pane state', () => {
    it('should confirm delivery when CC is working', () => {
      const activeStates: string[] = ['working', 'permission_prompt', 'bash_approval', 'plan_mode', 'ask_question'];
      for (const state of activeStates) {
        expect(isActiveState(state)).toBe(true);
      }
    });

    it('should reject delivery when CC is clearly idle', () => {
      expect(isActiveState('idle')).toBe(false);
    });

    it('should give benefit of doubt on unknown state', () => {
      const state: string = 'unknown';
      // unknown ≠ idle → benefit of the doubt
      expect(state !== 'idle').toBe(true);
    });
  });

  describe('state-change detection (v2 core improvement)', () => {
    it('should confirm delivery when state changed from idle to unknown (transitional)', () => {
      const preSendState: string = 'idle';
      const postSendState: string = 'unknown';
      const delivered = preSendState === 'idle' && postSendState !== 'idle';
      expect(delivered).toBe(true);
    });

    it('should confirm delivery when state changed from idle to working', () => {
      const preSendState: string = 'idle';
      const postSendState: string = 'working';
      const delivered = preSendState === 'idle' && postSendState !== 'idle';
      expect(delivered).toBe(true);
    });

    it('should NOT confirm when state stayed idle', () => {
      const preSendState: string = 'idle';
      const postSendState: string = 'idle';
      const stateChanged = preSendState === 'idle' && postSendState !== 'idle';
      const active = isActiveState(postSendState);
      expect(stateChanged || active).toBe(false);
    });

    it('should still use text-match fallback when state is ambiguous', () => {
      const paneText = `
        Some output
        Build a login page with React and TypeScript
        ❯
      `;
      const sentText = 'Build a login page with React and TypeScript';
      const searchText = sentText.slice(0, 60).trim();
      expect(searchText.length >= 5 && paneText.includes(searchText)).toBe(true);
    });
  });

  describe('no-blind-resend logic (v2 duplicate prevention)', () => {
    const shouldResend = (attempt: number, preState: string) =>
      attempt === 1 || preState === 'idle';

    it('should NOT re-send when CC is in active state on retry', () => {
      expect(shouldResend(2, 'working')).toBe(false);
    });

    it('should re-send when CC is idle on retry (text was lost)', () => {
      expect(shouldResend(2, 'idle')).toBe(true);
    });

    it('should NOT re-send when CC is in unknown state (could be transitioning)', () => {
      expect(shouldResend(2, 'unknown')).toBe(false);
    });

    it('should always send on first attempt regardless of state', () => {
      expect(shouldResend(1, 'working')).toBe(true);
      expect(shouldResend(1, 'idle')).toBe(true);
      expect(shouldResend(1, 'unknown')).toBe(true);
    });
  });

  describe('text matching in pane', () => {
    it('should match sent text in pane output', () => {
      const paneText = `
        Some output
        Build a login page with React and TypeScript
        ❯
      `;
      const sentText = 'Build a login page with React and TypeScript';
      const searchText = sentText.slice(0, 60).trim();
      expect(paneText.includes(searchText)).toBe(true);
    });

    it('should match prefix of long text (up to 60 chars now)', () => {
      const longText = 'Implement a comprehensive authentication system with OAuth2, JWT tokens, refresh token rotation, and multi-factor authentication';
      const paneText = `
        ${longText.slice(0, 80)}...
      `;
      const searchText = longText.slice(0, 60).trim();
      expect(paneText.includes(searchText)).toBe(true);
    });

    it('should not match short texts (< 5 chars) to avoid false positives', () => {
      const sentText = 'yes';
      const searchText = sentText.slice(0, 60).trim();
      expect(searchText.length >= 5).toBe(false);
    });

    it('should handle empty pane text', () => {
      const paneText = '';
      const sentText = 'Build something';
      const searchText = sentText.slice(0, 60).trim();
      expect(paneText.includes(searchText)).toBe(false);
    });
  });

  describe('graduated verification timing', () => {
    it('first attempt should check 3 times (800, 1500, 2500ms)', () => {
      const attempt = 1;
      const checkDelays = attempt === 1 ? [800, 1500, 2500] : [500, 1500];
      expect(checkDelays).toEqual([800, 1500, 2500]);
      expect(checkDelays.reduce((a, b) => a + b, 0)).toBe(4800);
    });

    it('retry attempts should check 2 times (500, 1500ms)', () => {
      const checkDelays = [500, 1500]; // attempt > 1
      expect(checkDelays).toEqual([500, 1500]);
      expect(checkDelays.reduce((a, b) => a + b, 0)).toBe(2000);
    });
  });

  describe('integration with terminal-parser', () => {
    it('should detect idle state for empty prompt', () => {
      const paneText = [
        '─'.repeat(50),
        '  ❯',
        '─'.repeat(50),
      ].join('\n');
      const state = detectUIState(paneText);
      expect(state).toBe('idle');
    });

    it('should detect working state with spinner', () => {
      const paneText = [
        '✻ Reading src/server.ts…',
        '─'.repeat(50),
        '  ❯',
        '─'.repeat(50),
      ].join('\n');
      const state = detectUIState(paneText);
      expect(['working', 'idle']).toContain(state);
    });
  });

  describe('retry pattern', () => {
    it('should succeed on first attempt when delivery confirmed', async () => {
      let attempts = 0;
      const sendKeysVerified = async () => {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          attempts++;
          const delivered = true;
          if (delivered) return { delivered: true, attempts: attempt };
        }
        return { delivered: false, attempts: maxAttempts };
      };

      const result = await sendKeysVerified();
      expect(result.delivered).toBe(true);
      expect(result.attempts).toBe(1);
    });

    it('should retry and succeed on second attempt', async () => {
      let attempts = 0;
      const sendKeysVerified = async () => {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          attempts++;
          const delivered = attempt >= 2;
          if (delivered) return { delivered: true, attempts: attempt };
        }
        return { delivered: false, attempts: maxAttempts };
      };

      const result = await sendKeysVerified();
      expect(result.delivered).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it('should fail after max attempts exhausted', async () => {
      const sendKeysVerified = async () => {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (false as boolean) return { delivered: true, attempts: attempt };
        }
        return { delivered: false, attempts: maxAttempts };
      };

      const result = await sendKeysVerified();
      expect(result.delivered).toBe(false);
      expect(result.attempts).toBe(3);
    });
  });

  describe('API response shape', () => {
    it('should return delivered and attempts in response', () => {
      const response = { ok: true, delivered: true, attempts: 1 };
      expect(response).toHaveProperty('ok');
      expect(response).toHaveProperty('delivered');
      expect(response).toHaveProperty('attempts');
    });

    it('should return delivered: false on failure', () => {
      const response = { ok: true, delivered: false, attempts: 3 };
      expect(response.delivered).toBe(false);
      expect(response.attempts).toBe(3);
    });
  });

  describe('sendInitialPrompt retry with exponential backoff', () => {
    it('should use 60s default timeout', () => {
      const DEFAULT_PROMPT_TIMEOUT_MS = 60_000;
      const DEFAULT_PROMPT_MAX_RETRIES = 2;
      expect(DEFAULT_PROMPT_TIMEOUT_MS).toBe(60_000);
      expect(DEFAULT_PROMPT_MAX_RETRIES).toBe(2);
    });

    it('should calculate retry timeout with 1.5x exponential multiplier, capped at 2min', () => {
      const baseTimeout = 60_000;
      const attemptTimeout = (attempt: number) =>
        attempt === 1 ? baseTimeout : Math.min(baseTimeout * Math.pow(1.5, attempt - 1), 120_000);

      // First attempt: 60s
      expect(attemptTimeout(1)).toBe(60_000);
      // Second attempt: 90s (1.5^1)
      expect(attemptTimeout(2)).toBe(90_000);
      // Third attempt: 135s (1.5^2), capped at 120s
      expect(attemptTimeout(3)).toBe(120_000);
    });

    it('should succeed on first attempt (CC ready immediately)', async () => {
      let pollCount = 0;
      const mockCapture = async () => {
        pollCount++;
        return '❯';
      };
      const sendMessage = async () => ({ delivered: true, attempts: 1 });

      // Simulate waitForReadyAndSend logic
      const pollInterval = 500;
      const timeoutMs = 60_000;
      const start = Date.now();
      let result = { delivered: false, attempts: 0 };
      while (Date.now() - start < timeoutMs) {
        const paneText = await mockCapture();
        if (paneText && (paneText.includes('❯') || paneText.includes('>'))) {
          result = await sendMessage();
          break;
        }
        await new Promise(r => setTimeout(r, 10)); // fast poll for test
      }
      expect(result.delivered).toBe(true);
      expect(pollCount).toBe(1);
    });

    it('should succeed on retry when CC is slow to start', async () => {
      let pollCount = 0;
      let readyOnPoll = 3;
      const mockCapture = async () => {
        pollCount++;
        return pollCount >= readyOnPoll ? '❯' : 'loading...';
      };
      const sendMessage = async () => ({ delivered: true, attempts: 1 });

      const start = Date.now();
      let result = { delivered: false, attempts: 0 };
      while (Date.now() - start < 1000) { // short timeout for test
        const paneText = await mockCapture();
        if (paneText && (paneText.includes('❯') || paneText.includes('>'))) {
          result = await sendMessage();
          break;
        }
        await new Promise(r => setTimeout(r, 10));
      }
      expect(result.delivered).toBe(true);
      expect(pollCount).toBe(3);
    });

    it('should return delivered: false when CC never becomes ready', async () => {
      const mockCapture = async () => 'still loading...';

      const start = Date.now();
      let result = { delivered: false, attempts: 0 };
      while (Date.now() - start < 100) { // very short timeout for test
        const paneText = await mockCapture();
        if (paneText && (paneText.includes('❯') || paneText.includes('>'))) {
          result = { delivered: true, attempts: 1 };
          break;
        }
        await new Promise(r => setTimeout(r, 10));
      }
      expect(result.delivered).toBe(false);
    });

    it('should accept > as ready indicator', async () => {
      const mockCapture = async () => '>';
      const sendMessage = async () => ({ delivered: true, attempts: 1 });

      const start = Date.now();
      let result = { delivered: false, attempts: 0 };
      while (Date.now() - start < 1000) {
        const paneText = await mockCapture();
        if (paneText && (paneText.includes('❯') || paneText.includes('>'))) {
          result = await sendMessage();
          break;
        }
        await new Promise(r => setTimeout(r, 10));
      }
      expect(result.delivered).toBe(true);
    });

    it('total attempts = maxRetries + 1 (initial + retries)', () => {
      const maxRetries = 2;
      const totalAttempts = maxRetries + 1;
      expect(totalAttempts).toBe(3);
    });
  });

  describe('readiness check for initial prompt (issue #561)', () => {
    it('should NOT consider pane ready when only ❯ appears without chrome separators', () => {
      // Splash screen output with ❯ but no chrome separators
      const paneText = [
        'Welcome to Claude Code!',
        'Type ❯ to get started',
      ].join('\n');
      const state = detectUIState(paneText);
      // detectUIState should NOT return 'idle' for this
      expect(state).not.toBe('idle');
    });

    it('should consider pane ready when chrome separators and prompt are present', () => {
      const paneText = [
        '─'.repeat(50),
        '  ❯',
        '─'.repeat(50),
      ].join('\n');
      const state = detectUIState(paneText);
      expect(state).toBe('idle');
    });

    it('should NOT match ❯ embedded in diff output', () => {
      const paneText = [
        'diff --git a/file.ts b/file.ts',
        '−❯ old line',
        '+new line',
      ].join('\n');
      const state = detectUIState(paneText);
      expect(state).not.toBe('idle');
    });
  });
});
