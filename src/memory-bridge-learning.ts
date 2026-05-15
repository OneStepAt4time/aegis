/**
 * memory-bridge-learning.ts — Learning entries for Memory Bridge.
 *
 * Issue #3452: Port learnings pattern from gstack to Aegis Memory Bridge.
 * - Confidence scores (1-10)
 * - Staleness detection (file references)
 * - Contradiction detection (same key, different insight)
 * - Auto-capture with confidence gate
 * - Security: relative paths only, cross-project disabled by default
 */

import { existsSync } from 'node:fs';

export type LearningType = 'pattern' | 'pitfall' | 'preference' | 'architecture' | 'tool';
export type LearningSource = 'auto' | 'agent-stated' | 'user-stated' | 'human-correction';

export interface LearningEntry {
  key: string;          // 2-5 word kebab-case identifier
  type: LearningType;
  insight: string;      // one sentence
  confidence: number;   // 1-10
  source: LearningSource;
  files?: string[];     // related file paths (relative, for staleness detection)
  ts: string;           // ISO timestamp
}

export interface LearningQuery {
  key?: string;
  type?: LearningType;
  keyword?: string;
  minConfidence?: number;
  stale?: boolean;      // if true, include stale entries
}

export interface LearningConflict {
  key: string;
  entries: LearningEntry[];
  resolution: 'latest-wins' | 'manual';
}

const LEARNING_NAMESPACE = 'learning';
const AUTO_CAPTURE_CONFIDENCE_GATE = 7;
const KEY_MIN_WORDS = 2;
const KEY_MAX_WORDS = 5;

function isValidLearningKey(key: string): boolean {
  const words = key.split('-');
  return words.length >= KEY_MIN_WORDS && words.length <= KEY_MAX_WORDS && /^[a-z0-9-]+$/.test(key);
}

function isValidConfidence(confidence: number): boolean {
  return Number.isInteger(confidence) && confidence >= 1 && confidence <= 10;
}

function isRelativePath(path: string): boolean {
  // Reject absolute paths and paths with parent directory traversal
  return !path.startsWith('/') && !path.startsWith('\\') && !path.includes('..');
}

export function isLearningEntry(value: unknown): value is LearningEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.key !== 'string' || !isValidLearningKey(entry.key)) return false;
  if (typeof entry.type !== 'string' || !['pattern', 'pitfall', 'preference', 'architecture', 'tool'].includes(entry.type)) return false;
  if (typeof entry.insight !== 'string' || entry.insight.length === 0) return false;
  if (typeof entry.confidence !== 'number' || !isValidConfidence(entry.confidence)) return false;
  if (typeof entry.source !== 'string' || !['auto', 'agent-stated', 'user-stated', 'human-correction'].includes(entry.source)) return false;
  if (typeof entry.ts !== 'string') return false;
  if (entry.files !== undefined) {
    if (!Array.isArray(entry.files)) return false;
    for (const f of entry.files) {
      if (typeof f !== 'string' || !isRelativePath(f)) return false;
    }
  }
  return true;
}

export class LearningStore {
  private entries = new Map<string, LearningEntry[]>();
  private crossProjectEnabled = false;

  constructor(crossProjectEnabled = false) {
    this.crossProjectEnabled = crossProjectEnabled;
  }

  /**
   * Add a learning entry. Returns the stored entry or null if rejected.
   * Rejects if: invalid key, invalid confidence, absolute paths in files.
   */
  add(entry: LearningEntry): LearningEntry | null {
    if (!isLearningEntry(entry)) {
      console.warn(`LearningStore: rejected invalid entry: ${JSON.stringify(entry)}`);
      return null;
    }
    const list = this.entries.get(entry.key) || [];
    list.push(entry);
    this.entries.set(entry.key, list);
    return entry;
  }

  /**
   * Auto-capture a learning if confidence meets the gate.
   * Returns the stored entry or null if below gate or invalid.
   */
  autoCapture(key: string, type: LearningType, insight: string, confidence: number, files?: string[]): LearningEntry | null {
    if (confidence < AUTO_CAPTURE_CONFIDENCE_GATE) {
      return null;
    }
    const entry: LearningEntry = {
      key,
      type,
      insight,
      confidence,
      source: 'auto',
      files,
      ts: new Date().toISOString(),
    };
    return this.add(entry);
  }

  /**
   * Get all learnings for a key.
   */
  get(key: string): LearningEntry[] {
    return this.entries.get(key) || [];
  }

  /**
   * Query learnings by keyword, type, or minimum confidence.
   * By default excludes stale entries (files that no longer exist).
   */
  query(query: LearningQuery, opts?: { skipStaleCheck?: boolean }): LearningEntry[] {
    const results: LearningEntry[] = [];
    for (const list of this.entries.values()) {
      for (const entry of list) {
        if (query.key && entry.key !== query.key) continue;
        if (query.type && entry.type !== query.type) continue;
        if (query.keyword && !entry.insight.toLowerCase().includes(query.keyword.toLowerCase()) && !entry.key.includes(query.keyword.toLowerCase())) continue;
        if (query.minConfidence !== undefined && entry.confidence < query.minConfidence) continue;
        if (!query.stale && !opts?.skipStaleCheck && this.isStale(entry)) continue;
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Check if a learning entry is stale (any referenced file no longer exists).
   */
  isStale(entry: LearningEntry): boolean {
    if (!entry.files || entry.files.length === 0) return false;
    return entry.files.some(f => !existsSync(f));
  }

  /**
   * Detect contradictions: same key with different insights.
   * Returns conflicts that need resolution.
   */
  detectContradictions(): LearningConflict[] {
    const conflicts: LearningConflict[] = [];
    for (const [key, list] of this.entries) {
      if (list.length < 2) continue;
      const insights = new Set(list.map(e => e.insight));
      if (insights.size < 2) continue;
      conflicts.push({
        key,
        entries: list,
        resolution: 'latest-wins',
      });
    }
    return conflicts;
  }

  /**
   * Resolve contradictions by keeping only the latest entry per key.
   */
  resolveContradictions(): number {
    let resolved = 0;
    for (const [key, list] of this.entries) {
      if (list.length < 2) continue;
      const insights = new Set(list.map(e => e.insight));
      if (insights.size < 2) continue;
      // Keep only the latest entry (by timestamp)
      const latest = list.reduce((a, b) => a.ts > b.ts ? a : b);
      this.entries.set(key, [latest]);
      resolved++;
    }
    return resolved;
  }

  /**
   * Remove stale entries (files no longer exist).
   * Returns count of removed entries.
   */
  pruneStale(): number {
    let removed = 0;
    for (const [key, list] of this.entries) {
      const fresh = list.filter(e => !this.isStale(e));
      removed += list.length - fresh.length;
      if (fresh.length === 0) {
        this.entries.delete(key);
      } else {
        this.entries.set(key, fresh);
      }
    }
    return removed;
  }

  /**
   * Get all entries as a flat list.
   */
  all(): LearningEntry[] {
    return [...this.entries.values()].flat();
  }

  /**
   * Serialize to JSONL format (one JSON object per line).
   */
  serialize(): string {
    const lines: string[] = [];
    for (const entry of this.all()) {
      lines.push(JSON.stringify(entry));
    }
    return lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }

  /**
   * Deserialize from JSONL format.
   * Invalid lines are skipped.
   */
  deserialize(jsonl: string): number {
    let added = 0;
    for (const line of jsonl.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (this.add(parsed)) added++;
      } catch {
        // skip invalid JSON
      }
    }
    return added;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries.clear();
  }
}
