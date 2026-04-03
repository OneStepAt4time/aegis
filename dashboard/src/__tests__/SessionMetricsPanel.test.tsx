import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SessionMetricsPanel } from '../components/session/SessionMetricsPanel';

describe('SessionMetricsPanel', () => {
  it('renders latency snapshot and aggregated chart data', () => {
    render(
      <SessionMetricsPanel
        metrics={{
          durationSec: 120,
          messages: 8,
          toolCalls: 5,
          approvals: 2,
          autoApprovals: 1,
          statusChanges: ['working', 'permission_prompt', 'idle'],
        }}
        loading={false}
        latencyLoading={false}
        latency={{
          sessionId: 'session-1',
          realtime: {
            hook_latency_ms: 120,
            state_change_detection_ms: 118,
            permission_response_ms: 780,
          },
          aggregated: {
            hook_latency_ms: { min: 80, max: 140, avg: 110, count: 3 },
            state_change_detection_ms: { min: 78, max: 138, avg: 108, count: 3 },
            permission_response_ms: { min: 600, max: 900, avg: 780, count: 2 },
            channel_delivery_ms: { min: 25, max: 60, avg: 40, count: 5 },
          },
        }}
      />,
    );

    expect(screen.getByText('Latency Snapshot')).toBeDefined();
    expect(screen.getByText('Hook Latency')).toBeDefined();
    expect(screen.getByText('120 ms')).toBeDefined();
    expect(screen.getByText('Channel Delivery Avg')).toBeDefined();
    expect(screen.getByLabelText('Session latency averages')).toBeDefined();
    expect(screen.getAllByText('Status Changes')).toHaveLength(2);
  });

  it('shows an empty state when no latency samples exist yet', () => {
    render(
      <SessionMetricsPanel
        metrics={{
          durationSec: 10,
          messages: 1,
          toolCalls: 0,
          approvals: 0,
          autoApprovals: 0,
          statusChanges: [],
        }}
        loading={false}
        latencyLoading={false}
        latency={{
          sessionId: 'session-2',
          realtime: null,
          aggregated: null,
        }}
      />,
    );

    expect(screen.getByText('No latency samples yet for this session.')).toBeDefined();
  });
});