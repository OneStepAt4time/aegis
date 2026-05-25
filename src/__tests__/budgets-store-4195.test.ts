/**
 * budgets-store-4195.test.ts — BudgetStore persistence tests.
 *
 * Tests CRUD operations, atomic writes, and eval-state management.
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { BudgetStore } from '../budgets/store.js';
import type { Budget } from '../budgets/types.js';

function tempDir(): string {
  return join(tmpdir(), `aegis-budgets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function makeBudget(overrides: Partial<Omit<Budget, 'id' | 'createdAt' | 'updatedAt' | 'lastEvaluatedAt'>> = {}): Omit<Budget, 'id' | 'createdAt' | 'updatedAt' | 'lastEvaluatedAt'> {
  return {
    name: 'Test Budget',
    keyId: null,
    limitUsd: 50,
    thresholds: [50, 80, 100],
    window: { kind: 'rolling', hours: 168 },
    channels: [{ type: 'log' }],
    enabled: true,
    ...overrides,
  };
}

describe('BudgetStore — CRUD', () => {
  let stateDir: string;
  let store: BudgetStore;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('creates a budget with generated id and timestamps', async () => {
    const budget = await store.createBudget(makeBudget());
    expect(budget.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(budget.createdAt).toBeTruthy();
    expect(budget.updatedAt).toBeTruthy();
    expect(budget.lastEvaluatedAt).toBeNull();
    expect(budget.name).toBe('Test Budget');
  });

  it('persists budgets across store instances', async () => {
    const created = await store.createBudget(makeBudget({ name: 'Persistent Budget' }));

    const store2 = new BudgetStore(stateDir);
    const found = await store2.getBudget(created.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe('Persistent Budget');
  });

  it('listBudgets returns all budgets when no filters', async () => {
    await store.createBudget(makeBudget({ name: 'Budget A' }));
    await store.createBudget(makeBudget({ name: 'Budget B' }));
    const list = await store.listBudgets();
    expect(list).toHaveLength(2);
  });

  it('listBudgets filters by enabled', async () => {
    await store.createBudget(makeBudget({ name: 'Active', enabled: true }));
    await store.createBudget(makeBudget({ name: 'Inactive', enabled: false }));

    const active = await store.listBudgets({ enabled: true });
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Active');

    const inactive = await store.listBudgets({ enabled: false });
    expect(inactive).toHaveLength(1);
    expect(inactive[0].name).toBe('Inactive');
  });

  it('listBudgets filters by keyId', async () => {
    await store.createBudget(makeBudget({ name: 'Global', keyId: null }));
    await store.createBudget(makeBudget({ name: 'Scoped', keyId: 'key-123' }));

    const global = await store.listBudgets({ keyId: null });
    expect(global).toHaveLength(1);
    expect(global[0].name).toBe('Global');

    const scoped = await store.listBudgets({ keyId: 'key-123' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].name).toBe('Scoped');
  });

  it('getBudget returns undefined for unknown id', async () => {
    const result = await store.getBudget('nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('updateBudget changes fields and bumps updatedAt', async () => {
    const original = await store.createBudget(makeBudget());
    const before = original.updatedAt;

    await new Promise(r => setTimeout(r, 2));
    const updated = await store.updateBudget(original.id, { limitUsd: 100, name: 'Updated' });

    expect(updated).toBeDefined();
    expect(updated?.limitUsd).toBe(100);
    expect(updated?.name).toBe('Updated');
    expect(updated?.id).toBe(original.id);
    expect(updated?.createdAt).toBe(original.createdAt);
    expect(updated?.updatedAt).not.toBe(before);
  });

  it('updateBudget resets lastEvaluatedAt when re-enabling', async () => {
    const b = await store.createBudget(makeBudget({ enabled: false }));
    await store.touchLastEvaluated(b.id);

    const disabled = await store.getBudget(b.id);
    expect(disabled?.lastEvaluatedAt).toBeTruthy();

    const reenabled = await store.updateBudget(b.id, { enabled: true });
    expect(reenabled?.lastEvaluatedAt).toBeNull();
  });

  it('updateBudget returns undefined for missing id', async () => {
    const result = await store.updateBudget('nonexistent', { limitUsd: 99 });
    expect(result).toBeUndefined();
  });

  it('deleteBudget removes and returns true', async () => {
    const budget = await store.createBudget(makeBudget());
    const deleted = await store.deleteBudget(budget.id);
    expect(deleted).toBe(true);

    const found = await store.getBudget(budget.id);
    expect(found).toBeUndefined();
  });

  it('deleteBudget returns false for unknown id', async () => {
    const result = await store.deleteBudget('nonexistent');
    expect(result).toBe(false);
  });

  it('touchLastEvaluated sets lastEvaluatedAt', async () => {
    const budget = await store.createBudget(makeBudget());
    expect(budget.lastEvaluatedAt).toBeNull();

    await store.touchLastEvaluated(budget.id);
    const updated = await store.getBudget(budget.id);
    expect(updated?.lastEvaluatedAt).toBeTruthy();
  });
});

describe('BudgetStore — Eval state', () => {
  let stateDir: string;
  let store: BudgetStore;

  beforeEach(() => {
    stateDir = tempDir();
    store = new BudgetStore(stateDir);
  });

  afterEach(async () => {
    try { await rm(stateDir, { recursive: true }); } catch { /* ignore */ }
  });

  it('getEvalState returns undefined when none exists', async () => {
    const result = await store.getEvalState('budget-1');
    expect(result).toBeUndefined();
  });

  it('setEvalState and getEvalState round-trip', async () => {
    const state = {
      windowStart: '2026-05-18T00:00:00.000Z',
      firedThresholds: [50, 80],
      lastAlertAt: '2026-05-20T10:00:00.000Z',
    };
    await store.setEvalState('budget-1', state);

    const retrieved = await store.getEvalState('budget-1');
    expect(retrieved).toEqual(state);
  });

  it('clearEvalState removes the entry', async () => {
    await store.setEvalState('budget-1', {
      windowStart: '2026-05-18T00:00:00.000Z',
      firedThresholds: [50],
      lastAlertAt: null,
    });

    await store.clearEvalState('budget-1');
    const result = await store.getEvalState('budget-1');
    expect(result).toBeUndefined();
  });

  it('persists eval state across store instances', async () => {
    await store.setEvalState('budget-abc', {
      windowStart: '2026-05-18T00:00:00.000Z',
      firedThresholds: [100],
      lastAlertAt: null,
    });

    const store2 = new BudgetStore(stateDir);
    const state = await store2.getEvalState('budget-abc');
    expect(state?.firedThresholds).toEqual([100]);
  });

  it('returns empty state for missing file', async () => {
    const emptyStore = new BudgetStore(tempDir());
    const budgets = await emptyStore.listBudgets();
    expect(budgets).toHaveLength(0);
  });
});
