/**
 * MetricCards.mobile-responsive.test.tsx — Tests for 375px responsive fixes.
 *
 * Verifies that the Delivery Rate section stacks vertically on mobile
 * and uses responsive RingGauge size and padding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MetricCards from '../components/overview/MetricCards';
import { useStore } from '../store/useStore';

const mockGetMetrics = vi.fn();
const mockGetHealth = vi.fn();

vi.mock('../api/client', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
  getHealth: (...args: unknown[]) => mockGetHealth(...args),
}));

describe('MetricCards mobile responsive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useStore.setState({ metrics: null, activities: [], sseConnected: false, sseError: null });

    mockGetMetrics.mockResolvedValue({
      uptime: 3600,
      sessions: { total_created: 10, currently_active: 3, completed: 6, failed: 1, avg_duration_sec: 42, avg_messages_per_session: 5 },
      auto_approvals: 0,
      webhooks_sent: 0,
      webhooks_failed: 0,
      screenshots_taken: 0,
      pipelines_created: 0,
      batches_created: 0,
      prompt_delivery: { sent: 100, delivered: 95, failed: 5, success_rate: 95 },
      latency: {
        hook_latency_ms: { min: 2, max: 6, avg: 4, count: 2 },
        state_change_detection_ms: { min: 2, max: 6, avg: 4, count: 2 },
        permission_response_ms: { min: 20, max: 40, avg: 30, count: 2 },
        channel_delivery_ms: { min: 3, max: 7, avg: 5, count: 2 },
      },
    });

    mockGetHealth.mockResolvedValue({
      status: 'ok',
      version: 'test',
      uptime: 1,
      sessions: { active: 1, total: 2 },
      timestamp: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Delivery Rate card uses flex-col on mobile and sm:flex-row on larger screens', async () => {
    render(<MemoryRouter><MetricCards /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    // Find the card containing "Delivery Rate"
    const heading = screen.getByText('Delivery Rate');
    const card = heading.closest('.card-glass');
    expect(card).not.toBeNull();

    // The flex container holding RingGauge + text details
    const flexContainer = card!.querySelector('.flex.flex-col');
    expect(flexContainer).not.toBeNull();
    expect(flexContainer!.classList.contains('sm:flex-row')).toBe(true);
  });

  it('Delivery Rate card uses responsive padding (p-4 sm:p-5)', async () => {
    render(<MemoryRouter><MetricCards /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const heading = screen.getByText('Delivery Rate');
    const card = heading.closest('.card-glass');
    expect(card).not.toBeNull();
    expect(card!.classList.contains('p-4')).toBe(true);
    expect(card!.classList.contains('sm:p-5')).toBe(true);
  });

  it('Delivery Rate text content is centered on mobile, left-aligned on sm+', async () => {
    render(<MemoryRouter><MetricCards /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const heading = screen.getByText('Delivery Rate');
    const card = heading.closest('.card-glass');
    // The text details div
    const textDiv = card!.querySelector('.flex-1.space-y-3');
    expect(textDiv).not.toBeNull();
    expect(textDiv!.classList.contains('text-center')).toBe(true);
    expect(textDiv!.classList.contains('sm:text-left')).toBe(true);
  });

  it('RingGauge renders inside the delivery rate card', async () => {
    render(<MemoryRouter><MetricCards /></MemoryRouter>);

    await act(async () => { await vi.runAllTicks(); });

    const heading = screen.getByText('Delivery Rate');
    const card = heading.closest('.card-glass');
    // RingGauge renders an SVG element
    const svg = card!.querySelector('svg');
    expect(svg).not.toBeNull();
  });
});
