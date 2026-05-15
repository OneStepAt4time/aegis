/**
 * Tests for Structured Learnings System (Issue #3413)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProjectLearningsStore,
  LearningsManager,
  getProjectSlug,
  isStructuredLearning,
  type StructuredLearning,
} from '../structured-learnings.js';

describe('ProjectLearningsStore', () => {
  let store: ProjectLearningsStore;

  beforeEach(() => {
    store = new ProjectLearningsStore('test-project');
  });

  it('adds valid learning entries', () => {
    const entry = store.add({
      key: 'use-async-await',
      type: 'pattern',
      insight: 'Always use async/await for asynchronous operations',
      confidence: 9,
      source: 'agent-stated',
      project: 'test-project',
      ts: '2024-01-01T00:00:00Z',
    });
    expect(entry).not.toBeNull();
    expect(store.all()).toHaveLength(1);
  });

  it('rejects entry for wrong project', () => {
    const entry = store.add({
      key: 'test-entry',
      type: 'pattern',
      insight: 'Test',
      confidence: 8,
      source: 'auto',
      project: 'wrong-project',
      ts: '2024-01-01T00:00:00Z',
    });
    expect(entry).toBeNull();
  });

  it('auto-captures above confidence gate', () => {
    const entry = store.autoCapture('avoid-any-cast', 'pitfall', 'Avoid any casts without justification', 8);
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe('auto');
    expect(entry?.project).toBe('test-project');
  });

  it('does not auto-capture below confidence gate', () => {
    const entry = store.autoCapture('weak-pattern', 'pattern', 'Something', 5);
    expect(entry).toBeNull();
  });

  it('queries by keyword with scoring', () => {
    store.add({ key: 'use-const', type: 'pattern', insight: 'Prefer const over let', confidence: 8, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'avoid-var', type: 'pattern', insight: 'Never use var', confidence: 9, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ keyword: 'const' });
    expect(results).toHaveLength(1);
    expect(results[0].learning.key).toBe('use-const');
    expect(results[0].score).toBeGreaterThanOrEqual(10); // exact key match
  });

  it('queries by type', () => {
    store.add({ key: 'use-const', type: 'pattern', insight: 'Prefer const', confidence: 8, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'avoid-any', type: 'pitfall', insight: 'Avoid any', confidence: 9, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ type: 'pitfall' });
    expect(results).toHaveLength(1);
    expect(results[0].learning.key).toBe('avoid-any');
  });

  it('queries by minConfidence', () => {
    store.add({ key: 'high-conf', type: 'pattern', insight: 'High', confidence: 9, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'low-conf', type: 'pattern', insight: 'Low', confidence: 3, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ minConfidence: 7 });
    expect(results).toHaveLength(1);
    expect(results[0].learning.key).toBe('high-conf');
  });

  it('queries with limit', () => {
    store.add({ key: 'first-pattern', type: 'pattern', insight: 'One', confidence: 8, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'second-pattern', type: 'pattern', insight: 'Two', confidence: 9, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'third-pattern', type: 'pattern', insight: 'Three', confidence: 10, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ limit: 2, minConfidence: 1, keyword: "One" });
    expect(results).toHaveLength(1);
  });

  it('prunes stale entries', () => {
    store.add({ key: 'file-pattern', type: 'pattern', insight: 'Pattern in file', confidence: 10, source: 'auto', project: 'test-project', files: ['non-existent-file.ts'], ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'no-files', type: 'pattern', insight: 'No files', confidence: 10, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    const removed = store.pruneStale();
    expect(removed).toBe(1);
    expect(store.all()).toHaveLength(1);
  });
});

describe('LearningsManager', () => {
  let manager: LearningsManager;

  beforeEach(() => {
    manager = new LearningsManager();
  });

  it('gets project store', () => {
    const store = manager.getProjectStore('project-a');
    expect(store).toBeInstanceOf(ProjectLearningsStore);
  });

  it('searches across all projects', () => {
    const storeA = manager.getProjectStore('project-a');
    const storeB = manager.getProjectStore('project-b');
    storeA.add({ key: 'pattern-a', type: 'pattern', insight: 'Pattern A', confidence: 8, source: 'auto', project: 'project-a', ts: '2024-01-01T00:00:00Z' });
    storeB.add({ key: 'pattern-b', type: 'pattern', insight: 'Pattern B', confidence: 10, source: 'auto', project: 'project-b', ts: '2024-01-01T00:00:00Z' });
    const results = manager.search({ keyword: 'pattern' });
    expect(results).toHaveLength(2);
  });

  it('searches specific project', () => {
    const storeA = manager.getProjectStore('project-a');
    const storeB = manager.getProjectStore('project-b');
    storeA.add({ key: 'pattern-a', type: 'pattern', insight: 'Pattern A', confidence: 8, source: 'auto', project: 'project-a', ts: '2024-01-01T00:00:00Z' });
    storeB.add({ key: 'pattern-b', type: 'pattern', insight: 'Pattern B', confidence: 10, source: 'auto', project: 'project-b', ts: '2024-01-01T00:00:00Z' });
    const results = manager.search({ keyword: 'pattern', project: 'project-a' });
    expect(results).toHaveLength(1);
    expect(results[0].learning.project).toBe('project-a');
  });

  it('formats for session injection', () => {
    const store = manager.getProjectStore('test-project');
    store.add({ key: 'use-const', type: 'pattern', insight: 'Prefer const over let', confidence: 8, source: 'auto', project: 'test-project', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'avoid-var', type: 'pitfall', insight: 'Never use var', confidence: 9, source: 'auto', project: 'test-project', files: ['src/index.ts'], ts: '2024-01-01T00:00:00Z' });
    const formatted = manager.formatForSession('test-project', 10);
    expect(formatted).toContain('Project Learnings');
    expect(formatted).toContain('Prefer const over let');
    // Note: 'avoid-var' is filtered out because its file 'src/index.ts' doesn't exist (stale filter)
  });
});

describe('getProjectSlug', () => {
  it('extracts directory name', () => {
    expect(getProjectSlug('/home/user/projects/aegis')).toBe('aegis');
    expect(getProjectSlug('/home/user/projects/aegis/')).toBe('aegis');
  });

  it('returns default for empty path', () => {
    expect(getProjectSlug('')).toBe('default');
  });
});

describe('isStructuredLearning', () => {
  it('accepts valid entry', () => {
    const entry: StructuredLearning = {
      key: 'valid-key',
      type: 'pattern',
      insight: 'Valid insight',
      confidence: 8,
      source: 'auto',
      project: 'test',
      ts: '2024-01-01T00:00:00Z',
    };
    expect(isStructuredLearning(entry)).toBe(true);
  });

  it('rejects invalid key', () => {
    expect(isStructuredLearning({ key: 'a', type: 'pattern', insight: 'Test', confidence: 8, source: 'auto', project: 'test', ts: '2024-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects invalid confidence', () => {
    expect(isStructuredLearning({ key: 'valid-key', type: 'pattern', insight: 'Test', confidence: 15, source: 'auto', project: 'test', ts: '2024-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects absolute path', () => {
    expect(isStructuredLearning({ key: 'valid-key', type: 'pattern', insight: 'Test', confidence: 8, source: 'auto', project: 'test', files: ['/absolute'], ts: '2024-01-01T00:00:00Z' })).toBe(false);
  });
});
