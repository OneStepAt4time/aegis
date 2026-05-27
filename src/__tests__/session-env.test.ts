import { describe, it, expect } from 'vitest';
import { sanitizeSessionEnv } from '../session-env.js';

describe('sanitizeSessionEnv', () => {
  it('merges defaults with overrides', () => {
    const result = sanitizeSessionEnv({ FOO: '1' }, { BAR: '2' });
    expect(result).toEqual({ FOO: '1', BAR: '2' });
  });

  it('overrides win over defaults', () => {
    const result = sanitizeSessionEnv({ FOO: 'default' }, { FOO: 'override' });
    expect(result).toEqual({ FOO: 'override' });
  });

  it('returns empty for no env', () => {
    const result = sanitizeSessionEnv({}, {});
    expect(result).toEqual({});
  });

  it('returns defaults when no overrides', () => {
    const result = sanitizeSessionEnv({ API_KEY: 'x' }, undefined);
    expect(result).toEqual({ API_KEY: 'x' });
  });

  it('rejects dangerous env var names', () => {
    expect(() => sanitizeSessionEnv({}, { PATH: '/evil' })).toThrow('Forbidden env var');
  });

  it('rejects dangerous prefixes', () => {
    expect(() => sanitizeSessionEnv({}, { LD_PRELOAD: '/evil' })).toThrow('Forbidden env var');
  });

  it('rejects invalid env var names', () => {
    expect(() => sanitizeSessionEnv({}, { 'foo-bar': 'val' })).toThrow('Invalid env var name');
  });

  it('rejects lowercase env var names', () => {
    expect(() => sanitizeSessionEnv({}, { lowercase: 'val' })).toThrow('Invalid env var name');
  });

  it('rejects CR/LF in values', () => {
    expect(() => sanitizeSessionEnv({}, { FOO: 'bar\r\nbaz' })).toThrow('CR/LF');
  });

  it('rejects control characters in values', () => {
    expect(() => sanitizeSessionEnv({}, { FOO: 'bar\x00baz' })).toThrow('control characters');
  });

  it('accepts valid uppercase env var names', () => {
    const result = sanitizeSessionEnv({}, { MY_VAR_123: 'hello' });
    expect(result).toEqual({ MY_VAR_123: 'hello' });
  });

  it('accepts underscore-starting names', () => {
    const result = sanitizeSessionEnv({}, { _MY_VAR: 'val' });
    expect(result).toEqual({ _MY_VAR: 'val' });
  });
});
