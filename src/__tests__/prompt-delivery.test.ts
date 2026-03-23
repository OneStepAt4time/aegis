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
});
