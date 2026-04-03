import { describe, expect, it } from 'vitest';
import { appendDeliveryRateSample, buildMetricsOverviewModel } from '../utils/metricsOverview';
import type { GlobalMetrics, HealthResponse } from '../types';

function makeMetrics(overrides: Partial<GlobalMetrics> = {}): GlobalMetrics {
  return {
    uptime: 7200,
    sessions: {
      total_created: 12,
      currently_active: 3,
      completed: 8,
      failed: 1,
      avg_duration_sec: 240,
      avg_messages_per_session: 6,
    },
    auto_approvals: 9,
    webhooks_sent: 20,
    webhooks_failed: 5,
    screenshots_taken: 4,
    pipelines_created: 7,
    batches_created: 2,
    prompt_delivery: {
      sent: 40,
      delivered: 34,
      failed: 6,
      success_rate: 85,
    },
    ...overrides,
  };
}

function makeHealth(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    status: 'ok',
    version: 'test',
    uptime: 5400,
    sessions: {
      active: 2,
      total: 10,
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('appendDeliveryRateSample', () => {
  it('appends numeric samples and trims to the most recent values', () => {
    const history = [70, 72, 74];
    expect(appendDeliveryRateSample(history, 88, 4)).toEqual([70, 72, 74, 88]);
    expect(appendDeliveryRateSample([70, 72, 74, 88], 91, 4)).toEqual([72, 74, 88, 91]);
  });

  it('ignores missing success rates', () => {
    const history = [70, 72, 74];
    expect(appendDeliveryRateSample(history, null)).toEqual(history);
    expect(appendDeliveryRateSample(history, undefined)).toEqual(history);
  });
});

describe('buildMetricsOverviewModel', () => {
  it('maps summary and detail sections from metrics payloads', () => {
    const model = buildMetricsOverviewModel(makeMetrics(), makeHealth(), [78, 82, 85]);

    expect(model.summaryCards).toEqual([
      { label: 'Active Sessions', value: 3 },
      { label: 'Total Created', value: 12 },
      { label: 'Delivery Rate', value: '85.0', suffix: '%' },
      { label: 'Uptime', value: '1h 30m' },
    ]);

    expect(model.promptDelivery).toEqual([
      { label: 'Delivered', value: '34', tone: 'success' },
      { label: 'Failed', value: '6', tone: 'danger' },
      { label: 'Success Rate', value: '85.0%', tone: 'success' },
      { label: 'Failure Rate', value: '15.0%', tone: 'warning' },
    ]);

    expect(model.webhooks).toEqual([
      { label: 'Succeeded', value: '15', tone: 'success' },
      { label: 'Failed', value: '5', tone: 'danger' },
      { label: 'Sent', value: '20' },
      { label: 'Failure Rate', value: '25.0%', tone: 'warning' },
    ]);

    expect(model.automation).toEqual([
      { label: 'Auto Approvals', value: '9', tone: 'success' },
      { label: 'Pipelines', value: '7' },
      { label: 'Batches', value: '2' },
      { label: 'Screenshots', value: '4' },
    ]);

    expect(model.deliveryRateTrend).toEqual([78, 82, 85]);
  });

  it('falls back to health data and empty placeholders when metrics are unavailable', () => {
    const model = buildMetricsOverviewModel(null, makeHealth(), []);

    expect(model.summaryCards).toEqual([
      { label: 'Active Sessions', value: 2 },
      { label: 'Total Created', value: 10 },
      { label: 'Delivery Rate', value: '—' },
      { label: 'Uptime', value: '1h 30m' },
    ]);

    expect(model.promptDelivery[2]).toEqual({ label: 'Success Rate', value: '—', tone: 'success' });
    expect(model.webhooks[3]).toEqual({ label: 'Failure Rate', value: '—', tone: 'default' });
    expect(model.automation[0]).toEqual({ label: 'Auto Approvals', value: '0', tone: 'success' });
  });
});