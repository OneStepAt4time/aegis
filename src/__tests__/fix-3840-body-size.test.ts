/**
 * Issue #3840: no request body size limit — 1MB+ prompt accepted without validation
 *
 * Regression tests confirming:
 * - Prompt > 100K chars → 400 VALIDATION_ERROR
 * - Prompt ≤ 100K chars → not rejected for size
 * - Fastify bodyLimit: 1MB already enforced at server level
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const BASE = 'http://localhost:9100';

describe('Request body size limits (#3840)', () => {
  it('rejects prompt > 100K characters with VALIDATION_ERROR', async () => {
    const body = JSON.stringify({ prompt: 'x'.repeat(100_001), workDir: join(tmpdir(), 'aegis-test') });
    const res = await fetch(`${BASE}/v1/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AEGIS_TOKEN || ''}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
    const detail = json.details?.[0];
    expect(detail?.path).toContain('prompt');
    expect(detail?.code).toBe('too_big');
  });

  it('accepts prompt at exactly 100K characters (not rejected for size)', async () => {
    const body = JSON.stringify({ prompt: 'x'.repeat(100_000), workDir: join(tmpdir(), 'aegis-test') });
    const res = await fetch(`${BASE}/v1/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.AEGIS_TOKEN || ''}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const json: any = await res.json();
    // Should not be VALIDATION_ERROR for prompt size
    const sizeError = json.details?.find((d: any) => d.path?.includes('prompt') && d.code === 'too_big');
    expect(sizeError).toBeUndefined();
  });
});
