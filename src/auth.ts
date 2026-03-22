/**
 * auth.ts — API key management and authentication middleware.
 *
 * Issue #39: Multi-key auth with rate limiting.
 * Keys are hashed with SHA-256 (no bcrypt dependency needed).
 * Backward compatible with single authToken from config.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ApiKey {
  id: string;
  name: string;
  hash: string;          // SHA-256 hash of the key
  createdAt: number;
  lastUsedAt: number;
  rateLimit: number;     // requests per minute
}

export interface ApiKeyStore {
  keys: ApiKey[];
}

/** Rate limit state per key ID. */
interface RateLimitBucket {
  count: number;
  windowStart: number;
}

export class AuthManager {
  private store: ApiKeyStore = { keys: [] };
  private rateLimits = new Map<string, RateLimitBucket>();
  private masterToken: string;

  constructor(
    private keysFile: string,
    masterToken: string = '',
  ) {
    this.masterToken = masterToken;
  }

  /** Load keys from disk. */
  async load(): Promise<void> {
    if (existsSync(this.keysFile)) {
      try {
        this.store = JSON.parse(await readFile(this.keysFile, 'utf-8'));
      } catch {
        this.store = { keys: [] };
      }
    }
  }

  /** Save keys to disk. */
  async save(): Promise<void> {
    const dir = dirname(this.keysFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.keysFile, JSON.stringify(this.store, null, 2));
  }

  /** Create a new API key. Returns the plaintext key (only shown once). */
  async createKey(name: string, rateLimit = 100): Promise<{ id: string; key: string; name: string }> {
    const id = randomBytes(8).toString('hex');
    const key = `aegis_${randomBytes(32).toString('hex')}`;
    const hash = AuthManager.hashKey(key);

    const apiKey: ApiKey = {
      id,
      name,
      hash,
      createdAt: Date.now(),
      lastUsedAt: 0,
      rateLimit,
    };

    this.store.keys.push(apiKey);
    await this.save();

    return { id, key, name };
  }

  /** List keys (without hashes). */
  listKeys(): Array<Omit<ApiKey, 'hash'>> {
    return this.store.keys.map(({ hash: _, ...rest }) => rest);
  }

  /** Revoke a key by ID. */
  async revokeKey(id: string): Promise<boolean> {
    const idx = this.store.keys.findIndex(k => k.id === id);
    if (idx === -1) return false;
    this.store.keys.splice(idx, 1);
    this.rateLimits.delete(id);
    await this.save();
    return true;
  }

  /**
   * Validate a bearer token.
   * Returns { valid, keyId, rateLimited } or null if no auth configured.
   */
  validate(token: string): { valid: boolean; keyId: string | null; rateLimited: boolean } {
    // No auth configured and no keys → allow all
    if (!this.masterToken && this.store.keys.length === 0) {
      return { valid: true, keyId: null, rateLimited: false };
    }

    // Check master token (backward compat)
    if (this.masterToken && token === this.masterToken) {
      return { valid: true, keyId: 'master', rateLimited: false };
    }

    // Check API keys
    const hash = AuthManager.hashKey(token);
    const key = this.store.keys.find(k => k.hash === hash);
    if (!key) {
      return { valid: false, keyId: null, rateLimited: false };
    }

    // Update last used
    key.lastUsedAt = Date.now();

    // Rate limiting
    const bucket = this.rateLimits.get(key.id) || { count: 0, windowStart: Date.now() };
    const now = Date.now();
    const windowMs = 60_000; // 1 minute

    if (now - bucket.windowStart > windowMs) {
      // New window
      bucket.count = 1;
      bucket.windowStart = now;
    } else {
      bucket.count++;
    }

    this.rateLimits.set(key.id, bucket);

    if (bucket.count > key.rateLimit) {
      return { valid: true, keyId: key.id, rateLimited: true };
    }

    return { valid: true, keyId: key.id, rateLimited: false };
  }

  /** Hash a key with SHA-256. */
  static hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /** Check if auth is enabled (master token or any keys). */
  get authEnabled(): boolean {
    return !!this.masterToken || this.store.keys.length > 0;
  }
}
