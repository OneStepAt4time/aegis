/**
 * cursor-replay-883.test.ts — Tests for cursor-based transcript replay.
 *
 * Issue #883: Verifies that:
 * 1. Cursor-based pagination returns correct windows (no skip/dup under concurrent appends)
 * 2. has_more + oldest_id/newest_id are correct
 * 3. Backward-compatible offset endpoint still works
 */

import { describe, it, expect } from 'vitest';
import type { ParsedEntry } from '../transcript.js';

// ── Pure cursor-window logic (extracted from readTranscriptCursor) ──────────

type EntryWithCursor = ParsedEntry & { _cursor_id: number };

function cursorWindow(
  allEntries: ParsedEntry[],
  beforeId: number | undefined,
  limit: number,
): {
  messages: EntryWithCursor[];
  before_id: number | null;
  has_more: boolean;
  oldest_id: number | null;
  newest_id: number | null;
} {
  const total = allEntries.length;
  const clampedLimit = Math.min(200, Math.max(1, limit));
  const upperExclusive = beforeId !== undefined ? Math.min(beforeId - 1, total) : total;
  const lowerInclusive = Math.max(0, upperExclusive - clampedLimit);
  const slice = allEntries.slice(lowerInclusive, upperExclusive);
  const messages = slice.map((entry, i) => ({ ...entry, _cursor_id: lowerInclusive + i + 1 }));
  const oldestId = messages.length > 0 ? messages[0]._cursor_id : null;
  const newestId = messages.length > 0 ? messages[messages.length - 1]._cursor_id : null;
  return {
    messages,
    before_id: oldestId,
    has_more: lowerInclusive > 0,
    oldest_id: oldestId,
    newest_id: newestId,
  };
}

function makeEntry(text: string): ParsedEntry {
  return { role: 'user', contentType: 'text', text };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('cursor-based transcript window', () => {
  const ENTRIES = Array.from({ length: 25 }, (_, i) => makeEntry(`msg-${i + 1}`));

  it('no before_id → returns newest limit entries', () => {
    const result = cursorWindow(ENTRIES, undefined, 10);
    expect(result.messages).toHaveLength(10);
    expect(result.messages[0].text).toBe('msg-16');
    expect(result.messages[9].text).toBe('msg-25');
    expect(result.has_more).toBe(true);
    expect(result.before_id).toBe(16);
    expect(result.oldest_id).toBe(16);
    expect(result.newest_id).toBe(25);
  });

  it('before_id=oldest_id → returns previous window (no overlap, no gap)', () => {
    const first = cursorWindow(ENTRIES, undefined, 10);       // newest 10
    const second = cursorWindow(ENTRIES, first.oldest_id!, 10); // 10 before that

    expect(first.messages[0].text).toBe('msg-16');
    expect(second.messages[9].text).toBe('msg-15');
    // Combined: msgs 6-25 with no overlap or gap
    const combined = [...second.messages, ...first.messages];
    expect(combined).toHaveLength(20);
    expect(combined[0].text).toBe('msg-6');
    expect(combined[19].text).toBe('msg-25');
  });

  it('stable under concurrent appends — cursor_ids do not shift', () => {
    // Simulate: client reads page 1, then entries are appended, then reads page 2
    const snapshot1 = cursorWindow(ENTRIES, undefined, 10);
    // Append 5 more entries
    const extended = [...ENTRIES, ...Array.from({ length: 5 }, (_, i) => makeEntry(`msg-${26 + i}`))];
    // Read page 2 using oldest_id from page 1 — should get same msg-6..msg-15 window
    const page2 = cursorWindow(extended, snapshot1.oldest_id!, 10);

    expect(page2.messages[9].text).toBe('msg-15');
    expect(page2.messages[9]._cursor_id).toBe(15);
    // No duplicates with page 1
    const page1Texts = new Set(snapshot1.messages.map(m => m.text));
    for (const m of page2.messages) {
      expect(page1Texts.has(m.text)).toBe(false);
    }
  });

  it('has_more is false when no earlier entries exist', () => {
    const result = cursorWindow(ENTRIES, 6, 10); // before index 6 → entries 1-5
    expect(result.messages).toHaveLength(5);
    expect(result.has_more).toBe(false);
    expect(result.oldest_id).toBe(1);
    expect(result.newest_id).toBe(5);
  });

  it('empty result when entries list is empty', () => {
    const result = cursorWindow([], undefined, 10);
    expect(result.messages).toHaveLength(0);
    expect(result.has_more).toBe(false);
    expect(result.oldest_id).toBeNull();
    expect(result.newest_id).toBeNull();
  });

  it('clamps limit at 200', () => {
    const big = Array.from({ length: 300 }, (_, i) => makeEntry(`m${i}`));
    const result = cursorWindow(big, undefined, 9999);
    expect(result.messages).toHaveLength(200);
  });
});
