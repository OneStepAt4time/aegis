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
import { SYSTEM_TENANT } from '../../config.js';
import type { AuditLogger } from '../../audit.js';
import type { ApiKey, ApiKeyRole, ApiKeyStore, GraceKeyEntry, AuthRejectReason } from './types.js';
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
  /** Issue #2097: Deprecated key hashes that remain valid during a rotation grace period. */
  private graceKeys: GraceKeyEntry[] = [];
  /** #1080: HTTP server host binding (set after construction via setHost()). */
  private host: string = '127.0.0.1';
  /** #1419: Audit logger — optional, injected via setAuditLogger(). */
  private audit: AuditLogger | null = null;


  constructor(
    private keysFile: string,
    masterToken: string = '',
    private readonly defaultTenantId: string = 'default',
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
        const parsed = JSON.parse(raw);
        const storeParsed = authStoreSchema.safeParse(parsed);
        if (storeParsed.success) {
          let changed = false;
          this.store = {
            keys: storeParsed.data.keys.map((key) => {
              const normalized = this.normalizeStoredKey(key);
              changed ||= normalized.changed;
              return normalized.key;
            }),
          };
          if (changed) {
            await this.save();
          }
        }
        // Issue #2097: Load grace keys from persisted store
        if (Array.isArray(parsed.graceKeys)) {
          const now = Date.now();
          this.graceKeys = parsed.graceKeys.filter(
            (entry: GraceKeyEntry) => entry.graceExpiresAt > now,
          );
        }
      } catch { /* corrupted or unreadable keys file — start fresh */
        this.store = { keys: [] };
        this.graceKeys = [];
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

    // Issue #2267: Migrate legacy keys without tenantId.
    // Admin keys get SYSTEM_TENANT; non-admin keys get defaultTenantId.
    let resolvedTenantId = key.tenantId;
    if (resolvedTenantId === undefined) {
      resolvedTenantId = key.role === 'admin' ? SYSTEM_TENANT : this.defaultTenantId;
      changed = true;
    }

    return {
      key: {
        ...key,
        permissions: normalizedPermissions,
        quotas,
        tenantId: resolvedTenantId,
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

  /** Save keys (and grace entries) to disk. */
  async save(): Promise<void> {
    const dir = dirname(this.keysFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const data = { ...this.store, graceKeys: this.graceKeys };
    await writeFile(this.keysFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    await secureFilePermissions(this.keysFile);
  }

  /** Create a new API key. Returns the plaintext key (only shown once). */
  async createKey(
    name: string,
    rateLimit = 100,
    ttlDays?: number,
    role: ApiKeyRole = 'viewer',
    permissions?: ApiKeyPermission[],
    tenantId?: string,
  ): Promise<{
    id: string;
    key: string;
    name: string;
    expiresAt: number | null;
    role: ApiKeyRole;
    permissions: ApiKeyPermission[];
    tenantId: string;
  }> {
    const id = randomBytes(8).toString('hex');
    const key = `aegis_${randomBytes(32).toString('hex')}`;
    const hash = AuthManager.hashKey(key);
    const expiresAt = ttlDays ? Date.now() + ttlDays * 86_400_000 : null;
    const resolvedPermissions = this.resolvePermissions(role, permissions);

    // Issue #2267: Validate tenantId assignment.
    // Admin keys always get SYSTEM_TENANT. Non-admin keys require an explicit tenantId.
    const resolvedTenantId = role === 'admin'
      ? SYSTEM_TENANT
      : tenantId ?? this.defaultTenantId;

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
      tenantId: resolvedTenantId,
    };

    this.store.keys.push(apiKey);
    await this.save();

    // #1419: Audit key creation
    if (this.audit) {
      const permissionPolicy = permissions === undefined ? 'role-defaults' : 'custom';
      void this.audit.log('system', 'key.create', `Key created: ${name} (${id}) role=${role} permissionPolicy=${permissionPolicy}`, undefined);
    }

    return { id, key, name, expiresAt, role, permissions: [...resolvedPermissions], tenantId: resolvedTenantId };
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
   * Rotate a key with a grace period (Issue #2097).
   * Creates a new key, stores the old key hash with a grace expiry so both
   * keys work during the overlap window. After grace expires, only the new
   * key is valid.
   * @param id Key ID to rotate
   * @param gracePeriodSeconds Grace period in seconds (default: 3600 = 1 hour)
   * @param ttlDays Optional TTL for the new key
   */
  async rotateKeyWithGrace(
    id: string,
    gracePeriodSeconds: number = 3600,
    ttlDays?: number,
  ): Promise<{
    id: string;
    key: string;
    name: string;
    expiresAt: number | null;
    role: ApiKeyRole;
    permissions: ApiKeyPermission[];
    graceExpiresAt: number;
  } | null> {
    const existing = this.store.keys.find(k => k.id === id);
    if (!existing) return null;

    const now = Date.now();
    const oldHash = existing.hash;
    const graceExpiresAt = now + gracePeriodSeconds * 1000;

    // Store old hash in grace keys
    this.graceKeys.push({
      hash: oldHash,
      keyId: existing.id,
      graceExpiresAt,
    });

    // Generate new key
    const newKey = `aegis_${randomBytes(32).toString('hex')}`;
    const newHash = AuthManager.hashKey(newKey);
    const expiresAt = ttlDays ? now + ttlDays * 86_400_000 : existing.expiresAt;

    existing.hash = newHash;
    existing.expiresAt = expiresAt;
    existing.createdAt = now;
    existing.lastUsedAt = 0;
    this.rateLimits.delete(id);

    await this.save();

    // Audit rotation
    if (this.audit) {
      void this.audit.log('system', 'key.rotate', `Key rotated with grace period: ${existing.name} (${id}) gracePeriodSeconds=${gracePeriodSeconds}`, undefined);
    }

    return {
      id: existing.id,
      key: newKey,
      name: existing.name,
      expiresAt,
      role: existing.role,
      permissions: [...existing.permissions],
      graceExpiresAt,
    };
  }

  /**
   * Validate a bearer token.
   * Returns { valid, keyId, rateLimited, reason, tenantId }.
   * When valid=false, reason indicates why (Issue #1403).
   * Issue #1944: tenantId is set from the API key (admin/master = undefined = bypass).
   */
  validate(token: string): { valid: boolean; keyId: string | null; rateLimited: boolean; reason?: AuthRejectReason; tenantId?: string } {
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
    // Issue #2267: master token uses SYSTEM_TENANT for cross-tenant visibility.
    if (this.masterToken && AuthManager.timingSafeStringEqual(token, this.masterToken)) {
      return { valid: true, keyId: 'master', rateLimited: false, tenantId: SYSTEM_TENANT };
    }

    // Check API keys
    const hash = AuthManager.hashKey(token);
    const key = this.store.keys.find(k => k.hash === hash);
    if (!key) {
      // Issue #2097: Check grace keys — deprecated hashes valid during rotation overlap
      const now = Date.now();
      const graceMatch = this.graceKeys.find(g => g.hash === hash && g.graceExpiresAt > now);
      if (graceMatch) {
        // Find the rotated key to enforce its rate limit and update lastUsedAt
        const rotatedKey = this.store.keys.find(k => k.id === graceMatch.keyId);
        if (rotatedKey) {
          // Check expiry of the rotated key
          if (rotatedKey.expiresAt !== null && now > rotatedKey.expiresAt) {
            return { valid: false, keyId: null, rateLimited: false, reason: 'expired' };
          }
          // Apply rate limiting using the rotated key's ID
          const bucket = this.rateLimits.get(rotatedKey.id) || { count: 0, windowStart: now };
          const windowMs = 60_000;
          if (now - bucket.windowStart > windowMs) {
            bucket.count = 1;
            bucket.windowStart = now;
          } else {
            bucket.count++;
          }
          this.rateLimits.set(rotatedKey.id, bucket);
          if (bucket.count > rotatedKey.rateLimit) {
            return { valid: true, keyId: rotatedKey.id, rateLimited: true };
          }
          rotatedKey.lastUsedAt = now;
          return { valid: true, keyId: rotatedKey.id, rateLimited: false, tenantId: rotatedKey.tenantId };
        }
      }
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
      // Issue #2267: Include resolved tenantId even on rate-limited responses.
      const resolvedTenantId = key.role === 'admin' ? SYSTEM_TENANT : (key.tenantId ?? this.defaultTenantId);
      return { valid: true, keyId: key.id, rateLimited: true, tenantId: resolvedTenantId };
    }

    // Issue #841: Only update lastUsedAt for accepted requests, not rate-limited ones
    key.lastUsedAt = Date.now();

    // Issue #2267: Resolve tenantId — admin keys use SYSTEM_TENANT.
    const resolvedTenantId = key.role === 'admin' ? SYSTEM_TENANT : (key.tenantId ?? this.defaultTenantId);

    return { valid: true, keyId: key.id, rateLimited: false, tenantId: resolvedTenantId };
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

  /** Issue #2267: Get the tenant ID for a key.
   * Admin/master returns SYSTEM_TENANT for cross-tenant visibility.
   * Non-admin keys without tenantId return undefined (treated as SYSTEM_TENANT during migration).
   */
  getTenantId(keyId: string | null | undefined): string | undefined {
    if (keyId === 'master' || keyId === null || keyId === undefined) return SYSTEM_TENANT;
    const key = this.store.keys.find(k => k.id === keyId);
    // Admin role uses system tenant for cross-tenant access
    if (key?.role === 'admin') return SYSTEM_TENANT;
    return key?.tenantId;
  }

  /** Hash a key with SHA-256. */
  static hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Constant-time equality check for secret strings.
   * #2454: Pads shorter input so comparison always runs in constant time,
   * preventing length-leak timing attacks.
   */
  private static timingSafeStringEqual(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a, 'utf8');
    bufB.write(b, 'utf8');
    return timingSafeEqual(bufA, bufB) && a.length === b.length;
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
    // Issue #2097: Prune expired grace key entries
    this.sweepStaleGraceKeys();
  }

  /** Issue #2097: Remove expired grace key entries. Fire-and-forget persistence. */
  private sweepStaleGraceKeys(): void {
    const now = Date.now();
    const before = this.graceKeys.length;
    this.graceKeys = this.graceKeys.filter(g => g.graceExpiresAt > now);
    if (this.graceKeys.length < before) {
      void this.save();
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
