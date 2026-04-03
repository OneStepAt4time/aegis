import { formatUptime } from './format';
import type { GlobalMetrics, HealthResponse } from '../types';

export interface OverviewSummaryCard {
  label: string;
  value: string | number;
  suffix?: string;
}

export interface OverviewStatItem {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}

export interface MetricsOverviewModel {
  summaryCards: OverviewSummaryCard[];
  promptDelivery: OverviewStatItem[];
  webhooks: OverviewStatItem[];
  automation: OverviewStatItem[];
  deliveryRateTrend: number[];
}

const DEFAULT_TREND_POINTS = 12;

function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function computeFailureRate(failed: number, total: number): number | null {
  return total > 0 ? (failed / total) * 100 : null;
}

export function appendDeliveryRateSample(
  history: number[],
  successRate: number | null | undefined,
  maxPoints = DEFAULT_TREND_POINTS,
): number[] {
  if (successRate === null || successRate === undefined) {
    return history;
  }

  const nextHistory = [...history, successRate];
  return nextHistory.length > maxPoints
    ? nextHistory.slice(nextHistory.length - maxPoints)
    : nextHistory;
}

export function buildMetricsOverviewModel(
  metrics: GlobalMetrics | null,
  health: HealthResponse | null,
  deliveryRateTrend: number[],
): MetricsOverviewModel {
  const activeSessions = metrics?.sessions.currently_active ?? health?.sessions.active ?? 0;
  const totalCreated = metrics?.sessions.total_created ?? health?.sessions.total ?? 0;
  const delivered = metrics?.prompt_delivery.delivered ?? 0;
  const failedDeliveries = metrics?.prompt_delivery.failed ?? 0;
  const sentDeliveries = metrics?.prompt_delivery.sent ?? 0;
  const deliverySuccessRate = metrics?.prompt_delivery.success_rate ?? null;
  const webhookSent = metrics?.webhooks_sent ?? 0;
  const webhookFailed = metrics?.webhooks_failed ?? 0;
  const webhookSucceeded = Math.max(webhookSent - webhookFailed, 0);
  const uptime = health?.uptime ?? metrics?.uptime ?? 0;
  const deliveryFailureRate = computeFailureRate(failedDeliveries, sentDeliveries);
  const webhookFailureRate = computeFailureRate(webhookFailed, webhookSent);

  return {
    summaryCards: [
      { label: 'Active Sessions', value: activeSessions },
      { label: 'Total Created', value: totalCreated },
      {
        label: 'Delivery Rate',
        value: deliverySuccessRate === null ? '—' : deliverySuccessRate.toFixed(1),
        suffix: deliverySuccessRate === null ? undefined : '%',
      },
      { label: 'Uptime', value: formatUptime(uptime) },
    ],
    promptDelivery: [
      { label: 'Delivered', value: String(delivered), tone: 'success' },
      { label: 'Failed', value: String(failedDeliveries), tone: failedDeliveries > 0 ? 'danger' : 'default' },
      { label: 'Success Rate', value: formatPercent(deliverySuccessRate), tone: 'success' },
      { label: 'Failure Rate', value: formatPercent(deliveryFailureRate), tone: deliveryFailureRate && deliveryFailureRate > 0 ? 'warning' : 'default' },
    ],
    webhooks: [
      { label: 'Succeeded', value: String(webhookSucceeded), tone: 'success' },
      { label: 'Failed', value: String(webhookFailed), tone: webhookFailed > 0 ? 'danger' : 'default' },
      { label: 'Sent', value: String(webhookSent) },
      { label: 'Failure Rate', value: formatPercent(webhookFailureRate), tone: webhookFailureRate && webhookFailureRate > 0 ? 'warning' : 'default' },
    ],
    automation: [
      { label: 'Auto Approvals', value: String(metrics?.auto_approvals ?? 0), tone: 'success' },
      { label: 'Pipelines', value: String(metrics?.pipelines_created ?? 0) },
      { label: 'Batches', value: String(metrics?.batches_created ?? 0) },
      { label: 'Screenshots', value: String(metrics?.screenshots_taken ?? 0) },
    ],
    deliveryRateTrend,
  };
}