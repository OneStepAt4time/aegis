/**
 * QuotaManager.ts — Per-key resource quota tracking and enforcement.
 *
 * Issue #1953: Prevents one API key from starving others by enforcing:
 *   - Max concurrent sessions
 *   - Max tokens per rolling window
 *   - Max USD spend per rolling window
 *
 * Usage is tracked in-memory with a rolling window. The manager is
 * queried at session-create and send-time to enforce limits.
 */

import type { ApiKey, QuotaConfig } from './types.js';

/** Default rolling window: 1 hour. */
const DEFAULT_WINDOW_MS = 3_600_000;

/** A single usage record within the rolling window. */
interface UsageEntry {
  timestamp: number;
  tokens: number;
  costUsd: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  /** Which quota was exceeded, if any. */
  reason?: 'concurrent_sessions' | 'tokens_per_window' | 'spend_per_window';
  /** Human-readable message. */
  message?: string;
  /** Current usage snapshot for the key. */
  usage: QuotaUsage;
}

export interface QuotaUsage {
  activeSessions: number;
  maxSessions: number | null;
  tokensInWindow: number;
  maxTokens: number | null;
  spendInWindow: number;
  maxSpend: number | null;
  windowMs: number;
}

export class QuotaManager {
  /** Per-key usage entries, ordered by timestamp. */
  private usageLog = new Map<string, UsageEntry[]>();

  /**
   * Check if an API key is allowed to create a new session.
   * Counts active sessions owned by the key.
   *
   * @param key - The API key (may have no quotas set).
   * @param activeSessionCount - Number of sessions currently owned by this key.
   */
  checkSessionQuota(key: ApiKey | null, activeSessionCount: number): QuotaCheckResult {
    if (!key?.quotas) return this.unlimitedResult(activeSessionCount);

    const q = key.quotas;
    const maxSessions = q.maxConcurrentSessions;

    if (maxSessions !== null && activeSessionCount >= maxSessions) {
      return {
        allowed: false,
        reason: 'concurrent_sessions',
        message: `Quota exceeded: key "${key.name}" has ${activeSessionCount} active sessions (max ${maxSessions})`,
        usage: this.buildUsage(key, activeSessionCount),
      };
    }

    // Also check token and spend quotas (even for session creation,
    // to fail fast before launching a tmux window).
    const tokenCheck = this.checkWindowUsage(key, 0);
    if (!tokenCheck.allowed) return tokenCheck;

    return {
      allowed: true,
      usage: this.buildUsage(key, activeSessionCount),
    };
  }

  /**
   * Check if an API key is allowed to send a message (tokens/spend quota).
   *
   * @param key - The API key.
   * @param activeSessionCount - Number of active sessions for this key.
   */
  checkSendQuota(key: ApiKey | null, activeSessionCount: number): QuotaCheckResult {
    if (!key?.quotas) return this.unlimitedResult(activeSessionCount);
    return this.checkWindowUsage(key, activeSessionCount);
  }

  /**
   * Record token usage and cost for a key.
   */
  recordUsage(keyId: string, tokens: number, costUsd: number): void {
    if (tokens === 0 && costUsd === 0) return;
    const log = this.usageLog.get(keyId) ?? [];
    log.push({ timestamp: Date.now(), tokens, costUsd });
    this.usageLog.set(keyId, log);
  }

  /**
   * Get current quota usage for a key.
   */
  getUsage(key: ApiKey, activeSessionCount: number): QuotaUsage {
    return this.buildUsage(key, activeSessionCount);
  }

  /**
   * Clean up usage entries older than the window for all keys.
   * Should be called periodically (e.g., every 5 minutes).
   */
  sweep(windowMs: number = DEFAULT_WINDOW_MS): void {
    const cutoff = Date.now() - windowMs;
    for (const [keyId, entries] of this.usageLog) {
      const filtered = entries.filter(e => e.timestamp > cutoff);
      if (filtered.length === 0) {
        this.usageLog.delete(keyId);
      } else if (filtered.length !== entries.length) {
        this.usageLog.set(keyId, filtered);
      }
    }
  }

  /** Remove all usage data for a key (e.g., after revocation). */
  clearKey(keyId: string): void {
    this.usageLog.delete(keyId);
  }

  // ── Private helpers ────────────────────────────────────────────────

  private checkWindowUsage(key: ApiKey, activeSessionCount: number): QuotaCheckResult {
    const q = key.quotas!;
    const windowMs = q.quotaWindowMs || DEFAULT_WINDOW_MS;
    const usage = this.buildUsage(key, activeSessionCount);

    if (q.maxTokensPerWindow !== null && usage.tokensInWindow >= q.maxTokensPerWindow) {
      return {
        allowed: false,
        reason: 'tokens_per_window',
        message: `Quota exceeded: key "${key.name}" used ${usage.tokensInWindow} tokens in window (max ${q.maxTokensPerWindow})`,
        usage,
      };
    }

    if (q.maxSpendPerWindow !== null && usage.spendInWindow >= q.maxSpendPerWindow) {
      return {
        allowed: false,
        reason: 'spend_per_window',
        message: `Quota exceeded: key "${key.name}" spent $${usage.spendInWindow.toFixed(4)} in window (max $${q.maxSpendPerWindow})`,
        usage,
      };
    }

    return { allowed: true, usage };
  }

  private buildUsage(key: ApiKey, activeSessionCount: number): QuotaUsage {
    const q = key.quotas;
    const windowMs = q?.quotaWindowMs || DEFAULT_WINDOW_MS;
    const cutoff = Date.now() - windowMs;
    const entries = this.usageLog.get(key.id) ?? [];
    const recent = entries.filter(e => e.timestamp > cutoff);

    return {
      activeSessions: activeSessionCount,
      maxSessions: q?.maxConcurrentSessions ?? null,
      tokensInWindow: recent.reduce((sum, e) => sum + e.tokens, 0),
      maxTokens: q?.maxTokensPerWindow ?? null,
      spendInWindow: recent.reduce((sum, e) => sum + e.costUsd, 0),
      maxSpend: q?.maxSpendPerWindow ?? null,
      windowMs,
    };
  }

  private unlimitedResult(activeSessionCount: number): QuotaCheckResult {
    return {
      allowed: true,
      usage: {
        activeSessions: activeSessionCount,
        maxSessions: null,
        tokensInWindow: 0,
        maxTokens: null,
        spendInWindow: 0,
        maxSpend: null,
        windowMs: DEFAULT_WINDOW_MS,
      },
    };
  }
}
