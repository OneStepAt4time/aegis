/**
 * Issue #3712 — session.ts encryption/decryption paths
 *
 * Covers:
 * 1. encryptSecret / decryptSecret round-trip (AES-256-GCM)
 * 2. decryptSecret with corrupted data → undefined
 * 3. restoreSessionHookSecrets with missing/corrupted settings file
 * 4. readHookSecretFromSettingsFile error handling (malformed JSON, missing file)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../types.js';

// SessionManager has private encrypt/decrypt — access via (sm as any)
function enc(sm: SessionManager) { return (sm as any).encryptSecret.bind(sm) as (s: string) => string; }
function dec(sm: SessionManager) { return (sm as any).decryptSecret.bind(sm) as (s: string) => string | undefined; }

function createTestSM(stateDir: string): SessionManager {
  return new SessionManager({
    stateDir,
    masterToken: 'test-master-token-for-enc',
  });
}

describe('Issue #3712 — session.ts encryption/decryption', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-enc-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('encryptSecret / decryptSecret round-trip', () => {
    it('round-trips a plaintext secret through encrypt → decrypt', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const plaintext = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const encrypted = enc(sm)(plaintext);

      // Encrypted format: <iv>:<tag>:<ciphertext> (all hex)
      expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

      const decrypted = dec(sm)(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertext for the same input (random IV)', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const plaintext = 'same-input-secret';
      const a = enc(sm)(plaintext);
      const b = enc(sm)(plaintext);

      // Random IV means different ciphertext each time
      expect(a).not.toBe(b);

      // But both decrypt to the same value
      expect(dec(sm)(a)).toBe(plaintext);
      expect(dec(sm)(b)).toBe(plaintext);
    });

    it('returns undefined when no encryption key is set', () => {
      const sm = createTestSM(tmpDir);
      // Don't call setEncryptionKey — encKey stays null

      // encryptSecret should still work (it uses encKey! — but only called when encKey is set)
      // decryptSecret should return undefined when encKey is null
      expect(dec(sm)('some:encrypted:value')).toBeUndefined();
    });

    it('round-trips an empty string', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const encrypted = enc(sm)('');
      expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]*$/);

      const decrypted = dec(sm)(encrypted);
      expect(decrypted).toBe('');
    });
  });

  describe('decryptSecret with corrupted data', () => {
    it('returns undefined for malformed format (no colons)', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      expect(dec(sm)('justhexnodecolons')).toBeUndefined();
    });

    it('returns undefined for malformed format (too many colons)', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      expect(dec(sm)('a:b:c:d')).toBeUndefined();
    });

    it('returns undefined for invalid hex characters', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      expect(dec(sm)('ZZZZ:AAAA:BBBB')).toBeUndefined();
    });

    it('returns undefined for valid format but wrong key', () => {
      const sm1 = createTestSM(tmpDir);
      sm1.setEncryptionKey('key-one');
      const encrypted = enc(sm1)('secret-data');

      const sm2 = createTestSM(tmpDir);
      sm2.setEncryptionKey('key-two');

      expect(dec(sm2)(encrypted)).toBeUndefined();
    });

    it('returns undefined for truncated ciphertext', () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const encrypted = enc(sm)('some-secret');
      const parts = encrypted.split(':');
      // Truncate the ciphertext portion
      const truncated = `${parts[0]}:${parts[1]}:${parts[2].slice(0, 4)}`;

      expect(dec(sm)(truncated)).toBeUndefined();
    });
  });

  describe('restoreSessionHookSecrets', () => {
    it('decrypts stored hook secrets with colon format (AES-GCM ciphertext)', async () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const plaintext = 'decrypted-hook-secret-123456';
      const encrypted = enc(sm)(plaintext);

      // Inject a session with encrypted hookSecret directly into state
      const state = (sm as any).state as { sessions: Record<string, SessionInfo> };
      state.sessions['test-sess-1'] = {
        id: 'test-sess-1',
        displayName: 'test',
        status: 'idle',
        hookSecret: encrypted,
        createdAt: new Date().toISOString(),
      } as SessionInfo;

      await (sm as any).restoreSessionHookSecrets();

      expect(state.sessions['test-sess-1'].hookSecret).toBe(plaintext);
    });

    it('sets hookSecret to undefined when decryption fails', async () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      // A colon-containing value that is NOT valid AES-GCM
      const state = (sm as any).state as { sessions: Record<string, SessionInfo> };
      state.sessions['test-sess-2'] = {
        id: 'test-sess-2',
        displayName: 'test',
        status: 'idle',
        hookSecret: 'not-valid-hex:not-valid-hex:not-valid-hex',
        createdAt: new Date().toISOString(),
      } as SessionInfo;

      await (sm as any).restoreSessionHookSecrets();

      // Decryption fails → set to undefined → falls through to readHookSecretFromSettingsFile
      // Since no hookSettingsFile is set, it stays undefined
      expect(state.sessions['test-sess-2'].hookSecret).toBeUndefined();
    });

    it('skips plaintext hook secrets (no colons)', async () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const plaintext = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const state = (sm as any).state as { sessions: Record<string, SessionInfo> };
      state.sessions['test-sess-3'] = {
        id: 'test-sess-3',
        displayName: 'test',
        status: 'idle',
        hookSecret: plaintext,
        createdAt: new Date().toISOString(),
      } as SessionInfo;

      await (sm as any).restoreSessionHookSecrets();

      // Plaintext 64-char hex (no colons) should be left as-is
      expect(state.sessions['test-sess-3'].hookSecret).toBe(plaintext);
    });
  });

  describe('readHookSecretFromSettingsFile', () => {
    it('returns secret from valid hook settings file', async () => {
      const sm = createTestSM(tmpDir);
      sm.setEncryptionKey('test-master-token-for-enc');

      const settingsPath = join(tmpDir, 'hook-settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              headers: { 'X-Hook-Secret': 'hook-secret-from-file' },
            }],
          }],
        },
      }));

      const result = await (sm as any).readHookSecretFromSettingsFile(settingsPath);
      expect(result).toBe('hook-secret-from-file');
    });

    it('returns undefined for missing file', async () => {
      const sm = createTestSM(tmpDir);

      const result = await (sm as any).readHookSecretFromSettingsFile('/nonexistent/path.json');
      expect(result).toBeUndefined();
    });

    it('returns undefined for malformed JSON', async () => {
      const sm = createTestSM(tmpDir);

      const settingsPath = join(tmpDir, 'bad.json');
      writeFileSync(settingsPath, '{ not valid json }}}');

      const result = await (sm as any).readHookSecretFromSettingsFile(settingsPath);
      expect(result).toBeUndefined();
    });

    it('returns undefined for JSON without hooks field', async () => {
      const sm = createTestSM(tmpDir);

      const settingsPath = join(tmpDir, 'no-hooks.json');
      writeFileSync(settingsPath, JSON.stringify({ other: 'data' }));

      const result = await (sm as any).readHookSecretFromSettingsFile(settingsPath);
      expect(result).toBeUndefined();
    });

    it('returns undefined when hooks have no X-Hook-Secret header', async () => {
      const sm = createTestSM(tmpDir);

      const settingsPath = join(tmpDir, 'no-secret.json');
      writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              headers: { 'Other-Header': 'value' },
            }],
          }],
        },
      }));

      const result = await (sm as any).readHookSecretFromSettingsFile(settingsPath);
      expect(result).toBeUndefined();
    });

    it('returns first secret from multiple hook entries', async () => {
      const sm = createTestSM(tmpDir);

      const settingsPath = join(tmpDir, 'multi.json');
      writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          PreToolUse: [{
            hooks: [{
              headers: { 'X-Hook-Secret': '' },  // empty — skipped
            }],
          }],
          PostToolUse: [{
            hooks: [{
              headers: { 'X-Hook-Secret': 'second-secret' },
            }],
          }],
        },
      }));

      const result = await (sm as any).readHookSecretFromSettingsFile(settingsPath);
      expect(result).toBe('second-secret');
    });
  });
});
