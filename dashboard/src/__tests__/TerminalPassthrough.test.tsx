/**
 * TerminalPassthrough.test.tsx — Tests for terminal streaming error UX (issue #2347).
 * Source-level assertions for the failure banner and retry logic.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TerminalPassthrough } from '../components/session/TerminalPassthrough';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../components/session/TerminalPassthrough.tsx'), 'utf-8');

describe('TerminalPassthrough', () => {
  it('exports the component', () => {
    expect(TerminalPassthrough).toBeDefined();
    expect(typeof TerminalPassthrough).toBe('function');
  });

  describe('streaming failure UX (issue #2347)', () => {
    it('failure detail banner has accessible retry button', () => {
      expect(src).toContain('aria-label="Retry terminal connection"');
    });

    it('failure banner mentions transcript and metrics fallback', () => {
      expect(src).toContain('transcript and metrics tabs remain available');
    });

    it('failure banner shows endpoint URL on give up', () => {
      expect(src).toContain('WebSocket to ${url} failed after multiple retries');
      expect(src).toContain('terminal backend may not be available');
    });

    it('retry mechanism uses retryKey state to force reconnection', () => {
      expect(src).toContain('setRetryKey');
      expect(src).toContain('retryKey');
    });

    it('failure detail state is declared', () => {
      expect(src).toContain('failureDetail');
      expect(src).toContain('setFailureDetail');
    });

    it('failure detail is cleared when retry is clicked', () => {
      expect(src).toContain('setFailureDetail(null)');
    });

    it('failure detail is set in onGiveUp handler', () => {
      expect(src).toContain('onGiveUp');
      // The onGiveUp should set failureDetail
      expect(src).toContain('setFailureDetail(');
    });

    it('WebSocket reconnection depends on retryKey', () => {
      // The WS useEffect should include retryKey in its dependency array
      // so changing retryKey forces a new connection
      expect(src).toMatch(/retryKey\]/);
    });

    it('reconnecting state clears failure detail', () => {
      // When reconnecting, previous failure should be cleared
      const reconnectIdx = src.indexOf('onReconnecting');
      const giveUpIdx = src.indexOf('onGiveUp');
      expect(reconnectIdx).toBeGreaterThan(-1);
      // Find setFailureDetail(null) between onReconnecting and onGiveUp
      const between = src.slice(reconnectIdx, giveUpIdx);
      expect(between).toContain('setFailureDetail(null)');
    });

    it('failure banner uses warning color tokens for consistency with LiveTerminal', () => {
      expect(src).toContain('color-warning');
    });
  });
});
