/**
 * budgets/evaluator.ts — Budget evaluation engine.
 *
 * Reads MeteringService records within the budget's time window,
 * calculates current spend, checks thresholds, deduplicates alerts,
 * and dispatches notifications.
 *
 * Issue #4195: Cost Alerts — /v1/budgets API backend.
 */

import type { Budget, BudgetEvalState, BudgetEvaluationResult } from './types.js';
import type { BudgetStore } from './store.js';
import type { BudgetNotifier } from './notifications.js';
import type { MeteringService } from '../metering.js';
import { StructuredLogger } from '../logger.js';

const log = new StructuredLogger();

export class BudgetEvaluator {
  constructor(
    private readonly store: BudgetStore,
    private readonly metering: MeteringService,
    private readonly notifier: BudgetNotifier,
  ) {}

  /** Evaluate a single budget. Returns evaluation result. */
  async evaluate(budget: Budget): Promise<BudgetEvaluationResult> {
    const now = new Date();
    const { windowStart, windowEnd } = this.calcWindow(budget, now);

    const summary = this.metering.getUsageSummary({
      from: windowStart,
      to: windowEnd,
      ...(budget.keyId !== null ? { keyId: budget.keyId } : {}),
    });
    const currentSpendUsd = summary.totalCostUsd;
    const percentUsed = budget.limitUsd > 0
      ? Math.round((currentSpendUsd / budget.limitUsd) * 10000) / 100
      : 0;

    log.info({
      component: 'budget-evaluator',
      operation: 'budgetEvaluated',
      attributes: {
        budgetId: budget.id,
        currentSpendUsd,
        percentUsed,
        windowStart,
        windowEnd,
      },
    });

    const evalState = await this.store.getEvalState(budget.id);
    // Truncate to second precision for window comparison (avoids sub-second mismatches)
    const newWindowStart = windowStart.replace(/\.\d{3}Z$/, 'Z');

    // Detect window rollover — reset fired thresholds on new window
    const isNewWindow = !evalState || evalState.windowStart !== newWindowStart;
    const firedThresholds: number[] = isNewWindow ? [] : [...evalState.firedThresholds];

    const triggeredThresholds: number[] = [];
    let alertsSent = 0;

    for (const threshold of budget.thresholds) {
      if (percentUsed >= threshold && !firedThresholds.includes(threshold)) {
        firedThresholds.push(threshold);
        triggeredThresholds.push(threshold);

        const event = threshold >= 100 ? 'thresholdExceeded' : 'thresholdApproaching';
        log.info({
          component: 'budget-evaluator',
          operation: event,
          attributes: { budgetId: budget.id, threshold, currentSpendUsd, limitUsd: budget.limitUsd },
        });

        for (const channel of budget.channels) {
          try {
            await this.notifier.sendAlert(
              { budget, threshold, currentSpendUsd, windowStart, windowEnd },
              channel,
            );
            alertsSent++;
            log.info({
              component: 'budget-evaluator',
              operation: 'alertSent',
              attributes: { budgetId: budget.id, threshold, channel: channel.type, success: true },
            });
          } catch (err) {
            log.error({
              component: 'budget-evaluator',
              operation: 'alertFailed',
              attributes: { budgetId: budget.id, threshold, channel: channel.type, error: String(err) },
            });
          }
        }
      }
    }

    const updatedState: BudgetEvalState = {
      windowStart: newWindowStart,
      firedThresholds,
      lastAlertAt: alertsSent > 0 ? now.toISOString() : (evalState?.lastAlertAt ?? null),
    };
    await this.store.setEvalState(budget.id, updatedState);
    await this.store.touchLastEvaluated(budget.id);

    return {
      budgetId: budget.id,
      windowStart,
      windowEnd,
      currentSpendUsd,
      limitUsd: budget.limitUsd,
      percentUsed,
      triggeredThresholds,
      alertsSent,
    };
  }

  /** Evaluate all enabled budgets. */
  async evaluateAll(): Promise<void> {
    const budgets = await this.store.listBudgets({ enabled: true });
    for (const budget of budgets) {
      try {
        await this.evaluate(budget);
      } catch (err) {
        log.error({
          component: 'budget-evaluator',
          operation: 'evaluateAllFailed',
          attributes: { budgetId: budget.id, error: String(err) },
        });
      }
    }
  }

  /**
   * Calculate window start/end for a budget.
   *
   * Rolling: windowStart = now - hours, windowEnd = now
   * Calendar: aligned to natural period boundaries (daily/weekly/monthly)
   */
  calcWindow(budget: Budget, now: Date): { windowStart: string; windowEnd: string } {
    if (budget.window.kind === 'rolling') {
      const windowStart = new Date(now.getTime() - budget.window.hours * 3600 * 1000);
      return {
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
      };
    }

    // Calendar window — align to natural boundary
    const windowStart = this.calendarWindowStart(budget.window.hours, now);
    const windowEnd = now.toISOString();
    return { windowStart, windowEnd };
  }

  private calendarWindowStart(hours: number, now: Date): string {
    // Align to natural period boundaries in UTC
    if (hours <= 24) {
      // Daily reset at midnight UTC
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return d.toISOString();
    }
    if (hours <= 168) {
      // Weekly reset at Monday 00:00 UTC
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const day = d.getUTCDay(); // 0=Sun, 1=Mon...
      const daysToMonday = day === 0 ? 6 : day - 1;
      d.setUTCDate(d.getUTCDate() - daysToMonday);
      return d.toISOString();
    }
    // Monthly reset on 1st of month
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return d.toISOString();
  }
}
