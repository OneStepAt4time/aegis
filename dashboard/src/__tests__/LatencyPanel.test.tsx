import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LatencyPanel } from '../components/metrics/LatencyPanel';

describe('LatencyPanel', () => {
  it('shows loading state', () => {
    render(<LatencyPanel latency={null} loading />);
    expect(screen.getByText('Loading latency metrics...')).toBeDefined();
  });

  it('shows empty state when no latency data exists', () => {
    render(<LatencyPanel latency={null} loading={false} />);
    expect(screen.getByText('No latency samples yet.')).toBeDefined();
  });

  it('renders session latency cards with aggregated values', () => {
    render(
      <LatencyPanel
        loading={false}
        latency={{
          sessionId: 'session-1',
          realtime: {
            hook_latency_ms: 22,
            state_change_detection_ms: 18,
            permission_response_ms: 320,
          },
          aggregated: {
            hook_latency_ms: { min: 10, max: 40, avg: 22, count: 3 },
            state_change_detection_ms: { min: 8, max: 30, avg: 18, count: 3 },
            permission_response_ms: { min: 100, max: 500, avg: 320, count: 2 },
            channel_delivery_ms: { min: 14, max: 42, avg: 26, count: 4 },
          },
        }}
      />,
    );

    expect(screen.getByText('Latency')).toBeDefined();
    expect(screen.getByText('State Change Detection')).toBeDefined();
    expect(screen.getByText('Hook Processing')).toBeDefined();
    expect(screen.getAllByText('22 ms').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('320 ms').length).toBeGreaterThanOrEqual(1);
  });
});
