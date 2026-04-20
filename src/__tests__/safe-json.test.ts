import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { safeJsonParse, safeJsonParseSchema } from '../safe-json.js';

describe('safeJsonParse', () => {
  it('returns parsed data for valid JSON', () => {
    const result = safeJsonParse('{"key":"value"}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ key: 'value' });
  });

  it('parses arrays', () => {
    const result = safeJsonParse('[1, 2, 3]');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual([1, 2, 3]);
  });

  it('parses primitives', () => {
    expect(safeJsonParse('42')).toEqual({ ok: true, data: 42 });
    expect(safeJsonParse('"hello"')).toEqual({ ok: true, data: 'hello' });
    expect(safeJsonParse('true')).toEqual({ ok: true, data: true });
    expect(safeJsonParse('null')).toEqual({ ok: true, data: null });
  });

  it('returns error for invalid JSON', () => {
    const result = safeJsonParse('{key:}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('is not valid JSON');
  });

  it('includes context in error message', () => {
    const result = safeJsonParse('{bad}', 'my payload');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('my payload');
  });
});

describe('safeJsonParseSchema', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('returns validated data for valid JSON matching schema', () => {
    const result = safeJsonParseSchema('{"name":"Alice","age":30}', schema);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns error for invalid JSON', () => {
    const result = safeJsonParseSchema('bad', schema);
    expect(result.ok).toBe(false);
  });

  it('returns error for JSON that does not match schema', () => {
    const result = safeJsonParseSchema('{"name":"Bob"}', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid structure');
  });

  it('returns error for field with wrong type', () => {
    const result = safeJsonParseSchema('{"name":"Carol","age":"thirty"}', schema);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid structure');
  });

  it('includes context in schema validation error', () => {
    const result = safeJsonParseSchema('{"wrong":true}', schema, 'user input');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('user input');
  });
});
