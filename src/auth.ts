/**
 * auth.ts — API key management and authentication middleware.
 *
 * Issue #39: Multi-key auth with rate limiting.
 * Keys are hashed with SHA-256 (no bcrypt dependency needed).
 * Backward compatible with single authToken from config.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { authStoreSchema } from './validation.js';
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

/** Short-lived SSE token for Issue #297. */
interface SSETokenEntry {
  token: string;
  expiresAt: number;
  used: boolean;
  keyId: string;
}

/** Default SSE token lifetime: 60 seconds. */
const SSE_TOKEN_TTL_MS = 60_000;

/** Max SSE tokens per bearer token to prevent abuse. */
const SSE_TOKEN_MAX_PER_KEY = 5;

export class AuthManager {
  private store: ApiKeyStore = { keys: [] };
  private rateLimits = new Map<string, RateLimitBucket>();
  private masterToken: string;
  /** #297: Short-lived SSE tokens. Keyed by token string for O(1) lookup. */
  private sseTokens = new Map<string, SSETokenEntry>();
  /** Track how many SSE tokens each bearer key has outstanding. */
  private sseTokenCounts = new Map<string, number>();
  /** #414: Mutex to prevent concurrent SSE token generation from exceeding per-key limits. */
  private sseMutex: Promise<void> = Promise.resolve();

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
        const raw = await readFile(this.keysFile, 'utf-8');
        const parsed = authStoreSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          this.store = parsed.data;
        }
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

    // Check master token (backward compat) — timing-safe comparison (#402)
    if (this.masterToken && token.length === this.masterToken.length
      && timingSafeEqual(Buffer.from(token), Buffer.from(this.masterToken))) {
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

  // ── SSE Token Management (Issue #297) ────────────────────────

  /**
   * Generate a short-lived, single-use SSE token.
   * The caller must already be authenticated (validated via bearer token).
   * Returns the token string and its expiry timestamp.
   * #414: Async with mutex to prevent concurrent calls from exceeding per-key limits.
   */
  async generateSSEToken(keyId: string): Promise<{ token: string; expiresAt: number }> {
    // Acquire mutex — chain onto the previous operation
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.sseMutex;
    this.sseMutex = lock;

    // #509: await + try/finally together so release() fires even if previous rejects
    try {
      await previous;

      // Cleanup expired tokens first
      this.cleanExpiredSSETokens();

      // Enforce per-key limit
      const current = this.sseTokenCounts.get(keyId) ?? 0;
      if (current >= SSE_TOKEN_MAX_PER_KEY) {
        throw new Error(`SSE token limit reached (${SSE_TOKEN_MAX_PER_KEY} outstanding)`);
      }

      const token = `sse_${randomBytes(32).toString('hex')}`;
      const expiresAt = Date.now() + SSE_TOKEN_TTL_MS;

      this.sseTokens.set(token, { token, expiresAt, used: false, keyId });
      this.sseTokenCounts.set(keyId, current + 1);

      return { token, expiresAt };
    } finally {
      release();
    }
  }

  /**
   * Validate and consume a short-lived SSE token.
   * Returns true if valid (and marks it as used), false otherwise.
   * Also cleans up expired tokens as a side effect.
   */
  validateSSEToken(token: string): boolean {
    const entry = this.sseTokens.get(token);
    if (!entry) return false;

    // Already used
    if (entry.used) {
      this.sseTokens.delete(token);
      return false;
    }

    // Expired
    if (Date.now() > entry.expiresAt) {
      this.sseTokens.delete(token);
      return false;
    }

    // Valid — consume it
    entry.used = true;
    const keyId = entry.keyId;
    this.sseTokens.delete(token);
    // #357: Decrement outstanding count so generateSSEToken doesn't over-limit
    const count = this.sseTokenCounts.get(keyId);
    if (count !== undefined) {
      if (count <= 1) {
        this.sseTokenCounts.delete(keyId);
      } else {
        this.sseTokenCounts.set(keyId, count - 1);
      }
    }
    return true;
  }

  /** Remove expired SSE tokens and recount per-key outstanding. */
  private cleanExpiredSSETokens(): void {
    const now = Date.now();
    // Remove expired
    for (const [key, entry] of this.sseTokens) {
      if (now > entry.expiresAt) {
        this.sseTokens.delete(key);
      }
    }
    // Rebuild counts from surviving tokens
    this.sseTokenCounts.clear();
    for (const entry of this.sseTokens.values()) {
      const count = this.sseTokenCounts.get(entry.keyId) ?? 0;
      this.sseTokenCounts.set(entry.keyId, count + 1);
    }
  }
}
