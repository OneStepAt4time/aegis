import { describe, it, expect, vi } from 'vitest';
import {
  authKeySchema,
  sendMessageSchema,
  commandSchema,
  bashSchema,
  screenshotSchema,
  permissionHookSchema,
  stopHookSchema,
  batchSessionSchema,
  pipelineSchema,
  UUID_REGEX,
  clamp,
  parseIntSafe,
  isValidUUID,
} from '../validation.js';

describe('authKeySchema', () => {
  it('accepts valid input', () => {
    expect(authKeySchema.safeParse({ name: 'my-key', rateLimit: 100 }).success).toBe(true);
  });
  it('rejects missing name', () => {
    expect(authKeySchema.safeParse({ rateLimit: 100 }).success).toBe(false);
  });
  it('rejects negative rateLimit', () => {
    expect(authKeySchema.safeParse({ name: 'k', rateLimit: -1 }).success).toBe(false);
  });
  it('rejects zero rateLimit', () => {
    expect(authKeySchema.safeParse({ name: 'k', rateLimit: 0 }).success).toBe(false);
  });
  it('accepts without rateLimit', () => {
    expect(authKeySchema.safeParse({ name: 'k' }).success).toBe(true);
  });
  it('rejects extra fields', () => {
    expect(authKeySchema.safeParse({ name: 'k', extra: true }).success).toBe(false);
  });
});

describe('sendMessageSchema', () => {
  it('accepts string text', () => {
    expect(sendMessageSchema.safeParse({ text: 'hello' }).success).toBe(true);
  });
  it('rejects missing text', () => {
    expect(sendMessageSchema.safeParse({}).success).toBe(false);
  });
  it('rejects non-string text', () => {
    expect(sendMessageSchema.safeParse({ text: 123 }).success).toBe(false);
  });
  it('rejects empty string text', () => {
    expect(sendMessageSchema.safeParse({ text: '' }).success).toBe(false);
  });
});

describe('commandSchema', () => {
  it('accepts string command', () => {
    expect(commandSchema.safeParse({ command: '/help' }).success).toBe(true);
  });
  it('rejects missing command', () => {
    expect(commandSchema.safeParse({}).success).toBe(false);
  });
  it('rejects empty string command', () => {
    expect(commandSchema.safeParse({ command: '' }).success).toBe(false);
  });
});

describe('bashSchema', () => {
  it('accepts string command', () => {
    expect(bashSchema.safeParse({ command: 'ls -la' }).success).toBe(true);
  });
  it('rejects missing command', () => {
    expect(bashSchema.safeParse({}).success).toBe(false);
  });
});

describe('screenshotSchema', () => {
  it('accepts url only', () => {
    expect(screenshotSchema.safeParse({ url: 'https://example.com' }).success).toBe(true);
  });
  it('accepts all fields', () => {
    expect(screenshotSchema.safeParse({
      url: 'https://example.com',
      fullPage: true,
      width: 1280,
      height: 720,
    }).success).toBe(true);
  });
  it('rejects missing url', () => {
    expect(screenshotSchema.safeParse({}).success).toBe(false);
  });
  it('rejects negative width', () => {
    expect(screenshotSchema.safeParse({ url: 'https://example.com', width: -1 }).success).toBe(false);
  });
  it('rejects zero height', () => {
    expect(screenshotSchema.safeParse({ url: 'https://example.com', height: 0 }).success).toBe(false);
  });
  it('rejects excessively large dimensions', () => {
    expect(screenshotSchema.safeParse({ url: 'https://example.com', width: 50000 }).success).toBe(false);
  });
});

describe('permissionHookSchema', () => {
  it('accepts valid body', () => {
    expect(permissionHookSchema.safeParse({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      permission_mode: 'default',
    }).success).toBe(true);
  });
  it('accepts empty body', () => {
    expect(permissionHookSchema.safeParse({}).success).toBe(true);
  });
  it('rejects non-string tool_name', () => {
    expect(permissionHookSchema.safeParse({ tool_name: 123 }).success).toBe(false);
  });
});

describe('stopHookSchema', () => {
  it('accepts valid body', () => {
    expect(stopHookSchema.safeParse({ stop_reason: 'end_turn' }).success).toBe(true);
  });
  it('accepts empty body', () => {
    expect(stopHookSchema.safeParse({}).success).toBe(true);
  });
  it('rejects non-string stop_reason', () => {
    expect(stopHookSchema.safeParse({ stop_reason: 42 }).success).toBe(false);
  });
});

describe('batchSessionSchema', () => {
  it('accepts valid batch', () => {
    const result = batchSessionSchema.safeParse({
      sessions: [{ workDir: '/tmp' }],
    });
    expect(result.success).toBe(true);
  });
  it('rejects empty sessions array', () => {
    expect(batchSessionSchema.safeParse({ sessions: [] }).success).toBe(false);
  });
  it('rejects batch exceeding 50', () => {
    const sessions = Array.from({ length: 51 }, () => ({ workDir: '/tmp' }));
    expect(batchSessionSchema.safeParse({ sessions }).success).toBe(false);
  });
  it('accepts batch of exactly 50', () => {
    const sessions = Array.from({ length: 50 }, () => ({ workDir: '/tmp' }));
    expect(batchSessionSchema.safeParse({ sessions }).success).toBe(true);
  });
  it('rejects session without workDir', () => {
    expect(batchSessionSchema.safeParse({ sessions: [{ name: 'x' }] }).success).toBe(false);
  });
});

describe('pipelineSchema', () => {
  it('accepts valid pipeline', () => {
    expect(pipelineSchema.safeParse({
      name: 'my-pipeline',
      workDir: '/tmp',
      stages: [{ name: 'build', prompt: 'npm run build' }],
    }).success).toBe(true);
  });
  it('rejects missing name', () => {
    expect(pipelineSchema.safeParse({
      workDir: '/tmp',
      stages: [{ name: 'build', prompt: 'npm run build' }],
    }).success).toBe(false);
  });
  it('rejects missing workDir', () => {
    expect(pipelineSchema.safeParse({
      name: 'p',
      stages: [{ name: 'build', prompt: 'npm run build' }],
    }).success).toBe(false);
  });
  it('rejects empty stages', () => {
    expect(pipelineSchema.safeParse({
      name: 'p',
      workDir: '/tmp',
      stages: [],
    }).success).toBe(false);
  });
  it('rejects stage without prompt', () => {
    expect(pipelineSchema.safeParse({
      name: 'p',
      workDir: '/tmp',
      stages: [{ name: 'build' }],
    }).success).toBe(false);
  });
});

describe('UUID_REGEX', () => {
  it('matches valid UUID', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('rejects non-UUID', () => {
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
  });
  it('rejects empty string', () => {
    expect(UUID_REGEX.test('')).toBe(false);
  });
  it('rejects path traversal', () => {
    expect(UUID_REGEX.test('../../etc/passwd')).toBe(false);
  });
});

describe('clamp', () => {
  it('returns value within range', () => {
    expect(clamp(50, 1, 100, 80)).toBe(50);
  });
  it('clamps to min', () => {
    expect(clamp(0, 1, 100, 80)).toBe(1);
  });
  it('clamps to max', () => {
    expect(clamp(200, 1, 100, 80)).toBe(100);
  });
  it('returns fallback for NaN', () => {
    expect(clamp(NaN, 1, 100, 80)).toBe(80);
  });
  it('returns fallback for Infinity', () => {
    expect(clamp(Infinity, 1, 100, 80)).toBe(100);
  });
});

describe('parseIntSafe', () => {
  it('parses valid number', () => {
    expect(parseIntSafe('42', 0)).toBe(42);
  });
  it('returns fallback for undefined', () => {
    expect(parseIntSafe(undefined, 99)).toBe(99);
  });
  it('returns fallback for NaN string', () => {
    expect(parseIntSafe('abc', 99)).toBe(99);
  });
  it('returns fallback for Infinity string', () => {
    expect(parseIntSafe('Infinity', 99)).toBe(99);
  });
  it('supports strict integer parsing', () => {
    expect(parseIntSafe('42x', 7, { strict: true })).toBe(7);
    expect(parseIntSafe('42', 7, { strict: true })).toBe(42);
  });
  it('supports inclusive min/max bounds', () => {
    expect(parseIntSafe('70000', 9100, { strict: true, min: 1, max: 65535 })).toBe(9100);
    expect(parseIntSafe('8080', 9100, { strict: true, min: 1, max: 65535 })).toBe(8080);
  });
  it('reports parse failures through onError callback', () => {
    const onError = vi.fn();
    expect(parseIntSafe('abc', 123, { strict: true, context: 'AEGIS_PORT', onError })).toBe(123);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("AEGIS_PORT='abc'");
  });
});

describe('isValidUUID', () => {
  it('returns true for valid UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });
  it('returns false for invalid', () => {
    expect(isValidUUID('abc')).toBe(false);
  });
});
