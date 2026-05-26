/**
 * encryption.ts — Session encryption service.
 *
 * Extracted from SessionManager (Issue #4228 Step 2).
 * Handles AES-256-GCM encryption/decryption of hook secrets at rest.
 *
 * Zero behavior changes — pure refactoring.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * SessionEncryptionService — AES-256-GCM encryption for hook secrets.
 *
 * Key is derived once from the master token via scrypt.
 * Ciphertext format: '<iv>:<tag>:<ciphertext>' (all hex-encoded).
 */
export class SessionEncryptionService {
  private encKey: Buffer | null = null;

  /** Derive and store the encryption key from the master token. */
  setEncryptionKey(masterToken: string): void {
    if (!masterToken) return;
    this.encKey = scryptSync(masterToken, 'aegis-hook-key-v1', 32);
  }

  /** Whether an encryption key is available. */
  hasKey(): boolean {
    return this.encKey !== null;
  }

  /** Get the raw encryption key (for callers that need Buffer access). */
  getKey(): Buffer | null {
    return this.encKey;
  }

  /** Encrypt a hook secret with AES-256-GCM. Returns '<iv>:<tag>:<ciphertext>' hex. */
  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey!, iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  /** Decrypt a hook secret from AES-256-GCM '<iv>:<tag>:<ciphertext>' hex. */
  decrypt(encrypted: string): string | undefined {
    if (!this.encKey) return undefined;
    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) return undefined;
      const [ivHex, tagHex, encHex] = parts as [string, string, string];
      const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      return undefined;
    }
  }
}
