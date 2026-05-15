/**
 * structured-learnings.ts — Per-project learnings system for Aegis.
 *
 * Issue #3413: Spike for structured learnings system.
 *
 * Design decisions:
 * - JSONL append-only format (same as gstack) for durability and git-friendliness
 * - Per-project storage: ~/.aegis/learnings/{project-slug}/learnings.jsonl
 * - Searched at session start to inject relevant context into Claude Code sessions
 * - Separate from Memory Bridge (which is key-value ephemeral storage)
 *
 * Integration points:
 * - SessionManager.createSession(): reads learnings for workDir and injects into initial prompt
 * - LearningStore: add, query, search by keyword/type/confidence
 * - Auto-capture: hooks into session completion to extract patterns
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import {
  LearningType,
  LearningSource,
  isValidLearningKey,
  isValidConfidence,
  isRelativePath,
  KEY_MIN_WORDS,
  KEY_MAX_WORDS,
  AUTO_CAPTURE_CONFIDENCE_GATE,
} from './learnings-common.js';

// Types imported from learnings-common.ts

export interface StructuredLearning {
  key: string;          // 2-5 word kebab-case identifier
  type: LearningType;
  insight: string;      // one sentence, actionable
  confidence: number;   // 1-10
  source: LearningSource;
  project: string;      // project slug (directory name or explicit)
  files?: string[];     // relative paths for staleness detection
  tags?: string[];      // optional tags for filtering
  ts: string;           // ISO timestamp
}

export interface LearningSearchResult {
  learning: StructuredLearning;
  score: number;        // relevance score (exact match = 10, keyword = 5, tag = 3)
}

export interface LearningsQuery {
  project?: string;
  type?: LearningType;
  keyword?: string;
  tag?: string;
  minConfidence?: number;
  limit?: number;
  stale?: boolean;
}

const LEARNINGS_DIR = join(homedir(), '.aegis', 'learnings');
// KEY_MIN_WORDS, KEY_MAX_WORDS, AUTO_CAPTURE_CONFIDENCE_GATE imported from learnings-common.ts

// Validation functions imported from learnings-common.ts

export function isStructuredLearning(value: unknown): value is StructuredLearning {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.key !== 'string' || !isValidLearningKey(entry.key)) return false;
  if (typeof entry.type !== 'string' || !['pattern', 'pitfall', 'preference', 'architecture', 'tool'].includes(entry.type)) return false;
  if (typeof entry.insight !== 'string' || entry.insight.length === 0) return false;
  if (typeof entry.confidence !== 'number' || !isValidConfidence(entry.confidence)) return false;
  if (typeof entry.source !== 'string' || !['auto', 'agent-stated', 'user-stated', 'human-correction'].includes(entry.source)) return false;
  if (typeof entry.project !== 'string' || entry.project.length === 0) return false;
  if (typeof entry.ts !== 'string') return false;
  if (entry.files !== undefined) {
    if (!Array.isArray(entry.files)) return false;
    for (const f of entry.files) {
      if (typeof f !== 'string' || !isRelativePath(f)) return false;
    }
  }
  if (entry.tags !== undefined) {
    if (!Array.isArray(entry.tags)) return false;
    for (const t of entry.tags) {
      if (typeof t !== 'string') return false;
    }
  }
  return true;
}

/**
 * Get the project slug from a working directory path.
 * Uses the directory name as the project identifier.
 */
export function getProjectSlug(workDir: string): string {
  return basename(workDir) || 'default';
}

/**
 * Get the learnings file path for a project.
 */
export function getLearningsFilePath(project: string): string {
  return join(LEARNINGS_DIR, project, 'learnings.jsonl');
}

/**
 * Structured learnings store for a single project.
 */
export class ProjectLearningsStore {
  private entries: StructuredLearning[] = [];
  private project: string;
  private filePath: string;

  constructor(project: string) {
    this.project = project;
    this.filePath = getLearningsFilePath(project);
  }

  /**
   * Load learnings from disk (JSONL file).
   */
  async load(): Promise<number> {
    if (!existsSync(this.filePath)) {
      this.entries = [];
      return 0;
    }
    const content = await readFile(this.filePath, 'utf-8');
    this.entries = [];
    let loaded = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (isStructuredLearning(parsed) && parsed.project === this.project) {
          this.entries.push(parsed);
          loaded++;
        }
      } catch {
        // skip invalid JSON
      }
    }
    return loaded;
  }

  /**
   * Save learnings to disk (JSONL file).
   */
  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const lines = this.entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(this.filePath, lines, 'utf-8');
  }

  /**
   * Add a learning entry. Returns the stored entry or null if rejected.
   */
  add(entry: StructuredLearning): StructuredLearning | null {
    if (!isStructuredLearning(entry)) {
      console.warn(`ProjectLearningsStore: rejected invalid entry: ${JSON.stringify(entry)}`);
      return null;
    }
    if (entry.project !== this.project) {
      console.warn(`ProjectLearningsStore: rejected entry for wrong project: ${entry.project} != ${this.project}`);
      return null;
    }
    this.entries.push(entry);
    return entry;
  }

  /**
   * Auto-capture a learning if confidence meets the gate.
   */
  autoCapture(key: string, type: LearningType, insight: string, confidence: number, files?: string[], tags?: string[]): StructuredLearning | null {
    if (confidence < AUTO_CAPTURE_CONFIDENCE_GATE) {
      return null;
    }
    const entry: StructuredLearning = {
      key,
      type,
      insight,
      confidence,
      source: 'auto',
      project: this.project,
      files,
      tags,
      ts: new Date().toISOString(),
    };
    return this.add(entry);
  }

  /**
   * Query learnings with filtering and scoring.
   * @param opts.skipStaleCheck — skip the existsSync() staleness check for performance
   */
  query(query: LearningsQuery, opts?: { skipStaleCheck?: boolean }): LearningSearchResult[] {
    const results: LearningSearchResult[] = [];
    for (const entry of this.entries) {
      let score = 0;

      if (query.type && entry.type !== query.type) continue;
      if (query.minConfidence !== undefined && entry.confidence < query.minConfidence) continue;

      // Keyword matching
      if (query.keyword) {
        const kw = query.keyword.toLowerCase();
        if (entry.key.includes(kw)) score += 10;
        if (entry.insight.toLowerCase().includes(kw)) score += 5;
        if (entry.tags?.some(t => t.toLowerCase().includes(kw))) score += 3;
        if (score === 0) continue; // no match
      }

      // Tag filtering
      if (query.tag && !entry.tags?.includes(query.tag)) continue;

      // Staleness check (skip stale entries unless explicitly requested)
      if (!query.stale && !opts?.skipStaleCheck && entry.files && entry.files.length > 0) {
        const hasStaleFiles = entry.files.some(f => !existsSync(f));
        if (hasStaleFiles) continue;
      }

      results.push({ learning: entry, score });
    }

    // Sort by score descending, then confidence descending
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.learning.confidence - a.learning.confidence;
    });

    return query.limit ? results.slice(0, query.limit) : results;
  }

  /**
   * Get all learnings as a flat list.
   */
  all(): StructuredLearning[] {
    return [...this.entries];
  }

  /**
   * Prune stale entries (files no longer exist).
   */
  pruneStale(): number {
    let removed = 0;
    this.entries = this.entries.filter(e => {
      if (!e.files || e.files.length === 0) return true;
      const isStale = e.files.some(f => !existsSync(f));
      if (isStale) removed++;
      return !isStale;
    });
    return removed;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Global learnings manager — handles multiple projects.
 */
export class LearningsManager {
  private stores = new Map<string, ProjectLearningsStore>();

  /**
   * Get or create a project store.
   */
  getProjectStore(project: string): ProjectLearningsStore {
    if (!this.stores.has(project)) {
      this.stores.set(project, new ProjectLearningsStore(project));
    }
    return this.stores.get(project)!;
  }

  /**
   * Load learnings for a project from disk.
   */
  async loadProject(project: string): Promise<number> {
    const store = this.getProjectStore(project);
    return store.load();
  }

  /**
   * Save learnings for a project to disk.
   */
  async saveProject(project: string): Promise<void> {
    const store = this.getProjectStore(project);
    return store.save();
  }

  /**
   * Search across all projects or a specific project.
   */
  search(query: LearningsQuery & { project?: string }): LearningSearchResult[] {
    if (query.project) {
      const store = this.getProjectStore(query.project);
      return store.query(query);
    }

    // Search all projects
    const allResults: LearningSearchResult[] = [];
    for (const store of this.stores.values()) {
      allResults.push(...store.query(query));
    }
    allResults.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.learning.confidence - a.learning.confidence;
    });
    return query.limit ? allResults.slice(0, query.limit) : allResults;
  }

  /**
   * List all projects with learnings.
   */
  async listProjects(): Promise<string[]> {
    if (!existsSync(LEARNINGS_DIR)) return [];
    const entries = await readdir(LEARNINGS_DIR, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  }

  /**
   * Inject relevant learnings into a session prompt.
   * Returns a formatted string for Claude Code context.
   */
  formatForSession(project: string, limit = 10): string {
    const store = this.getProjectStore(project);
    const results = store.query({ limit, minConfidence: 6 });
    if (results.length === 0) return '';

    const lines = [
      '## Project Learnings',
      '',
      'The following patterns and preferences have been learned from previous sessions:',
      '',
    ];
    for (const result of results) {
      const l = result.learning;
      lines.push(`- **[${l.type}]** ${l.insight} (confidence: ${l.confidence}/10)`);
      if (l.files && l.files.length > 0) {
        lines.push(`  - Files: ${l.files.join(', ')}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }
}
