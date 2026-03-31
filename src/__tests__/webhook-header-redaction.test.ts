import { describe, it, expect } from 'vitest';
import { redactHeaders, redactSecretsFromText } from '../utils/redact-headers.js';

describe('redactHeaders', () => {
  it('redacts Authorization header', () => {
    const result = redactHeaders({ Authorization: 'Bearer super-secret-token' });
    expect(result.Authorization).toBe('Bear...[REDACTED]');
  });

  it('redacts case-insensitively', () => {
    const result = redactHeaders({ authorization: 'Bearer tok' });
    expect(result.authorization).toBe('Bear...[REDACTED]');
  });

  it('redacts Cookie header', () => {
    const result = redactHeaders({ Cookie: 'session=abc123def456' });
    expect(result.Cookie).toBe('sess...[REDACTED]');
  });

  it('redacts X-Api-Key header', () => {
    const result = redactHeaders({ 'X-Api-Key': 'sk-live-12345678' });
    expect(result['X-Api-Key']).toBe('sk-l...[REDACTED]');
  });

  it('redacts api-key header (case-insensitive)', () => {
    const result = redactHeaders({ 'Api-Key': 'my-api-key-value-here' });
    expect(result['Api-Key']).toBe('my-a...[REDACTED]');
  });

  it('passes through non-sensitive headers unchanged', () => {
    const result = redactHeaders({
      'Content-Type': 'application/json',
      'X-Request-Id': 'req-123',
      Accept: 'application/json',
    });
    expect(result).toEqual({
      'Content-Type': 'application/json',
      'X-Request-Id': 'req-123',
      Accept: 'application/json',
    });
  });

  it('redacts short values (<=8 chars) completely', () => {
    const result = redactHeaders({ Authorization: 'short' });
    expect(result.Authorization).toBe('[REDACTED]');
  });

  it('handles empty headers object', () => {
    expect(redactHeaders({})).toEqual({});
  });

  it('redacts all sensitive headers in a mixed set', () => {
    const result = redactHeaders({
      'Content-Type': 'application/json',
      Authorization: 'Bearer my-secret-token',
      'X-Custom': 'fine',
      Cookie: 'sid=abcdefghijklmnop',
      'X-Api-Key': 'sk-1234567890',
    });
    expect(result['Content-Type']).toBe('application/json');
    expect(result['X-Custom']).toBe('fine');
    expect(result.Authorization).toContain('[REDACTED]');
    expect(result.Cookie).toContain('[REDACTED]');
    expect(result['X-Api-Key']).toContain('[REDACTED]');
  });
});

describe('redactSecretsFromText', () => {
  it('removes a bearer token from error text', () => {
    const text = 'fetch failed: ECONNREFUSED with header Bearer my-secret-token-xyz';
    const result = redactSecretsFromText(text, { Authorization: 'Bearer my-secret-token-xyz' });
    expect(result).not.toContain('my-secret-token-xyz');
    expect(result).toContain('[REDACTED]');
  });

  it('removes api key value from error text', () => {
    const text = 'Request failed for key=sk-live-abcdef123456';
    const result = redactSecretsFromText(text, { 'X-Api-Key': 'sk-live-abcdef123456' });
    expect(result).toBe('Request failed for key=[REDACTED]');
  });

  it('returns text unchanged when headers is undefined', () => {
    const text = 'some error message';
    expect(redactSecretsFromText(text, undefined)).toBe(text);
  });

  it('returns text unchanged when headers has no sensitive entries', () => {
    const text = 'error with Content-Type application/json';
    expect(redactSecretsFromText(text, { 'Content-Type': 'application/json' })).toBe(text);
  });

  it('handles multiple occurrences of the same secret', () => {
    const text = 'token abc123def456 appeared twice: abc123def456 and abc123def456';
    const result = redactSecretsFromText(text, { Authorization: 'abc123def456' });
    expect(result).toBe('token [REDACTED] appeared twice: [REDACTED] and [REDACTED]');
  });

  it('redacts multiple different secrets', () => {
    const text = 'auth=Bearer tok123secret and key=sk-abc123key';
    const result = redactSecretsFromText(text, {
      Authorization: 'Bearer tok123secret',
      'X-Api-Key': 'sk-abc123key',
    });
    expect(result).not.toContain('tok123secret');
    expect(result).not.toContain('sk-abc123key');
  });

  it('skips very short values to avoid false positives', () => {
    const text = 'error abc in log abc';
    const result = redactSecretsFromText(text, { Authorization: 'abc' });
    expect(result).toBe('error abc in log abc');
  });
});
