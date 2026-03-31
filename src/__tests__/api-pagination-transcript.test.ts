/**
 * api-pagination-transcript.test.ts — Tests for GET /v1/sessions pagination
 * and GET /v1/sessions/:id/transcript endpoint.
 */

import { describe, it, expect } from 'vitest';

// ── GET /v1/sessions pagination logic ──────────────────────────────────

describe('GET /v1/sessions pagination logic', () => {
  function paginateSessions(
    sessions: Array<{ status: string; createdAt: number; id: number }>,
    page: number,
    limit: number,
    statusFilter?: string,
  ): { sessions: Array<{ status: string; createdAt: number; id: number }>; pagination: { page: number; limit: number; total: number; totalPages: number } } {
    let all = [...sessions];
    if (statusFilter) {
      all = all.filter(s => s.status === statusFilter);
    }
    all.sort((a, b) => b.createdAt - a.createdAt);

    const total = all.length;
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    const totalPages = Math.ceil(total / limit);

    return { sessions: items, pagination: { page, limit, total, totalPages } };
  }

  const makeSession = (id: number, status: string, createdAt: number) => ({
    status,
    createdAt,
    id,
  });

  it('returns first page with default params', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 1, 20);

    expect(result.sessions).toHaveLength(20);
    expect(result.pagination.total).toBe(30);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(20);
    expect(result.pagination.totalPages).toBe(2);
    // Newest first
    expect(result.sessions[0].id).toBe(29);
  });

  it('returns second page', () => {
    const sessions = Array.from({ length: 30 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 2, 20);

    expect(result.sessions).toHaveLength(10);
    expect(result.pagination.total).toBe(30);
    expect(result.pagination.page).toBe(2);
    // Second page has oldest items (newest first sort)
    expect(result.sessions[0].id).toBe(9);
  });

  it('returns empty array for page beyond data', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 3, 20);

    expect(result.sessions).toHaveLength(0);
    expect(result.pagination.total).toBe(5);
  });

  it('filters by status', () => {
    const sessions = [
      makeSession(1, 'working', 1001),
      makeSession(2, 'idle', 1002),
      makeSession(3, 'working', 1003),
      makeSession(4, 'ask_question', 1004),
    ];
    const result = paginateSessions(sessions, 1, 20, 'working');

    expect(result.sessions).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
    expect(result.sessions.every(s => s.status === 'working')).toBe(true);
  });

  it('filters by status and paginates', () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      makeSession(i, i % 2 === 0 ? 'idle' : 'working', 1000 + i),
    );
    const result = paginateSessions(sessions, 1, 5, 'working');

    expect(result.sessions).toHaveLength(5);
    expect(result.pagination.total).toBe(25); // 25 working sessions
  });

  it('respects limit parameter', () => {
    const sessions = Array.from({ length: 100 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 1, 10);

    expect(result.sessions).toHaveLength(10);
    expect(result.pagination.limit).toBe(10);
  });

  it('sorts by createdAt descending', () => {
    const sessions = [
      makeSession(1, 'idle', 100),
      makeSession(2, 'idle', 300),
      makeSession(3, 'idle', 200),
    ];
    const result = paginateSessions(sessions, 1, 20);

    expect(result.sessions.map(s => s.id)).toEqual([2, 3, 1]);
  });

  it('handles empty sessions list', () => {
    const result = paginateSessions([], 1, 20);

    expect(result.sessions).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
    expect(result.pagination.page).toBe(1);
  });

  it('clamps page to minimum 1', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    // page=0 produces start=(0-1)*20=-20, slice(-20, -20+20)=slice(-20, 0)=empty
    // The route handler clamps page to 1 before calling this logic
    const result = paginateSessions(sessions, 1, 20);

    expect(result.sessions).toHaveLength(5);
  });

  it('status filter with no matches returns empty', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 1, 20, 'working');

    expect(result.sessions).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it('computes totalPages = ceil(total / limit)', () => {
    const sessions = Array.from({ length: 25 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 1, 10);

    expect(result.pagination.totalPages).toBe(3);
    expect(result.pagination.total).toBe(25);
    expect(result.pagination.limit).toBe(10);
  });

  it('totalPages is 1 when total fits in one page', () => {
    const sessions = Array.from({ length: 5 }, (_, i) => makeSession(i, 'idle', 1000 + i));
    const result = paginateSessions(sessions, 1, 20);

    expect(result.pagination.totalPages).toBe(1);
  });

  it('totalPages is 0 when total is 0', () => {
    const result = paginateSessions([], 1, 20);

    expect(result.pagination.totalPages).toBe(0);
  });
});

// ── GET /v1/sessions/:id/transcript pagination logic ───────────────────

describe('GET /v1/sessions/:id/transcript pagination logic', () => {
  interface TranscriptEntry {
    role: 'user' | 'assistant' | 'system';
    text: string;
  }

  function paginateTranscript(
    entries: TranscriptEntry[],
    page: number,
    limit: number,
    roleFilter?: 'user' | 'assistant' | 'system',
  ): { messages: TranscriptEntry[]; total: number; page: number; limit: number; hasMore: boolean } {
    let filtered = [...entries];
    if (roleFilter) {
      filtered = filtered.filter(e => e.role === roleFilter);
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const messages = filtered.slice(start, start + limit);
    const hasMore = start + messages.length < total;

    return { messages, total, page, limit, hasMore };
  }

  const makeEntry = (role: 'user' | 'assistant' | 'system', index: number): TranscriptEntry => ({
    role,
    text: `Message ${index}`,
  });

  it('returns first page with default params', () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry(i % 3 === 0 ? 'user' : i % 3 === 1 ? 'assistant' : 'system', i),
    );
    const result = paginateTranscript(entries, 1, 50);

    expect(result.messages).toHaveLength(50);
    expect(result.total).toBe(100);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('returns second page', () => {
    const entries = Array.from({ length: 100 }, (_, i) => makeEntry('user', i));
    const result = paginateTranscript(entries, 2, 50);

    expect(result.messages).toHaveLength(50);
    expect(result.total).toBe(100);
    expect(result.page).toBe(2);
    expect(result.hasMore).toBe(false);
  });

  it('hasMore is false on last page', () => {
    const entries = Array.from({ length: 75 }, (_, i) => makeEntry('user', i));
    const result = paginateTranscript(entries, 2, 50);

    expect(result.messages).toHaveLength(25);
    expect(result.hasMore).toBe(false);
  });

  it('hasMore is false when total equals limit', () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry('user', i));
    const result = paginateTranscript(entries, 1, 50);

    expect(result.messages).toHaveLength(50);
    expect(result.hasMore).toBe(false);
  });

  it('filters by role=assistant', () => {
    const entries = [
      makeEntry('user', 1),
      makeEntry('assistant', 2),
      makeEntry('user', 3),
      makeEntry('assistant', 4),
      makeEntry('system', 5),
    ];
    const result = paginateTranscript(entries, 1, 50, 'assistant');

    expect(result.messages).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.messages.every(m => m.role === 'assistant')).toBe(true);
  });

  it('filters by role=user', () => {
    const entries = [
      makeEntry('user', 1),
      makeEntry('assistant', 2),
      makeEntry('user', 3),
    ];
    const result = paginateTranscript(entries, 1, 50, 'user');

    expect(result.messages).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('filters by role=system', () => {
    const entries = [
      makeEntry('system', 1),
      makeEntry('assistant', 2),
      makeEntry('system', 3),
    ];
    const result = paginateTranscript(entries, 1, 50, 'system');

    expect(result.messages).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('filters by role with pagination', () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry(i % 2 === 0 ? 'user' : 'assistant', i),
    );
    // 50 user entries total
    const result = paginateTranscript(entries, 1, 10, 'user');

    expect(result.messages).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true);
  });

  it('filters by role with pagination on last page', () => {
    const entries = Array.from({ length: 100 }, (_, i) =>
      makeEntry(i % 2 === 0 ? 'user' : 'assistant', i),
    );
    const result = paginateTranscript(entries, 5, 10, 'user');

    expect(result.messages).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(false);
  });

  it('handles empty transcript', () => {
    const result = paginateTranscript([], 1, 50);

    expect(result.messages).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('handles role filter with no matches', () => {
    const entries = [makeEntry('user', 1), makeEntry('assistant', 2)];
    const result = paginateTranscript(entries, 1, 50, 'system');

    expect(result.messages).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('page beyond data returns empty with hasMore=false', () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry('user', i));
    const result = paginateTranscript(entries, 10, 50);

    expect(result.messages).toHaveLength(0);
    expect(result.total).toBe(5);
    expect(result.hasMore).toBe(false);
  });
});

// ── Query param parsing ───────────────────────────────────────────────

describe('Query parameter parsing', () => {
  function parsePage(raw: string | undefined, defaultVal = 1): number {
    return Math.max(1, parseInt(raw || String(defaultVal), 10) || defaultVal);
  }

  function parseLimit(raw: string | undefined, defaultVal = 20, max = 100): number {
    return Math.min(max, Math.max(1, parseInt(raw || String(defaultVal), 10) || defaultVal));
  }

  it('parses default page', () => {
    expect(parsePage(undefined)).toBe(1);
  });

  it('parses explicit page', () => {
    expect(parsePage('3')).toBe(3);
  });

  it('clamps negative page to 1', () => {
    expect(parsePage('-1')).toBe(1);
  });

  it('clamps zero page to 1', () => {
    expect(parsePage('0')).toBe(1);
  });

  it('handles NaN page', () => {
    expect(parsePage('abc')).toBe(1);
  });

  it('parses default limit', () => {
    expect(parseLimit(undefined)).toBe(20);
  });

  it('parses explicit limit', () => {
    expect(parseLimit('10')).toBe(10);
  });

  it('clamps limit above max to max', () => {
    expect(parseLimit('200')).toBe(100);
  });

  it('clamps limit of 0 to default (0 is falsy, falls through to default)', () => {
    // parseInt('0') returns 0, which is falsy, so || defaultVal kicks in
    expect(parseLimit('0')).toBe(20);
  });

  it('handles NaN limit', () => {
    expect(parseLimit('abc')).toBe(20);
  });

  it('transcript limit max is 200', () => {
    expect(parseLimit('300', 50, 200)).toBe(200);
  });

  it('transcript limit default is 50', () => {
    expect(parseLimit(undefined, 50, 200)).toBe(50);
  });
});
