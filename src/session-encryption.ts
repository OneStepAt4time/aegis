/**
 * session-encryption.ts — Encryption utilities for session secrets.
 *
 * Extracted from session.ts (#4228): AES-256-GCM encryption/decryption
 * for hook secrets, keyed via scrypt from the master token.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

export interface SessionEncryption {
  readonly encKey: Buffer | null;
  setEncryptionKey(masterToken: string): void;
  encryptSecret(secret: string): string;
  decryptSecret(encrypted: string): string | undefined;
}

export class SessionEncryptionImpl implements SessionEncryption {
  private _encKey: Buffer | null = null;

  get encKey(): Buffer | null {
    return this._encKey;
  }

  setEncryptionKey(masterToken: string): void {
    if (!masterToken) return;
    // scryptSync is synchronous — called once at startup, acceptable cost.
    this._encKey = scryptSync(masterToken, 'aegis-hook-key-v1', 32);
  }

  /** Encrypt a hook secret with AES-256-GCM. Returns '<iv>:<tag>:<ciphertext>' hex. */
  encryptSecret(secret: string): string {
    if (!this._encKey) throw new Error('Encryption key not set');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this._encKey, iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  /** Decrypt a hook secret from AES-256-GCM '<iv>:<tag>:<ciphertext>' hex. */
  decryptSecret(encrypted: string): string | undefined {
    if (!this._encKey) return undefined;
    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) return undefined;
      const [ivHex, tagHex, encHex] = parts as [string, string, string];
      const decipher = createDecipheriv('aes-256-gcm', this._encKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      return undefined;
    }
  }
}
