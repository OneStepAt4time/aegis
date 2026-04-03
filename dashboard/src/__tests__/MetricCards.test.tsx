import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MetricCards from '../components/overview/MetricCards';
import { useStore } from '../store/useStore';

const mockGetMetrics = vi.fn();
const mockGetHealth = vi.fn();

vi.mock('../api/client', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

describe('MetricCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ metrics: null });

    mockGetMetrics.mockResolvedValue({
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
    });

    mockGetHealth.mockResolvedValue({
      status: 'ok',
      version: 'test',
      uptime: 5400,
      sessions: {
        active: 2,
        total: 10,
      },
      timestamp: new Date().toISOString(),
    });
  });

  it('renders enriched overview metrics from the global metrics payload', async () => {
    render(<MetricCards />);

    await waitFor(() => {
      expect(mockGetMetrics).toHaveBeenCalledTimes(1);
      expect(mockGetHealth).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('Prompt Delivery')).toBeTruthy();
    expect(screen.getByText('Webhooks')).toBeTruthy();
    expect(screen.getByText('Automation')).toBeTruthy();

    expect(screen.getByText('Active Sessions')).toBeTruthy();
    expect(screen.getByText('Total Created')).toBeTruthy();
    expect(screen.getByText('Delivery Rate')).toBeTruthy();
    expect(screen.getByText('Uptime')).toBeTruthy();

    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    expect(screen.getByText('Success Rate')).toBeTruthy();
    expect(screen.getAllByText('Failure Rate')).toHaveLength(2);
    expect(screen.getByText('Auto Approvals')).toBeTruthy();
    expect(screen.getByText('Pipelines')).toBeTruthy();
    expect(screen.getByText('Batches')).toBeTruthy();

    expect(screen.getByLabelText('Delivery rate trend')).toBeTruthy();
    expect(screen.getAllByTestId('delivery-rate-bar')).toHaveLength(1);
    expect(screen.getByText('34')).toBeTruthy();
    expect(screen.getByText('85.0%')).toBeTruthy();
    expect(screen.getByText('15')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });
});