/**
 * AuthManager.ts — API key management and authentication middleware.
 *
 * Issue #39: Multi-key auth with rate limiting.
 * Keys are hashed with SHA-256 (no bcrypt dependency needed).
 * Backward compatible with single authToken from config.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { authStoreSchema } from '../../validation.js';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { secureFilePermissions } from '../../file-utils.js';
import type { AuditLogger } from '../../audit.js';
import type { ApiKey, ApiKeyRole, ApiKeyStore, AuthRejectReason } from './types.js';
import {
  API_KEY_PERMISSION_VALUES,
  isApiKeyPermission,
  normalizePermissions,
  permissionsForRole,
  type ApiKeyPermission,
} from './permissions.js';

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

/** #583: Minimum interval between batch creation requests per key (5 seconds). */
const BATCH_COOLDOWN_MS = 5_000;

type PersistedApiKey = Omit<ApiKey, 'permissions' | 'quotas'> & {
  permissions?: string[];
  quotas?: {
    maxConcurrentSessions?: number | null;
    maxTokensPerWindow?: number | null;
    maxSpendPerWindow?: number | null;
    quotaWindowMs?: number;
  };
};

/** Route-level auth policy for bearer tokens. */
export function classifyBearerTokenForRoute(
  token: string,
  isSSERoute: boolean,
): 'bearer' | 'sse' | 'reject' {
  if (!isSSERoute) return 'bearer';
  return token.startsWith('sse_') ? 'sse' : 'reject';
}

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
  /** #583: Last batch creation timestamp per key ID. */
  private batchRateLimits = new Map<string, number>();
  /** #1080: HTTP server host binding (set after construction via setHost()). */
  private host: string = '127.0.0.1';
  /** #1419: Audit logger — optional, injected via setAuditLogger(). */
  private audit: AuditLogger | null = null;


  constructor(
    private keysFile: string,
    masterToken: string = '',
  ) {
    this.masterToken = masterToken;
  }

  /** #1080: Set the HTTP server host binding after construction (config.host is not available at construction time). */
  setHost(host: string): void {
    this.host = host;
  }

  /** #1419: Inject audit logger for key lifecycle events. */
  setAuditLogger(audit: AuditLogger): void {
    this.audit = audit;
  }

  /** #1080: Expose host binding for server.ts setupAuth() check. */
  get hostBinding(): string {
    return this.host;
  }

  /** #1080: Returns true when Aegis is bound to a localhost interface (127.0.0.1 or ::1). */
  get isLocalhostBinding(): boolean {
    return this.host === '127.0.0.1' || this.host === '::1' || this.host === 'localhost';
  }

  /** Load keys from disk. */
  async load(): Promise<void> {
    if (existsSync(this.keysFile)) {
      try {
        const raw = await readFile(this.keysFile, 'utf-8');
        const parsed = authStoreSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          let changed = false;
          this.store = {
            keys: parsed.data.keys.map((key) => {
              const normalized = this.normalizeStoredKey(key);
              changed ||= normalized.changed;
              return normalized.key;
            }),
          };
          if (changed) {
            await this.save();
          }
        }
      } catch { /* corrupted or unreadable keys file — start fresh */
        this.store = { keys: [] };
      }
    }
  }

  private static permissionsEqual(
    left: readonly ApiKeyPermission[],
    right: readonly ApiKeyPermission[],
  ): boolean {
    return left.length === right.length && left.every((permission, index) => permission === right[index]);
  }

  private normalizeStoredKey(key: PersistedApiKey): { key: ApiKey; changed: boolean } {
    const providedPermissions = key.permissions?.filter(isApiKeyPermission);
    const normalizedPermissions = key.permissions === undefined
      ? permissionsForRole(key.role)
      : normalizePermissions(providedPermissions ?? []);
    let changed = key.permissions === undefined
      || (key.permissions?.length ?? 0) !== normalizedPermissions.length
      || !AuthManager.permissionsEqual(providedPermissions ?? [], normalizedPermissions);

    // Issue #1953: Normalize quotas — convert undefined fields to null for strict typing.
    let quotas: import('./types.js').QuotaConfig | undefined;
    if (key.quotas) {
      quotas = {
        maxConcurrentSessions: key.quotas.maxConcurrentSessions ?? null,
        maxTokensPerWindow: key.quotas.maxTokensPerWindow ?? null,
        maxSpendPerWindow: key.quotas.maxSpendPerWindow ?? null,
        quotaWindowMs: key.quotas.quotaWindowMs ?? 3_600_000,
      };
      // Detect if any normalization happened
      if (
        key.quotas.maxConcurrentSessions === undefined
        || key.quotas.maxTokensPerWindow === undefined
        || key.quotas.maxSpendPerWindow === undefined
        || key.quotas.quotaWindowMs === undefined
      ) {
        changed = true;
      }
    }

    return {
      key: {
        ...key,
        permissions: normalizedPermissions,
        quotas,
      },
      changed,
    };
  }

  private resolvePermissions(
    role: ApiKeyRole,
    permissions?: readonly ApiKeyPermission[],
  ): ApiKeyPermission[] {
    if (permissions === undefined) {
      return permissionsForRole(role);
    }
    return normalizePermissions(permissions);
  }

  /** Save keys to disk. */
  async save(): Promise<void> {
    const dir = dirname(this.keysFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.keysFile, JSON.stringify(this.store, null, 2), { mode: 0o600 });
    await secureFilePermissions(this.keysFile);
  }

  /** Create a new API key. Returns the plaintext key (only shown once). */
  async createKey(
    name: string,
    rateLimit = 100,
    ttlDays?: number,
    role: ApiKeyRole = 'viewer',
    permissions?: ApiKeyPermission[],
  ): Promise<{
    id: string;
    key: string;
    name: string;
    expiresAt: number | null;
    role: ApiKeyRole;
    permissions: ApiKeyPermission[];
  }> {
    const id = randomBytes(8).toString('hex');
    const key = `aegis_${randomBytes(32).toString('hex')}`;
    const hash = AuthManager.hashKey(key);
    const expiresAt = ttlDays ? Date.now() + ttlDays * 86_400_000 : null;
    const resolvedPermissions = this.resolvePermissions(role, permissions);

    const apiKey: ApiKey = {
      id,
      name,
      hash,
      createdAt: Date.now(),
      lastUsedAt: 0,
      rateLimit,
      expiresAt,
      role,
      permissions: resolvedPermissions,
    };

    this.store.keys.push(apiKey);
    await this.save();

    // #1419: Audit key creation
    if (this.audit) {
      const permissionPolicy = permissions === undefined ? 'role-defaults' : 'custom';
      void this.audit.log('system', 'key.create', `Key created: ${name} (${id}) role=${role} permissionPolicy=${permissionPolicy}`, undefined);
    }

    return { id, key, name, expiresAt, role, permissions: [...resolvedPermissions] };
  }

  /** List keys (without hashes). */
  listKeys(): Array<Omit<ApiKey, 'hash'>> {
    return this.store.keys.map(({ hash: _, permissions, ...rest }) => ({
      ...rest,
      permissions: [...permissions],
    }));
  }

  /** Issue #1953: Get an API key by ID (for quota lookups). Returns null if not found. */
  getKey(id: string): ApiKey | null {
    return this.store.keys.find(k => k.id === id) ?? null;
  }

  /** Issue #1953: Set quotas on an API key. Returns the updated key (without hash) or null. */
  async setQuotas(id: string, quotas: import('./types.js').QuotaConfig): Promise<Omit<ApiKey, 'hash'> | null> {
    const key = this.store.keys.find(k => k.id === id);
    if (!key) return null;
    key.quotas = { ...quotas };
    await this.save();

    if (this.audit) {
      void this.audit.log('system', 'key.quotas.update', `Quotas updated for key ${key.name} (${id}): sessions=${quotas.maxConcurrentSessions}, tokens=${quotas.maxTokensPerWindow}, spend=${quotas.maxSpendPerWindow}`, undefined);
    }

    const { hash: _, ...rest } = key;
    return { ...rest, permissions: [...key.permissions] };
  }

  /** Revoke a key by ID. */
  async revokeKey(id: string): Promise<boolean> {
    const idx = this.store.keys.findIndex(k => k.id === id);
    if (idx === -1) return false;
    const revoked = this.store.keys[idx]!;
    this.store.keys.splice(idx, 1);
    this.rateLimits.delete(id);
    await this.save();

    // #1419: Audit key revocation
    if (this.audit) {
      void this.audit.log('system', 'key.revoke', `Key revoked: ${revoked.name} (${id})`, undefined);
    }

    return true;
  }

  /**
   * Rotate a key by ID (Issue #1403).
   * Generates a new plaintext key, replaces the old hash, and preserves
   * name, role, rateLimit, and ttlDays. Returns the new key or null if not found.
   */
  async rotateKey(
    id: string,
    ttlDays?: number,
  ): Promise<{
    id: string;
    key: string;
    name: string;
    expiresAt: number | null;
    role: ApiKeyRole;
    permissions: ApiKeyPermission[];
  } | null> {
    const existing = this.store.keys.find(k => k.id === id);
    if (!existing) return null;

    const newKey = `aegis_${randomBytes(32).toString('hex')}`;
    const newHash = AuthManager.hashKey(newKey);
    const expiresAt = ttlDays ? Date.now() + ttlDays * 86_400_000 : existing.expiresAt;

    existing.hash = newHash;
    existing.expiresAt = expiresAt;
    existing.createdAt = Date.now();
    existing.lastUsedAt = 0;
    this.rateLimits.delete(id);

    await this.save();

    return {
      id: existing.id,
      key: newKey,
      name: existing.name,
      expiresAt,
      role: existing.role,
      permissions: [...existing.permissions],
    };
  }

  /**
   * Validate a bearer token.
   * Returns { valid, keyId, rateLimited, reason }.
   * When valid=false, reason indicates why (Issue #1403).
   */
  validate(token: string): { valid: boolean; keyId: string | null; rateLimited: boolean; reason?: AuthRejectReason } {
    // No auth configured and no keys → allow all
    if (!this.masterToken && this.store.keys.length === 0) {
      // #1080: SECURITY FIX — when binding to a non-localhost interface without auth,
      // reject all requests. Running Aegis on 0.0.0.0 with no auth is a critical vuln.
      if (!this.isLocalhostBinding) {
        return { valid: false, keyId: null, rateLimited: false, reason: 'no_auth' };
      }
      return { valid: true, keyId: null, rateLimited: false };
    }

    // Check master token (backward compat) — timing-safe comparison (#402)
    if (this.masterToken && AuthManager.timingSafeStringEqual(token, this.masterToken)) {
      return { valid: true, keyId: 'master', rateLimited: false };
    }

    // Check API keys
    const hash = AuthManager.hashKey(token);
    const key = this.store.keys.find(k => k.hash === hash);
    if (!key) {
      return { valid: false, keyId: null, rateLimited: false, reason: 'invalid' };
    }

    // #1436/#1403: Reject expired keys with specific reason
    if (key.expiresAt !== null && Date.now() > key.expiresAt) {
      return { valid: false, keyId: null, rateLimited: false, reason: 'expired' };
    }

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

    // Issue #841: Only update lastUsedAt for accepted requests, not rate-limited ones
    key.lastUsedAt = Date.now();

    return { valid: true, keyId: key.id, rateLimited: false };
  }

  /** Issue #1432: Get the RBAC role for a key ID. Master token = admin. Unknown/null = viewer (default). */
  getRole(keyId: string | null | undefined): ApiKeyRole {
    if (keyId === 'master') return 'admin';
    const key = keyId ? this.store.keys.find(k => k.id === keyId) : undefined;
    return key?.role ?? 'viewer';
  }

  getAuditActor(keyId: string | null | undefined, fallbackActor = 'system'): string {
    if (keyId === null || keyId === undefined) return fallbackActor;
    if (keyId === 'master') return 'master';
    const key = this.store.keys.find(candidate => candidate.id === keyId);
    return key ? `key:${key.name}` : 'api-key';
  }

  getPermissions(keyId: string | null | undefined): ApiKeyPermission[] {
    if (!this.authEnabled || keyId === 'master') {
      return [...API_KEY_PERMISSION_VALUES];
    }
    const key = keyId ? this.store.keys.find(candidate => candidate.id === keyId) : undefined;
    return key ? [...key.permissions] : [];
  }

  hasPermission(keyId: string | null | undefined, permission: ApiKeyPermission): boolean {
    return this.getRole(keyId) === 'admin' || this.getPermissions(keyId).includes(permission);
  }

  /** Hash a key with SHA-256. */
  static hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /** Constant-time equality check for secret strings. */
  private static timingSafeStringEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }

  /** #583: Check and update batch rate limit for a key. Returns true if rate-limited. */
  checkBatchRateLimit(keyId: string | null): boolean {
    const id = keyId ?? 'anonymous';
    const now = Date.now();
    const lastBatch = this.batchRateLimits.get(id);
    if (lastBatch !== undefined && now - lastBatch < BATCH_COOLDOWN_MS) {
      return true;
    }
    this.batchRateLimits.set(id, now);
    return false;
  }

  /** #398: Sweep stale rate limit buckets. Prune entries with expired windows. */
  sweepStaleRateLimits(): void {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    for (const [keyId, bucket] of this.rateLimits) {
      if (now - bucket.windowStart > windowMs) {
        this.rateLimits.delete(keyId);
      }
    }
    // #583: Prune expired batch rate limit entries
    for (const [keyId, ts] of this.batchRateLimits) {
      if (now - ts > BATCH_COOLDOWN_MS) {
        this.batchRateLimits.delete(keyId);
      }
    }
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
    // #573: catch prior rejection so it doesn't propagate and block subsequent callers
    try {
      await previous.catch(() => {});

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
   * #826: Async with mutex to prevent concurrent validation/generation from
   * racing on shared state (sseTokens, sseTokenCounts).
   */
  async validateSSEToken(token: string): Promise<boolean> {
    // Acquire mutex — chain onto the previous operation
    let release: () => void = () => {};
    const lock = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.sseMutex;
    this.sseMutex = lock;

    // #573: catch prior rejection so it doesn't propagate and block subsequent callers
    try {
      await previous.catch(() => {});

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
    } finally {
      release();
    }
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
