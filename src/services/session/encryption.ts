import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

/** AES-256-GCM encryption/decryption for hook secrets stored at rest. */
export class SessionEncryptionService {
  private encKey: Buffer | null = null;

  get hasKey(): boolean {
    return this.encKey !== null;
  }

  setKey(masterToken: string): void {
    if (!masterToken) return;
    this.encKey = scryptSync(masterToken, 'aegis-hook-key-v1', 32);
  }

  /** Returns '<iv>:<tag>:<ciphertext>' hex. Caller must check hasKey first. */
  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey!, iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  /** Decrypts '<iv>:<tag>:<ciphertext>' hex. Returns undefined on any failure. */
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

export default SessionEncryptionService;
