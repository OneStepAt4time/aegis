/**
 * budgets/timer.ts — Periodic budget evaluation timer.
 *
 * Checks every N minutes (default 5) whether any enabled budgets exist,
 * and if so, runs evaluateAll(). Timer only fires when work is needed.
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import type { BudgetEvaluator } from './evaluator.js';
import type { BudgetStore } from './store.js';
import { StructuredLogger } from '../logger.js';

const log = new StructuredLogger();

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

export class BudgetTimer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(
    private readonly evaluator: BudgetEvaluator,
    private readonly store: BudgetStore,
    intervalMs?: number,
  ) {
    const raw = intervalMs ?? DEFAULT_INTERVAL_MS;
    this.intervalMs = Math.max(raw, MIN_INTERVAL_MS);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Allow process to exit even if timer is active
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    log.info({ component: 'budget-timer', operation: 'started', attributes: { intervalMs: this.intervalMs } });
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      log.info({ component: 'budget-timer', operation: 'stopped' });
    }
  }

  private async tick(): Promise<void> {
    try {
      const enabled = await this.store.listBudgets({ enabled: true });
      if (enabled.length === 0) return;
      await this.evaluator.evaluateAll();
    } catch (err) {
      log.error({ component: 'budget-timer', operation: 'tickFailed', attributes: { error: String(err) } });
    }
  }
}
