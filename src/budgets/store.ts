/**
 * budgets/store.ts — File-backed budget storage.
 *
 * Persists budgets to ~/.aegis/budgets.json and evaluation state to
 * ~/.aegis/budgets-state.json using atomic writes and a mutex.
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Mutex } from 'async-mutex';
import crypto from 'node:crypto';
import type { Budget, BudgetsStateFile, BudgetEvalState } from './types.js';
import { StructuredLogger } from '../logger.js';

const log = new StructuredLogger();

interface BudgetsFile {
  version: 1;
  budgets: Budget[];
}

export class BudgetStore {
  private readonly budgetsFile: string;
  private readonly stateFile: string;
  private readonly budgetsMutex = new Mutex();
  private readonly stateMutex = new Mutex();

  constructor(stateDir: string) {
    this.budgetsFile = join(stateDir, 'budgets.json');
    this.stateFile = join(stateDir, 'budgets-state.json');
  }

  // ── Budgets CRUD ─────────────────────────────────────────────────

  async listBudgets(filters?: { keyId?: string | null; enabled?: boolean }): Promise<Budget[]> {
    return this.budgetsMutex.runExclusive(async () => {
      const { budgets } = await this.loadBudgets();
      let result = budgets;
      if (filters?.keyId !== undefined) {
        result = result.filter(b => b.keyId === filters.keyId);
      }
      if (filters?.enabled !== undefined) {
        result = result.filter(b => b.enabled === filters.enabled);
      }
      return result;
    });
  }

  async getBudget(id: string): Promise<Budget | undefined> {
    return this.budgetsMutex.runExclusive(async () => {
      const { budgets } = await this.loadBudgets();
      return budgets.find(b => b.id === id);
    });
  }

  async createBudget(data: Omit<Budget, 'id' | 'createdAt' | 'updatedAt' | 'lastEvaluatedAt'>): Promise<Budget> {
    return this.budgetsMutex.runExclusive(async () => {
      const file = await this.loadBudgets();
      const now = new Date().toISOString();
      const budget: Budget = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        lastEvaluatedAt: null,
      };
      file.budgets.push(budget);
      await this.saveBudgets(file);
      log.info({ component: 'budget-store', operation: 'created', attributes: { budgetId: budget.id } });
      return budget;
    });
  }

  async updateBudget(id: string, patch: Partial<Omit<Budget, 'id' | 'createdAt'>>): Promise<Budget | undefined> {
    return this.budgetsMutex.runExclusive(async () => {
      const file = await this.loadBudgets();
      const idx = file.budgets.findIndex(b => b.id === id);
      if (idx === -1) return undefined;

      const existing = file.budgets[idx];
      const updated: Budget = {
        ...existing,
        ...patch,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      // Reset lastEvaluatedAt when re-enabled
      if (patch.enabled === true && existing.enabled === false) {
        updated.lastEvaluatedAt = null;
      }
      file.budgets[idx] = updated;
      await this.saveBudgets(file);
      log.info({ component: 'budget-store', operation: 'updated', attributes: { budgetId: id } });
      return updated;
    });
  }

  async deleteBudget(id: string): Promise<boolean> {
    return this.budgetsMutex.runExclusive(async () => {
      const file = await this.loadBudgets();
      const before = file.budgets.length;
      file.budgets = file.budgets.filter(b => b.id !== id);
      if (file.budgets.length === before) return false;
      await this.saveBudgets(file);
      log.info({ component: 'budget-store', operation: 'deleted', attributes: { budgetId: id } });
      return true;
    });
  }

  async touchLastEvaluated(id: string): Promise<void> {
    await this.updateBudget(id, { lastEvaluatedAt: new Date().toISOString() });
  }

  // ── Evaluation state ─────────────────────────────────────────────

  async getEvalState(budgetId: string): Promise<BudgetEvalState | undefined> {
    return this.stateMutex.runExclusive(async () => {
      const file = await this.loadState();
      return file.evaluations[budgetId];
    });
  }

  async setEvalState(budgetId: string, state: BudgetEvalState): Promise<void> {
    await this.stateMutex.runExclusive(async () => {
      const file = await this.loadState();
      file.evaluations[budgetId] = state;
      await this.saveState(file);
    });
  }

  async clearEvalState(budgetId: string): Promise<void> {
    await this.stateMutex.runExclusive(async () => {
      const file = await this.loadState();
      delete file.evaluations[budgetId];
      await this.saveState(file);
    });
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private async loadBudgets(): Promise<BudgetsFile> {
    if (existsSync(this.budgetsFile)) {
      try {
        const raw = await readFile(this.budgetsFile, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (this.isValidBudgetsFile(parsed)) return parsed;
      } catch {
        log.warn({ component: 'budget-store', operation: 'loadFailed', attributes: { file: this.budgetsFile } });
      }
    }
    return { version: 1, budgets: [] };
  }

  private async saveBudgets(file: BudgetsFile): Promise<void> {
    await this.atomicWrite(this.budgetsFile, file);
  }

  private async loadState(): Promise<BudgetsStateFile> {
    if (existsSync(this.stateFile)) {
      try {
        const raw = await readFile(this.stateFile, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        if (this.isValidStateFile(parsed)) return parsed;
      } catch {
        log.warn({ component: 'budget-store', operation: 'loadStateFailed', attributes: { file: this.stateFile } });
      }
    }
    return { version: 1, evaluations: {} };
  }

  private async saveState(file: BudgetsStateFile): Promise<void> {
    await this.atomicWrite(this.stateFile, file);
  }

  private async atomicWrite(filePath: string, data: unknown): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(tmp, filePath);
  }

  private isValidBudgetsFile(data: unknown): data is BudgetsFile {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return obj.version === 1 && Array.isArray(obj.budgets);
  }

  private isValidStateFile(data: unknown): data is BudgetsStateFile {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return obj.version === 1 && typeof obj.evaluations === 'object' && obj.evaluations !== null;
  }
}
