/**
 * batch-session-ops-754.test.ts — Unit tests for Issue #754:
 *   - GET /v1/sessions ?project= filter
 *   - GET /v1/sessions/stats
 *   - DELETE /v1/sessions/batch
 */

import { describe, it, expect } from 'vitest';

// ── Helpers mirroring server.ts logic ──────────────────────────────────

type UIState = 'idle' | 'working' | 'error' | 'unknown';

interface FakeSession {
  id: string;
  workDir: string;
  status: UIState;
  createdAt: number;
}

function makeSession(id: string, workDir: string, status: UIState, createdAt = Date.now()): FakeSession {
  return { id, workDir, status, createdAt };
}

// Mirror the list+filter+project logic from server.ts
function listSessions(
  sessions: FakeSession[],
  statusFilter?: string,
  projectFilter?: string,
  page = 1,
  limit = 20,
): { sessions: FakeSession[]; pagination: { page: number; limit: number; total: number; totalPages: number } } {
  let all = [...sessions];
  if (statusFilter) all = all.filter(s => s.status === statusFilter);
  if (projectFilter) {
    const lower = projectFilter.toLowerCase();
    all = all.filter(s => s.workDir.toLowerCase().includes(lower));
  }
  all.sort((a, b) => b.createdAt - a.createdAt);
  const total = all.length;
  const start = (page - 1) * limit;
  const items = all.slice(start, start + limit);
  return { sessions: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// Mirror the stats computation from server.ts
function computeStats(
  sessions: FakeSession[],
  totalCreated: number,
  totalCompleted: number,
  totalFailed: number,
): { active: number; byStatus: Record<string, number>; totalCreated: number; totalCompleted: number; totalFailed: number } {
  const byStatus: Record<string, number> = {};
  for (const s of sessions) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
  }
  return { active: sessions.length, byStatus, totalCreated, totalCompleted, totalFailed };
}

// Mirror the bulk-delete logic from server.ts
function batchDelete(
  sessions: FakeSession[],
  ids?: string[],
  status?: UIState,
): { remaining: FakeSession[]; deleted: number; notFound: string[]; errors: string[] } {
  const targets = new Set<string>(ids ?? []);
  if (status) {
    for (const s of sessions) {
      if (s.status === status) targets.add(s.id);
    }
  }
  const notFound: string[] = [];
  const toDelete = new Set<string>();
  for (const id of targets) {
    const found = sessions.find(s => s.id === id);
    if (!found) {
      notFound.push(id);
    } else {
      toDelete.add(id);
    }
  }
  const remaining = sessions.filter(s => !toDelete.has(s.id));
  return { remaining, deleted: toDelete.size, notFound, errors: [] };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Issue #754: ?project= filter on GET /v1/sessions', () => {
  const sessions = [
    makeSession('a1', '/home/user/aegis', 'idle', 1000),
    makeSession('a2', '/home/user/other-project', 'working', 1001),
    makeSession('a3', '/home/user/aegis/subdir', 'error', 1002),
    makeSession('a4', '/tmp/scratch', 'idle', 1003),
  ];

  it('returns all sessions when no project filter', () => {
    const result = listSessions(sessions);
    expect(result.sessions).toHaveLength(4);
  });

  it('filters sessions by workDir substring (case-insensitive)', () => {
    const result = listSessions(sessions, undefined, 'aegis');
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.every(s => s.workDir.toLowerCase().includes('aegis'))).toBe(true);
  });

  it('combines status and project filter (AND)', () => {
    const result = listSessions(sessions, 'idle', 'aegis');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].id).toBe('a1');
  });

  it('returns empty when no sessions match project filter', () => {
    const result = listSessions(sessions, undefined, 'nonexistent');
    expect(result.sessions).toHaveLength(0);
    expect(result.pagination.total).toBe(0);
  });

  it('is case-insensitive', () => {
    const result = listSessions(sessions, undefined, 'AEGIS');
    expect(result.sessions).toHaveLength(2);
  });
});

describe('Issue #754: GET /v1/sessions/stats', () => {
  const sessions = [
    makeSession('s1', '/work', 'idle'),
    makeSession('s2', '/work', 'working'),
    makeSession('s3', '/work', 'working'),
    makeSession('s4', '/work', 'error'),
  ];

  it('counts active sessions correctly', () => {
    const stats = computeStats(sessions, 10, 3, 1);
    expect(stats.active).toBe(4);
  });

  it('groups sessions by status', () => {
    const stats = computeStats(sessions, 10, 3, 1);
    expect(stats.byStatus['idle']).toBe(1);
    expect(stats.byStatus['working']).toBe(2);
    expect(stats.byStatus['error']).toBe(1);
  });

  it('passes through global lifetime counters', () => {
    const stats = computeStats(sessions, 42, 15, 3);
    expect(stats.totalCreated).toBe(42);
    expect(stats.totalCompleted).toBe(15);
    expect(stats.totalFailed).toBe(3);
  });

  it('returns empty byStatus for no active sessions', () => {
    const stats = computeStats([], 5, 5, 0);
    expect(stats.active).toBe(0);
    expect(Object.keys(stats.byStatus)).toHaveLength(0);
  });
});

describe('Issue #754: DELETE /v1/sessions/batch by IDs', () => {
  function makeSessions(): FakeSession[] {
    return [
      makeSession('id-1', '/work', 'idle'),
      makeSession('id-2', '/work', 'working'),
      makeSession('id-3', '/work', 'idle'),
    ];
  }

  it('deletes sessions by explicit ID list', () => {
    const ss = makeSessions();
    const result = batchDelete(ss, ['id-1', 'id-3']);
    expect(result.deleted).toBe(2);
    expect(result.remaining.map(s => s.id)).toEqual(['id-2']);
    expect(result.notFound).toHaveLength(0);
  });

  it('reports notFound for unknown IDs', () => {
    const ss = makeSessions();
    const result = batchDelete(ss, ['id-1', 'does-not-exist']);
    expect(result.deleted).toBe(1);
    expect(result.notFound).toEqual(['does-not-exist']);
  });

  it('deletes zero sessions when all IDs are unknown', () => {
    const ss = makeSessions();
    const result = batchDelete(ss, ['x', 'y']);
    expect(result.deleted).toBe(0);
    expect(result.notFound).toHaveLength(2);
    expect(result.remaining).toHaveLength(3);
  });
});

describe('Issue #754: DELETE /v1/sessions/batch by status', () => {
  function makeSessions(): FakeSession[] {
    return [
      makeSession('id-1', '/work', 'idle'),
      makeSession('id-2', '/work', 'error'),
      makeSession('id-3', '/work', 'idle'),
      makeSession('id-4', '/work', 'working'),
    ];
  }

  it('deletes all sessions with matching status', () => {
    const ss = makeSessions();
    const result = batchDelete(ss, undefined, 'idle');
    expect(result.deleted).toBe(2);
    expect(result.remaining.map(s => s.id).sort()).toEqual(['id-2', 'id-4']);
  });

  it('combines IDs and status (union)', () => {
    const ss = makeSessions();
    // id-2 (error) + all idle (id-1, id-3) → 3 deleted
    const result = batchDelete(ss, ['id-2'], 'idle');
    expect(result.deleted).toBe(3);
    expect(result.remaining.map(s => s.id)).toEqual(['id-4']);
  });

  it('handles no sessions matching the status gracefully', () => {
    const ss = makeSessions();
    const result = batchDelete(ss, undefined, 'unknown');
    expect(result.deleted).toBe(0);
    expect(result.remaining).toHaveLength(4);
  });
});
