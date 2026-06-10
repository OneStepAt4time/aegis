import { describe, it, expect, vi } from 'vitest';
import { MemoryAcpSessionStore } from '../services/acp/local-storage/memory-session-store.js';
import { AcpDurableIdentityError } from '../services/acp/errors.js';
import type { AcpSessionRecord, AcpSessionScope } from '../services/acp/types.js';

const scope: AcpSessionScope = { tenantId: 't1', ownerKeyId: 'o1' };

const baseRecord: AcpSessionRecord = {
  id: 'sess-1',
  tenantId: 't1',
  ownerKeyId: 'o1',
  conversationId: 'conv-1',
  transcriptId: 'trans-1',
  acpAgentSessionId: 'acp-1',
  claudeSessionId: 'claude-1',
  currentBackendRunId: 'run-1',
  status: 'running',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('MemoryAcpSessionStore', () => {
  it('creates a session', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(baseRecord);
    const found = await store.get('sess-1', scope);
    expect(found).not.toBeNull();
    expect(found!.id).toBe('sess-1');
  });

  it('throws on duplicate create', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(baseRecord);
    await expect(store.create(baseRecord)).rejects.toThrow(AcpDurableIdentityError);
  });

  it('returns null for missing session', async () => {
    const store = new MemoryAcpSessionStore();
    const found = await store.get('missing', scope);
    expect(found).toBeNull();
  });

  it('updates a session', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(baseRecord);
    const updated = await store.update(
      { ...baseRecord, status: 'closed', updatedAt: Date.now() + 1 },
      scope
    );
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('closed');
  });

  it('returns null when updating missing session', async () => {
    const store = new MemoryAcpSessionStore();
    const updated = await store.update(baseRecord, scope);
    expect(updated).toBeNull();
  });

  it('throws on scope mismatch during update', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(baseRecord);
    await expect(
      store.update({ ...baseRecord, tenantId: 't2' }, scope)
    ).rejects.toThrow('record scope does not match');
  });

  it('lists sessions with filtering and sorting', async () => {
    const store = new MemoryAcpSessionStore();
    const now = Date.now();
    await store.create({ ...baseRecord, id: 'sess-1', updatedAt: now });
    await store.create({ ...baseRecord, id: 'sess-2', updatedAt: now + 1, status: 'closed' });
    await store.create({ ...baseRecord, id: 'sess-3', updatedAt: now + 2 });

    const all = await store.list({ ...scope });
    expect(all).toHaveLength(3);
    expect(all[0].id).toBe('sess-3'); // sorted by updatedAt desc

    const activeOnly = await store.list({ ...scope, statuses: ['running'] });
    expect(activeOnly).toHaveLength(2);

    const recent = await store.list({ ...scope, updatedAfter: now + 1 });
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('sess-3');
  });

  it('calls onMutation hook on create and update', async () => {
    const onMutation = vi.fn();
    const store = new MemoryAcpSessionStore(undefined, onMutation);
    await store.create(baseRecord);
    expect(onMutation).toHaveBeenCalledTimes(1);
    await store.update({ ...baseRecord, updatedAt: Date.now() + 1 }, scope);
    expect(onMutation).toHaveBeenCalledTimes(2);
  });

  it('replaceState swaps internal state', async () => {
    const store = new MemoryAcpSessionStore();
    await store.create(baseRecord);
    const newState = { sessions: [], events: [], pauseInterventions: [], profiles: [] };
    store.replaceState(newState as any);
    const found = await store.get('sess-1', scope);
    expect(found).toBeNull();
  });
});
