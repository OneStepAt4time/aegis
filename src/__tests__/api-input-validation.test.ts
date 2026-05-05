/**
 * api-input-validation.test.ts — Malformed input test suite (Issue #506).
 *
 * Tests that Zod schemas reject malformed data at external boundaries:
 * 1. API request body schemas return 400 for malformed JSON
 * 2. File-parsing schemas reject corrupted data
 * 3. WebSocket inbound message schema rejects invalid messages
 * 4. No endpoint returns 200 with null/undefined for invalid inputs
 */

import { describe, it, expect } from 'vitest';
import {
  authStoreSchema,
  sessionsIndexSchema,
  metricsFileSchema,
  wsInboundMessageSchema,
  ccSettingsSchema,
  getErrorMessage,
  authKeySchema,
  sendMessageSchema,
  commandSchema,
  bashSchema,
  screenshotSchema,
  batchSessionSchema,
  pipelineSchema,
  handshakeRequestSchema,
  permissionHookSchema,
  stopHookSchema,
} from '../validation.js';

// ── New boundary schemas (Issue #506) ─────────────────────────────

describe('authStoreSchema', () => {
  it('accepts valid store', () => {
    const result = authStoreSchema.safeParse({
      keys: [{
        id: 'abc',
        name: 'test',
        hash: 'deadbeef',
        createdAt: Date.now(),
        lastUsedAt: 0,
        rateLimit: 100,
      }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty store', () => {
    const result = authStoreSchema.safeParse({ keys: [] });
    expect(result.success).toBe(true);
  });

  it('rejects missing keys array', () => {
    const result = authStoreSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects key missing required fields', () => {
    const result = authStoreSchema.safeParse({ keys: [{ id: 'abc' }] });
    expect(result.success).toBe(false);
  });

  it('rejects wrong types', () => {
    const result = authStoreSchema.safeParse({
      keys: [{ id: 123, name: true, hash: [], createdAt: 'now', lastUsedAt: null, rateLimit: 'high' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(authStoreSchema.safeParse('not-json').success).toBe(false);
    expect(authStoreSchema.safeParse(42).success).toBe(false);
    expect(authStoreSchema.safeParse(null).success).toBe(false);
    expect(authStoreSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('sessionsIndexSchema', () => {
  it('accepts valid index with entries', () => {
    const result = sessionsIndexSchema.safeParse({
      entries: [
        { sessionId: 'abc', fullPath: '/tmp/test.jsonl' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts index without entries', () => {
    const result = sessionsIndexSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects entries with wrong types', () => {
    const result = sessionsIndexSchema.safeParse({
      entries: [{ sessionId: 123, fullPath: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects entries with missing required fields', () => {
    const result = sessionsIndexSchema.safeParse({
      entries: [{ sessionId: 'abc' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('metricsFileSchema', () => {
  it('accepts valid metrics', () => {
    const result = metricsFileSchema.safeParse({
      global: { sessionsCreated: 10, totalMessages: 100 },
      savedAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = metricsFileSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial global metrics', () => {
    const result = metricsFileSchema.safeParse({ global: {} });
    expect(result.success).toBe(true);
  });

  it('rejects wrong types for metric values', () => {
    const result = metricsFileSchema.safeParse({
      global: { sessionsCreated: 'ten' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-object', () => {
    expect(metricsFileSchema.safeParse('bad').success).toBe(false);
    expect(metricsFileSchema.safeParse(42).success).toBe(false);
  });
});

describe('wsInboundMessageSchema', () => {
  it('accepts valid input message', () => {
    const result = wsInboundMessageSchema.safeParse({ type: 'input', text: 'hello' });
    expect(result.success).toBe(true);
  });

  it('accepts valid resize message', () => {
    const result = wsInboundMessageSchema.safeParse({ type: 'resize', cols: 80, rows: 24 });
    expect(result.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const result = wsInboundMessageSchema.safeParse({ type: 'unknown', data: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects missing type', () => {
    const result = wsInboundMessageSchema.safeParse({ text: 'hello' });
    expect(result.success).toBe(false);
  });

  it('rejects input with non-string text', () => {
    const result = wsInboundMessageSchema.safeParse({ type: 'input', text: 123 });
    expect(result.success).toBe(false);
  });

  it('rejects resize with non-number cols', () => {
    const result = wsInboundMessageSchema.safeParse({ type: 'resize', cols: '80', rows: 24 });
    expect(result.success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    const result = wsInboundMessageSchema.safeParse({ type: 'input', text: 'hi', extra: true });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    const result = wsInboundMessageSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('ccSettingsSchema', () => {
  it('accepts settings with permissions', () => {
    const result = ccSettingsSchema.safeParse({
      permissions: { defaultMode: 'bypassPermissions' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty settings object', () => {
    const result = ccSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts settings with extra fields (passthrough)', () => {
    const result = ccSettingsSchema.safeParse({
      permissions: { defaultMode: 'default', allowedTools: ['Read'] },
      env: { API_KEY: 'test' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-object', () => {
    expect(ccSettingsSchema.safeParse('bad').success).toBe(false);
    expect(ccSettingsSchema.safeParse(42).success).toBe(false);
    expect(ccSettingsSchema.safeParse(null).success).toBe(false);
  });
});

// ── getErrorMessage helper ─────────────────────────────────────────

describe('getErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(getErrorMessage(new Error('test error'))).toBe('test error');
  });

  it('returns string as-is', () => {
    expect(getErrorMessage('raw string')).toBe('raw string');
  });

  it('converts unknown to string', () => {
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

// ── Existing API schemas — malformed input regression tests ─────────

describe('API schema malformed input regression (Issue #506)', () => {
  describe('sendMessageSchema', () => {
    it('rejects null body', () => {
      expect(sendMessageSchema.safeParse(null).success).toBe(false);
    });

    it('rejects number body', () => {
      expect(sendMessageSchema.safeParse(42).success).toBe(false);
    });

    it('rejects string body', () => {
      expect(sendMessageSchema.safeParse('hello').success).toBe(false);
    });
  });

  describe('commandSchema', () => {
    it('rejects array body', () => {
      expect(commandSchema.safeParse([]).success).toBe(false);
    });

    it('rejects null body', () => {
      expect(commandSchema.safeParse(null).success).toBe(false);
    });
  });

  describe('bashSchema', () => {
    it('rejects empty command', () => {
      expect(bashSchema.safeParse({ command: '' }).success).toBe(false);
    });

    it('rejects object without command', () => {
      expect(bashSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('screenshotSchema', () => {
    it('rejects missing url', () => {
      expect(screenshotSchema.safeParse({}).success).toBe(false);
    });

    it('rejects empty url', () => {
      expect(screenshotSchema.safeParse({ url: '' }).success).toBe(false);
    });

    it('rejects negative dimensions', () => {
      expect(screenshotSchema.safeParse({ url: 'https://x.com', width: -1 }).success).toBe(false);
    });

    it('rejects oversized dimensions', () => {
      expect(screenshotSchema.safeParse({ url: 'https://x.com', width: 8000 }).success).toBe(false);
    });
  });

  describe('batchSessionSchema', () => {
    it('rejects empty sessions array', () => {
      expect(batchSessionSchema.safeParse({ sessions: [] }).success).toBe(false);
    });

    it('rejects sessions exceeding max', () => {
      const sessions = Array.from({ length: 51 }, (_, i) => ({ workDir: `/tmp/${i}` }));
      expect(batchSessionSchema.safeParse({ sessions }).success).toBe(false);
    });

    it('rejects session without workDir', () => {
      expect(batchSessionSchema.safeParse({ sessions: [{ name: 'test' }] }).success).toBe(false);
    });
  });

  describe('pipelineSchema', () => {
    it('rejects empty stages', () => {
      expect(pipelineSchema.safeParse({ name: 'p', workDir: '/tmp', stages: [] }).success).toBe(false);
    });

    it('rejects missing name', () => {
      expect(pipelineSchema.safeParse({ workDir: '/tmp', stages: [{ name: 's', prompt: 'p' }] }).success).toBe(false);
    });

    it('rejects missing workDir', () => {
      expect(pipelineSchema.safeParse({ name: 'p', stages: [{ name: 's', prompt: 'p' }] }).success).toBe(false);
    });
  });

  describe('handshakeRequestSchema', () => {
    it('accepts minimal valid handshake request', () => {
      const result = handshakeRequestSchema.safeParse({ protocolVersion: '1' });
      expect(result.success).toBe(true);
    });

    it('rejects missing protocolVersion', () => {
      const result = handshakeRequestSchema.safeParse({ clientCapabilities: ['session.create'] });
      expect(result.success).toBe(false);
    });

    it('rejects non-array clientCapabilities', () => {
      const result = handshakeRequestSchema.safeParse({ protocolVersion: '1', clientCapabilities: 'session.create' });
      expect(result.success).toBe(false);
    });

    it('rejects unknown extra fields (strict)', () => {
      const result = handshakeRequestSchema.safeParse({ protocolVersion: '1', unknown: true });
      expect(result.success).toBe(false);
    });
  });

  describe('permissionHookSchema', () => {
    it('rejects extra fields', () => {
      expect(permissionHookSchema.safeParse({ session_id: 'abc', extra: true }).success).toBe(false);
    });

    it('accepts all optional fields', () => {
      expect(permissionHookSchema.safeParse({
        session_id: 'abc',
        tool_name: 'Read',
        tool_input: {},
        permission_mode: 'default',
        hook_event_name: 'PermissionRequest',
      }).success).toBe(true);
    });
  });

  describe('stopHookSchema', () => {
    it('rejects extra fields', () => {
      expect(stopHookSchema.safeParse({ session_id: 'abc', extra: true }).success).toBe(false);
    });
  });

  describe('authKeySchema', () => {
    it('rejects empty name', () => {
      expect(authKeySchema.safeParse({ name: '' }).success).toBe(false);
    });

    it('rejects non-string name', () => {
      expect(authKeySchema.safeParse({ name: 123 }).success).toBe(false);
    });

    it('rejects zero rateLimit', () => {
      expect(authKeySchema.safeParse({ name: 'k', rateLimit: 0 }).success).toBe(false);
    });
  });
});
