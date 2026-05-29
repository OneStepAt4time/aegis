/**
 * WebhookDeliveryHistory tests — delivery log with pass/fail indicators.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WebhookDeliveryHistory } from '../WebhookDeliveryHistory';

// Mock i18n
vi.mock('../../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

// Mock API
vi.mock('../../../api/webhook-deliveries', () => ({
  fetchWebhooks: vi.fn().mockResolvedValue([
    {
      id: 'hook-1',
      name: 'Slack Notifications',
      url: 'https://hooks.slack.com/services/T00/B00/xxx',
      events: ['session.create'],
      enabled: true,
      createdAt: '2026-05-20T10:00:00Z',
    },
    {
      id: 'hook-2',
      name: 'CI Pipeline',
      url: 'https://ci.example.com/webhook',
      events: ['session.complete'],
      enabled: false,
      createdAt: '2026-05-15T08:00:00Z',
    },
  ]),
  fetchWebhookDeliveries: vi.fn().mockImplementation((hookId: string) => {
    if (hookId === 'hook-1') {
      return Promise.resolve({
        deliveries: [
          { id: 'del-1', hookId: 'hook-1', timestamp: '2026-05-29T19:45:00Z', status: 'success', statusCode: 200, durationMs: 145, attemptCount: 1, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx' },
          { id: 'del-2', hookId: 'hook-1', timestamp: '2026-05-29T19:15:00Z', status: 'failed', statusCode: 503, durationMs: 5000, attemptCount: 3, targetUrl: 'https://hooks.slack.com/services/T00/B00/xxx', errorMessage: 'Service Unavailable' },
        ],
      });
    }
    return Promise.resolve({ deliveries: [] });
  }),
}));

describe('WebhookDeliveryHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the section heading', async () => {
    render(<WebhookDeliveryHistory />);
    expect(await screen.findByText(/Webhook Delivery History/i)).toBeDefined();
  });

  it('shows configured webhooks', async () => {
    render(<WebhookDeliveryHistory />);
    expect(await screen.findByText('Slack Notifications')).toBeDefined();
    expect(screen.getByText('CI Pipeline')).toBeDefined();
  });

  it('shows pass/fail counts when expanded', async () => {
    render(<WebhookDeliveryHistory />);
    const slackHook = await screen.findByText('Slack Notifications');
    const expandBtn = slackHook.closest('button')!;
    fireEvent.click(expandBtn);

    // Should show delivery rows after expansion
    expect(await screen.findByText('200')).toBeDefined();
    expect(screen.getByText('503')).toBeDefined();
  });

  it('shows no deliveries message for empty hooks', async () => {
    render(<WebhookDeliveryHistory />);
    const ciHook = await screen.findByText('CI Pipeline');
    const expandBtn = ciHook.closest('button')!;
    fireEvent.click(expandBtn);

    expect(await screen.findByText(/No deliveries recorded yet/i)).toBeDefined();
  });
});
