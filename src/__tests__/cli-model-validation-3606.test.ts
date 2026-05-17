import { describe, it, expect } from 'vitest';
import { validateModel } from '../validation.js';

describe('validateModel (#3606)', () => {
  it('accepts provider/model format', () => {
    expect(validateModel('anthropic/claude-sonnet-4')).toBe('anthropic/claude-sonnet-4');
    expect(validateModel('openai/gpt-4o')).toBe('openai/gpt-4o');
    expect(validateModel('google/gemini-2.5-pro')).toBe('google/gemini-2.5-pro');
  });

  it('accepts plain model names', () => {
    expect(validateModel('claude-sonnet-4')).toBe('claude-sonnet-4');
    expect(validateModel('gpt-4o')).toBe('gpt-4o');
    expect(validateModel('Model.v2.1')).toBe('Model.v2.1');
  });

  it('accepts dashes, dots, slashes', () => {
    expect(validateModel('zai/glm-5.1')).toBe('zai/glm-5.1');
    expect(validateModel('provider/sub/model-v2')).toBe('provider/sub/model-v2');
  });

  it('rejects empty string', () => {
    expect(validateModel('')).toBeNull();
  });

  it('rejects strings starting with special chars', () => {
    expect(validateModel('-model')).toBeNull();
    expect(validateModel('.model')).toBeNull();
    expect(validateModel('/model')).toBeNull();
  });

  it('rejects strings with spaces', () => {
    expect(validateModel('my model')).toBeNull();
  });

  it('rejects strings with shell metacharacters', () => {
    expect(validateModel('model;rm -rf')).toBeNull();
    expect(validateModel('model$(whoami)')).toBeNull();
    expect(validateModel('model`cmd`')).toBeNull();
    expect(validateModel('model|pipe')).toBeNull();
    expect(validateModel('model&bg')).toBeNull();
  });

  it('rejects strings exceeding 200 chars', () => {
    const long = 'a'.repeat(201);
    expect(validateModel(long)).toBeNull();
  });

  it('accepts exactly 200 chars', () => {
    const max = 'a'.repeat(200);
    expect(validateModel(max)).toBe(max);
  });

  it('rejects unicode/special chars', () => {
    expect(validateModel('modeloñ')).toBeNull();
    expect(validateModel('模型')).toBeNull();
  });
});
