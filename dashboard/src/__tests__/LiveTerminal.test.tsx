/**
 * LiveTerminal.test.tsx — Tests for terminal streaming error UX (issue #2347).
 * Source-level assertions for the failure banner and retry logic.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(__dirname, '../components/session/LiveTerminal.tsx'), 'utf-8');

describe('LiveTerminal — streaming failure UX (issue #2347)', () => {
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

  it('RECONNECTING state is uppercase for visibility', () => {
    expect(src).toContain("'RECONNECTING...'");
    expect(src).toContain("'connecting...'");
    expect(src).toContain("'ws live'");
  });

  it('failure detail is cleared when retry is clicked', () => {
    expect(src).toContain('setFailureDetail(null)');
  });
});
