/**
 * Tests for Memory Bridge Learning Store (Issue #3452)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { LearningStore, isLearningEntry, type LearningEntry } from '../memory-bridge-learning.js';

describe('LearningStore', () => {
  let store: LearningStore;

  beforeEach(() => {
    store = new LearningStore();
  });

  it('adds valid learning entries', () => {
    const entry = store.add({
      key: 'use-async-await',
      type: 'pattern',
      insight: 'Always use async/await for asynchronous operations',
      confidence: 9,
      source: 'agent-stated',
      ts: '2024-01-01T00:00:00Z',
    });
    expect(entry).not.toBeNull();
    expect(store.get('use-async-await')).toHaveLength(1);
  });

  it('rejects invalid key format', () => {
    const entry = store.add({
      key: 'invalid_key_with_underscores',
      type: 'pattern',
      insight: 'Test',
      confidence: 5,
      source: 'auto',
      ts: '2024-01-01T00:00:00Z',
    });
    expect(entry).toBeNull();
  });

  it('rejects confidence out of range', () => {
    const entry = store.add({
      key: 'test-entry',
      type: 'pattern',
      insight: 'Test',
      confidence: 15,
      source: 'auto',
      ts: '2024-01-01T00:00:00Z',
    });
    expect(entry).toBeNull();
  });

  it('rejects absolute paths in files', () => {
    const entry = store.add({
      key: 'test-entry',
      type: 'pattern',
      insight: 'Test',
      confidence: 5,
      source: 'auto',
      files: ['/absolute/path'],
      ts: '2024-01-01T00:00:00Z',
    });
    expect(entry).toBeNull();
  });

  it('auto-captures above confidence gate', () => {
    const entry = store.autoCapture('avoid-any-cast', 'pitfall', 'Avoid any casts without justification', 8);
    expect(entry).not.toBeNull();
    expect(entry?.source).toBe('auto');
  });

  it('does not auto-capture below confidence gate', () => {
    const entry = store.autoCapture('weak-pattern', 'pattern', 'Something', 5);
    expect(entry).toBeNull();
  });

  it('queries by keyword', () => {
    store.add({ key: 'use-const', type: 'pattern', insight: 'Prefer const over let', confidence: 8, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'avoid-var', type: 'pattern', insight: 'Never use var', confidence: 9, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ keyword: 'const' });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('use-const');
  });

  it('queries by type', () => {
    store.add({ key: 'use-const', type: 'pattern', insight: 'Prefer const', confidence: 8, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'avoid-any', type: 'pitfall', insight: 'Avoid any', confidence: 9, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ type: 'pitfall' });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('avoid-any');
  });

  it('queries by minConfidence', () => {
    store.add({ key: 'high-conf', type: 'pattern', insight: 'High', confidence: 9, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'low-conf', type: 'pattern', insight: 'Low', confidence: 3, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    const results = store.query({ minConfidence: 7 });
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('high-conf');
  });

  it('detects contradictions', () => {
    store.add({ key: 'use-let', type: 'preference', insight: 'Use let for mutability', confidence: 7, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'use-let', type: 'preference', insight: 'Use const by default', confidence: 8, source: 'auto', ts: '2024-01-02T00:00:00Z' });
    const conflicts = store.detectContradictions();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe('use-let');
  });

  it('resolves contradictions (latest wins)', () => {
    store.add({ key: 'use-let', type: 'preference', insight: 'Use let', confidence: 7, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'use-let', type: 'preference', insight: 'Use const', confidence: 8, source: 'auto', ts: '2024-01-02T00:00:00Z' });
    const resolved = store.resolveContradictions();
    expect(resolved).toBe(1);
    const entries = store.get('use-let');
    expect(entries).toHaveLength(1);
    expect(entries[0].insight).toBe('Use const');
  });

  it('serializes and deserializes', () => {
    store.add({ key: 'test-one', type: 'pattern', insight: 'Test one', confidence: 5, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'test-two', type: 'pitfall', insight: 'Test two', confidence: 6, source: 'user-stated', ts: '2024-01-02T00:00:00Z' });
    const jsonl = store.serialize();
    const newStore = new LearningStore();
    const added = newStore.deserialize(jsonl);
    expect(added).toBe(2);
    expect(newStore.all()).toHaveLength(2);
  });

  it('prunes stale entries (non-existent files)', () => {
    store.add({ key: 'file-pattern', type: 'pattern', insight: 'Pattern in file', confidence: 7, source: 'auto', files: ['non-existent-file.ts'], ts: '2024-01-01T00:00:00Z' });
    store.add({ key: 'no-files', type: 'pattern', insight: 'No files', confidence: 7, source: 'auto', ts: '2024-01-01T00:00:00Z' });
    const removed = store.pruneStale();
    expect(removed).toBe(1);
    expect(store.get('file-pattern')).toHaveLength(0);
    expect(store.get('no-files')).toHaveLength(1);
  });
});

describe('isLearningEntry', () => {
  it('accepts valid entry', () => {
    const entry: LearningEntry = {
      key: 'valid-key',
      type: 'pattern',
      insight: 'Valid insight',
      confidence: 5,
      source: 'auto',
      ts: '2024-01-01T00:00:00Z',
    };
    expect(isLearningEntry(entry)).toBe(true);
  });

  it('rejects invalid key', () => {
    expect(isLearningEntry({ key: 'a', type: 'pattern', insight: 'Test', confidence: 5, source: 'auto', ts: '2024-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects invalid confidence', () => {
    expect(isLearningEntry({ key: 'valid-key', type: 'pattern', insight: 'Test', confidence: 15, source: 'auto', ts: '2024-01-01T00:00:00Z' })).toBe(false);
  });

  it('rejects absolute path', () => {
    expect(isLearningEntry({ key: 'valid-key', type: 'pattern', insight: 'Test', confidence: 5, source: 'auto', files: ['/absolute'], ts: '2024-01-01T00:00:00Z' })).toBe(false);
  });
});
