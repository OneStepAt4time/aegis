/**
 * webhook-ssrf.test.ts — Tests for SSRF protection in webhook channel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookChannel } from '../channels/webhook.js';
import { webhookEndpointSchema } from '../validation.js';

// ── Zod schema ──────────────────────────────────────────────────────
describe('webhookEndpointSchema', () => {
  it('accepts valid endpoint with url', () => {
    const result = webhookEndpointSchema.safeParse({ url: 'https://example.com/hook' });
    expect(result.success).toBe(true);
  });

  it('accepts endpoint with all fields', () => {
    const result = webhookEndpointSchema.safeParse({
      url: 'https://example.com/hook',
      events: ['session.created'],
      headers: { Authorization: 'Bearer token' },
      timeoutMs: 10000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects endpoint without url', () => {
    const result = webhookEndpointSchema.safeParse({ events: ['session.created'] });
    expect(result.success).toBe(false);
  });

  it('rejects endpoint with non-string url', () => {
    const result = webhookEndpointSchema.safeParse({ url: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects endpoint with empty url', () => {
    const result = webhookEndpointSchema.safeParse({ url: '' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties', () => {
    const result = webhookEndpointSchema.safeParse({
      url: 'https://example.com/hook',
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});

// ── WebhookChannel.fromEnv() SSRF validation ────────────────────────
describe('WebhookChannel.fromEnv() SSRF validation', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.AEGIS_WEBHOOKS;
    delete process.env.MANUS_WEBHOOKS;
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('returns null when AEGIS_WEBHOOKS is not set', () => {
    expect(WebhookChannel.fromEnv()).toBeNull();
  });

  it('returns channel for valid HTTPS webhook URLs', () => {
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 'https://example.com/hook1' },
      { url: 'https://other.example.com/hook2' },
    ]);
    const channel = WebhookChannel.fromEnv();
    expect(channel).not.toBeNull();
  });

  it('returns null and logs error for HTTP to external host', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 'http://evil.com/hook' },
    ]);
    expect(WebhookChannel.fromEnv()).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook URL validation failed'),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('returns null and logs error for private IP URL', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 'https://10.0.0.1/hook' },
    ]);
    expect(WebhookChannel.fromEnv()).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Webhook URL validation failed'),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('returns null and logs error for localhost URL', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 'https://localhost:3000/hook' },
    ]);
    expect(WebhookChannel.fromEnv()).not.toBeNull();
    consoleSpy.mockRestore();
  });

  it('returns null for non-string url field', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 123 },
    ]);
    expect(WebhookChannel.fromEnv()).toBeNull();
    consoleSpy.mockRestore();
  });

  it('returns null for missing url field', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { events: ['session.created'] },
    ]);
    expect(WebhookChannel.fromEnv()).toBeNull();
    consoleSpy.mockRestore();
  });

  it('accepts HTTP to 127.0.0.1 (dev mode)', () => {
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 'http://127.0.0.1:3000/hook' },
    ]);
    const channel = WebhookChannel.fromEnv();
    expect(channel).not.toBeNull();
  });

  it('rejects all endpoints if any is invalid', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.AEGIS_WEBHOOKS = JSON.stringify([
      { url: 'https://example.com/hook' },
      { url: 'http://evil.com/hook' },
    ]);
    expect(WebhookChannel.fromEnv()).toBeNull();
    consoleSpy.mockRestore();
  });

  it('supports legacy MANUS_WEBHOOKS env var', () => {
    process.env.MANUS_WEBHOOKS = JSON.stringify([
      { url: 'https://example.com/hook' },
    ]);
    const channel = WebhookChannel.fromEnv();
    expect(channel).not.toBeNull();
  });
});
