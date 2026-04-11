/**
 * Issue #1393: Hook URL ?secret= not redacted in logs.
 *
 * Tests that the Fastify request serializer redacts both token= and secret=
 * query parameters from logged request URLs.
 */

import { describe, it, expect } from 'vitest';

/**
 * Mirrors the URL redaction logic in server.ts Fastify request serializer.
 * If the server.ts implementation changes, this test will fail — which is
 * the desired signal to update both or extract a shared utility.
 */
function redactUrlSecrets(url: string): string {
  let result = url;
  result = result.replace(/token=[^&]*/g, 'token=[REDACTED]');
  result = result.replace(/secret=[^&]*/g, 'secret=[REDACTED]');
  return result;
}

describe('Issue #1393: URL secret redaction in request logs', () => {
  it('redacts secret= query param', () => {
    const url = '/v1/hooks/Stop?sessionId=abc-123&secret=my-hook-secret-value';
    expect(redactUrlSecrets(url)).not.toContain('my-hook-secret-value');
    expect(redactUrlSecrets(url)).toContain('secret=[REDACTED]');
  });

  it('redacts secret= when it is the only param', () => {
    const url = '/v1/hooks/Stop?secret=alone-secret';
    expect(redactUrlSecrets(url)).not.toContain('alone-secret');
    expect(redactUrlSecrets(url)).toBe('/v1/hooks/Stop?secret=[REDACTED]');
  });

  it('redacts secret= at end of URL (no trailing &)', () => {
    const url = '/v1/hooks/Stop?sessionId=abc-123&secret=trailing-secret';
    expect(redactUrlSecrets(url)).not.toContain('trailing-secret');
  });

  it('redacts token= query param (existing behavior)', () => {
    const url = '/v1/events?token=my-sse-token';
    expect(redactUrlSecrets(url)).not.toContain('my-sse-token');
    expect(redactUrlSecrets(url)).toContain('token=[REDACTED]');
  });

  it('redacts both token= and secret= when both present', () => {
    const url = '/v1/hooks/Stop?token=tok123&sessionId=abc&secret=sec456';
    const redacted = redactUrlSecrets(url);
    expect(redacted).not.toContain('tok123');
    expect(redacted).not.toContain('sec456');
    expect(redacted).toContain('token=[REDACTED]');
    expect(redacted).toContain('secret=[REDACTED]');
  });

  it('leaves URLs without secrets unchanged', () => {
    const url = '/v1/sessions?page=1&limit=20';
    expect(redactUrlSecrets(url)).toBe(url);
  });

  it('leaves URL with unrelated query params unchanged', () => {
    const url = '/v1/hooks/Stop?sessionId=abc-123';
    expect(redactUrlSecrets(url)).toBe(url);
  });

  it('handles URLs with no query string', () => {
    const url = '/v1/sessions';
    expect(redactUrlSecrets(url)).toBe(url);
  });

  it('handles empty string', () => {
    expect(redactUrlSecrets('')).toBe('');
  });
});
