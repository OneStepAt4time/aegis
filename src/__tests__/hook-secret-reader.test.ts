import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readHookSecretFromSettingsFile } from '../services/session/hook-secret-reader.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURE_DIR = join(tmpdir(), 'hook-secret-reader-test');

describe('readHookSecretFromSettingsFile', () => {
  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it('extracts X-Hook-Secret from valid settings file', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          hooks: [{ type: 'http', headers: { 'X-Hook-Secret': 'abc123' } }]
        }]
      }
    };
    const path = join(FIXTURE_DIR, 'valid.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBe('abc123');
  });

  it('returns undefined for file with no hooks', async () => {
    const path = join(FIXTURE_DIR, 'no-hooks.json');
    writeFileSync(path, JSON.stringify({ hooks: {} }));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined for file with empty hooks array', async () => {
    const path = join(FIXTURE_DIR, 'empty-hooks.json');
    writeFileSync(path, JSON.stringify({ hooks: { PreToolUse: [] } }));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when headers object has no X-Hook-Secret', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          hooks: [{ type: 'http', headers: { 'Authorization': 'Bearer x' } }]
        }]
      }
    };
    const path = join(FIXTURE_DIR, 'no-secret.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-existent file', async () => {
    const result = await readHookSecretFromSettingsFile('/nonexistent/path.json');
    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid JSON', async () => {
    const path = join(FIXTURE_DIR, 'invalid.json');
    writeFileSync(path, 'not json at all');
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when top-level value is not an object', async () => {
    const path = join(FIXTURE_DIR, 'array.json');
    writeFileSync(path, JSON.stringify([1, 2, 3]));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when hooks value is not an object', async () => {
    const path = join(FIXTURE_DIR, 'hooks-string.json');
    writeFileSync(path, JSON.stringify({ hooks: 'bad' }));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when event entry is not an object', async () => {
    const settings = { hooks: { PreToolUse: ['not-an-object'] } };
    const path = join(FIXTURE_DIR, 'bad-entry.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when hook is not an object', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{ hooks: ['not-an-object'] }]
      }
    };
    const path = join(FIXTURE_DIR, 'bad-hook.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when X-Hook-Secret is empty string', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          hooks: [{ type: 'http', headers: { 'X-Hook-Secret': '' } }]
        }]
      }
    };
    const path = join(FIXTURE_DIR, 'empty-secret.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('returns undefined when headers is not an object', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          hooks: [{ type: 'http', headers: 'not-an-object' }]
        }]
      }
    };
    const path = join(FIXTURE_DIR, 'bad-headers.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBeUndefined();
  });

  it('finds secret in second hook event', async () => {
    const settings = {
      hooks: {
        PreToolUse: [{
          hooks: [{ type: 'http', headers: { 'Other': 'val' } }]
        }],
        PostToolUse: [{
          hooks: [{ type: 'http', headers: { 'X-Hook-Secret': 'found-it' } }]
        }]
      }
    };
    const path = join(FIXTURE_DIR, 'second-event.json');
    writeFileSync(path, JSON.stringify(settings));
    const result = await readHookSecretFromSettingsFile(path);
    expect(result).toBe('found-it');
  });
});
