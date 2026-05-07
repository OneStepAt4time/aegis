/**
 * __tests__/OperatorTimeline.test.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperatorTimeline } from '../components/session/OperatorTimeline';
import type { AcpTimelineEvent } from '../types/acp-timeline';

const mockEvents: AcpTimelineEvent[] = [
  {
    id: 'evt-1',
    timestamp: '2026-05-05T10:00:00Z',
    category: 'driver',
    description: 'Driver claimed by admin',
    actor: 'admin',
    details: { driverAction: 'claimed' },
  },
  {
    id: 'evt-2',
    timestamp: '2026-05-05T10:00:05Z',
    category: 'prompt',
    description: 'Prompt submitted',
    actor: 'admin',
  },
  {
    id: 'evt-3',
    timestamp: '2026-05-05T10:00:10Z',
    category: 'tool',
    description: 'bash: ls -la',
    details: { toolName: 'bash', toolStatus: 'completed', durationMs: 150 },
  },
  {
    id: 'evt-4',
    timestamp: '2026-05-05T10:00:15Z',
    category: 'approval',
    description: 'Approval requested for bash',
    details: { approvalId: 'apr-1' },
  },
  {
    id: 'evt-5',
    timestamp: '2026-05-05T10:00:20Z',
    category: 'session',
    description: 'Session paused',
    details: { sessionFrom: 'running', sessionTo: 'paused' },
  },
  {
    id: 'evt-6',
    timestamp: '2026-05-05T10:00:25Z',
    category: 'error',
    description: 'ACP protocol error: timeout',
    details: { errorCode: 'ACP_TIMEOUT', errorMessage: 'Connection timed out' },
  },
];

describe('OperatorTimeline', () => {
  it('renders empty state when no events', () => {
    render(<OperatorTimeline sessionId="s1" events={[]} />);
    expect(screen.getByText('No events yet.')).toBeDefined();
  });

  it('renders event descriptions', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getByText('Driver claimed by admin')).toBeDefined();
    expect(screen.getByText('Prompt submitted')).toBeDefined();
  });

  it('renders actor badges', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getAllByText('admin').length).toBeGreaterThan(0);
  });

  it('renders event count', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getByText('6 / 6')).toBeDefined();
  });

  it('has list role for event list', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getByRole('list')).toBeDefined();
  });

  it('has listitem role for each event', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getAllByRole('listitem').length).toBe(6);
  });

  it('shows search input', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getByLabelText('Search timeline events')).toBeDefined();
  });

  it('filters events by search text', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    const search = screen.getByLabelText('Search timeline events');
    fireEvent.change(search, { target: { value: 'bash' } });
    expect(screen.queryByText('Driver claimed by admin')).toBeNull();
    expect(screen.getByText('bash: ls -la')).toBeDefined();
  });

  it('shows filter toggle button', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    expect(screen.getByLabelText('Toggle category filters')).toBeDefined();
  });

  it('shows category filter bar when toggled', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    fireEvent.click(screen.getByLabelText('Toggle category filters'));
    expect(screen.getByRole('group')).toBeDefined();
    expect(screen.getByText('Driver')).toBeDefined();
    expect(screen.getByText('Tool')).toBeDefined();
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('filters by category', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    fireEvent.click(screen.getByLabelText('Toggle category filters'));
    fireEvent.click(screen.getByText('Tool'));
    // Tool category removed — driver event should still be visible
    expect(screen.getByText('Driver claimed by admin')).toBeDefined();
    // Tool event should be hidden
    expect(screen.queryByText('bash: ls -la')).toBeNull();
  });

  it('shows no match message when filters exclude all events', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    fireEvent.change(screen.getByLabelText('Search timeline events'), { target: { value: 'zzz_nonexistent' } });
    expect(screen.getByText('No events match the current filters.')).toBeDefined();
  });

  it('shows loading state', () => {
    render(<OperatorTimeline sessionId="s1" events={[]} isLoading={true} />);
    expect(screen.getByText('Loading events...')).toBeDefined();
  });

  it('hides events when loading', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} isLoading={true} />);
    expect(screen.queryByText('Driver claimed by admin')).toBeNull();
  });

  it('expands event details', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    fireEvent.click(screen.getAllByText('Details')[0]);
    expect(screen.getByText('action:')).toBeDefined();
    expect(screen.getByText('claimed')).toBeDefined();
  });

  it('shows tool duration in details', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    fireEvent.click(screen.getAllByText('Details')[1]);
    // Tool details should show tool name and status
    expect(screen.getByText('tool:')).toBeDefined();
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('shows error details', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} />);
    // Expand the error event details (last event with details)
    const detailsButtons = screen.getAllByText('Details');
    fireEvent.click(detailsButtons[detailsButtons.length - 1]);
    // Error details should show error code text
    expect(screen.getByText('ACP_TIMEOUT')).toBeDefined();
  });

  it('respects maxEvents config', () => {
    render(<OperatorTimeline sessionId="s1" events={mockEvents} config={{ maxEvents: 2 }} />);
    expect(screen.getByText(/2\s*\/\s*6/)).toBeDefined();
  });

  it('respects defaultFilters config', () => {
    render(
      <OperatorTimeline
        sessionId="s1"
        events={mockEvents}
        config={{ defaultFilters: ['driver'] }}
      />
    );
    expect(screen.getByText(/1\s*\/\s*6/)).toBeDefined();
  });

  it('sets data-session-id', () => {
    render(<OperatorTimeline sessionId="test-123" events={[]} />);
    expect(document.querySelector('[data-session-id]')?.getAttribute('data-session-id')).toBe('test-123');
  });
});
