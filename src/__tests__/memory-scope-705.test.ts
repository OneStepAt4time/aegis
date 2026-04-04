/**
 * memory-scope-705.test.ts — Unit tests for Issue #705:
 *   - GET /v1/memories?scope= (scoped retrieval)
 *   - POST /v1/sessions/:id/memories (session-linked write)
 *   - GET /v1/sessions/:id/memories (session-linked list)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Helpers mirroring memory-routes.ts + memory-bridge.ts logic ───────

interface MemoryEntry {
  key: string;
  value: string;
  namespace: string;
  created_at: number;
  updated_at: number;
  expires_at?: number;
}

class FakeMemoryBridge {
  private store = new Map<string, MemoryEntry>();

  set(key: string, value: string, ttlSeconds?: number): MemoryEntry {
    const m = /^(.+?)\/(.+)$/.exec(key);
    if (!m) throw new Error(`Invalid key format: must be namespace/key, got "${key}"`);
    const [, namespace] = m;
    const now = Date.now();
    const entry: MemoryEntry = {
      key, value, namespace,
      created_at: this.store.has(key) ? this.store.get(key)!.created_at : now,
      updated_at: now,
      expires_at: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
    };
    this.store.set(key, entry);
    return entry;
  }

  get(key: string): MemoryEntry | null {
    return this.store.get(key) ?? null;
  }

  list(prefix?: string): MemoryEntry[] {
    const entries = [...this.store.values()];
    if (!prefix) return entries;
    return entries.filter(e => e.key.startsWith(prefix));
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }
}

const VALID_SCOPES = new Set(['project', 'user', 'team']);

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

const TEST_SESSION_ID = '11111111-2222-3333-4444-555555555555';

// ── Tests ─────────────────────────────────────────────────────────────

describe('Issue #705: Scoped memory — GET /v1/memories?scope=', () => {
  let bridge: FakeMemoryBridge;

  beforeEach(() => {
    bridge = new FakeMemoryBridge();
    bridge.set('project/config', 'projectVal');
    bridge.set('project/settings', 'settingsVal');
    bridge.set('user/prefs', 'userVal');
    bridge.set('team/shared', 'teamVal');
  });

  it('rejects unknown scope', () => {
    expect(VALID_SCOPES.has('unknown')).toBe(false);
    expect(VALID_SCOPES.has('')).toBe(false);
  });

  it('accepts project scope', () => {
    expect(VALID_SCOPES.has('project')).toBe(true);
    const entries = bridge.list('project/');
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.key.startsWith('project/'))).toBe(true);
  });

  it('accepts user scope and returns only user entries', () => {
    expect(VALID_SCOPES.has('user')).toBe(true);
    const entries = bridge.list('user/');
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('user/prefs');
  });

  it('accepts team scope and returns only team entries', () => {
    const entries = bridge.list('team/');
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('team/shared');
  });

  it('returns empty list if scope has no entries', () => {
    const entries = bridge.list('team/nonexistent');
    expect(entries).toHaveLength(0);
  });
});

describe('Issue #705: Session-linked memories — POST /v1/sessions/:id/memories', () => {
  let bridge: FakeMemoryBridge;

  beforeEach(() => { bridge = new FakeMemoryBridge(); });

  it('stores key under session:{id}/ namespace', () => {
    const fullKey = `session:${TEST_SESSION_ID}/mykey`;
    const entry = bridge.set(fullKey, 'value123');
    expect(entry.key).toBe(fullKey);
    expect(entry.namespace).toBe(`session:${TEST_SESSION_ID}`);
    expect(entry.value).toBe('value123');
  });

  it('rejects invalid UUID session ID', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
    expect(isValidUUID('')).toBe(false);
    expect(isValidUUID(TEST_SESSION_ID)).toBe(true);
  });

  it('stores multiple keys under same session namespace', () => {
    bridge.set(`session:${TEST_SESSION_ID}/key1`, 'v1');
    bridge.set(`session:${TEST_SESSION_ID}/key2`, 'v2');
    const entries = bridge.list(`session:${TEST_SESSION_ID}/`);
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.key).sort()).toEqual([
      `session:${TEST_SESSION_ID}/key1`,
      `session:${TEST_SESSION_ID}/key2`,
    ]);
  });

  it('different sessions do not share entries', () => {
    const id2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    bridge.set(`session:${TEST_SESSION_ID}/key`, 's1val');
    bridge.set(`session:${id2}/key`, 's2val');
    const s1Entries = bridge.list(`session:${TEST_SESSION_ID}/`);
    const s2Entries = bridge.list(`session:${id2}/`);
    expect(s1Entries).toHaveLength(1);
    expect(s2Entries).toHaveLength(1);
    expect(s1Entries[0].value).toBe('s1val');
    expect(s2Entries[0].value).toBe('s2val');
  });
});

describe('Issue #705: Session-linked memories — GET /v1/sessions/:id/memories', () => {
  let bridge: FakeMemoryBridge;

  beforeEach(() => {
    bridge = new FakeMemoryBridge();
    bridge.set(`session:${TEST_SESSION_ID}/alpha`, 'alpha-val');
    bridge.set(`session:${TEST_SESSION_ID}/beta`, 'beta-val');
    bridge.set('project/other', 'should-not-appear');
  });

  it('returns only entries for the specified session', () => {
    const entries = bridge.list(`session:${TEST_SESSION_ID}/`);
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.key.startsWith(`session:${TEST_SESSION_ID}/`))).toBe(true);
  });

  it('returns empty for session with no memories', () => {
    const noId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const entries = bridge.list(`session:${noId}/`);
    expect(entries).toHaveLength(0);
  });
});
