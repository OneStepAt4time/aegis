/**
 * Webhook delivery API client.
 * Mock implementation — will be wired to real API when backend lands.
 */

import type { WebhookDeliveryResponse, WebhookInfo } from '../types/webhook-delivery';

// ── Mock data ──────────────────────────────────────────────

const MOCK_HOOKS: WebhookInfo[] = [
  {
    id: 'hook-1',
    name: 'Slack Notifications',
    url: 'https://hooks.slack.com/services/T00/B00/xxx',
    events: ['session.create', 'session.kill', 'permission.prompt'],
    enabled: true,
    createdAt: '2026-05-20T10:00:00Z',
    lastDeliveryAt: '2026-05-29T19:45:00Z',
  },
  {
    id: 'hook-2',
    name: 'CI Pipeline Trigger',
    url: 'https://ci.example.com/webhook/aegis',
    events: ['session.complete', 'session.fail'],
    enabled: true,
    createdAt: '2026-05-15T08:00:00Z',
  },
  {
    id: 'hook-3',
    name: 'Monitoring Alert',
    url: 'https://monitor.example.com/api/alert',
    events: ['session.fail', 'permission.deny'],
    enabled: false,
    createdAt: '2026-05-10T12:00:00Z',
  },
];

const MOCK_DELIVERIES: Record<string, WebhookDeliveryResponse> = {
  'hook-1': {
    deliveries: [
      { id: 'del-1', hookId: 'hook-1', timestamp: '2026-05-29T19:45:00Z', status: 'success', statusCode: 200, durationMs: 145, attemptCount: 1, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx' },
      { id: 'del-2', hookId: 'hook-1', timestamp: '2026-05-29T19:30:00Z', status: 'success', statusCode: 200, durationMs: 98, attemptCount: 1, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx' },
      { id: 'del-3', hookId: 'hook-1', timestamp: '2026-05-29T19:15:00Z', status: 'failed', statusCode: 503, durationMs: 5000, attemptCount: 3, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx', errorMessage: 'Service Unavailable' },
      { id: 'del-4', hookId: 'hook-1', timestamp: '2026-05-29T18:00:00Z', status: 'success', statusCode: 200, durationMs: 210, attemptCount: 1, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx' },
      { id: 'del-5', hookId: 'hook-1', timestamp: '2026-05-29T17:30:00Z', status: 'retrying', statusCode: 500, durationMs: 3000, attemptCount: 2, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx', errorMessage: 'Internal Server Error' },
      { id: 'del-6', hookId: 'hook-1', timestamp: '2026-05-29T16:00:00Z', status: 'success', statusCode: 201, durationMs: 67, attemptCount: 1, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx' },
      { id: 'del-7', hookId: 'hook-1', timestamp: '2026-05-29T14:00:00Z', status: 'failed', statusCode: 0, durationMs: 10000, attemptCount: 3, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx', errorMessage: 'Connection timeout' },
    ],
  },
  'hook-2': {
    deliveries: [
      { id: 'del-10', hookId: 'hook-2', timestamp: '2026-05-29T18:00:00Z', status: 'success', statusCode: 200, durationMs: 320, attemptCount: 1, targetUrl: 'https://ci.example.com/webhook/aegis' },
      { id: 'del-11', hookId: 'hook-2', timestamp: '2026-05-29T15:00:00Z', status: 'failed', statusCode: 404, durationMs: 45, attemptCount: 1, targetUrl: 'https://ci.example.com/webhook/aegis', errorMessage: 'Not Found' },
    ],
  },
  'hook-3': {
    deliveries: [],
  },
};

const USE_MOCK = true;

// ── API functions ──────────────────────────────────────────

export async function fetchWebhookDeliveries(hookId: string): Promise<WebhookDeliveryResponse> {
  if (USE_MOCK) {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 300));
    return MOCK_DELIVERIES[hookId] ?? { deliveries: [] };
  }
  const res = await fetch(`/v1/hooks/${hookId}/deliveries`);
  if (!res.ok) throw new Error(`Failed to fetch deliveries for hook ${hookId}`);
  return res.json();
}

export async function fetchWebhooks(): Promise<WebhookInfo[]> {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 200));
    return MOCK_HOOKS;
  }
  const res = await fetch('/v1/hooks');
  if (!res.ok) throw new Error('Failed to fetch webhooks');
  return res.json();
}
