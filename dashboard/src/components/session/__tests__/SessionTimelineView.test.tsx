/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SessionTimelineView } from '../SessionTimelineView';
import type { AcpTimelineEvent } from '../../../types/acp-timeline';

const mockEvents: AcpTimelineEvent[] = [
  {
    id: 'evt-1',
    category: 'prompt',
    description: 'User sent prompt',
    timestamp: new Date(Date.now() - 60000).toISOString(),
    actor: 'user',
  },
  {
    id: 'evt-2',
    category: 'tool',
    description: 'Tool call: bash',
    timestamp: new Date(Date.now() - 30000).toISOString(),
    actor: 'assistant',
    details: { toolName: 'bash', toolStatus: 'completed', durationMs: 1500 },
  },
  {
    id: 'evt-3',
    category: 'error',
    description: 'Command failed',
    timestamp: new Date(Date.now() - 10000).toISOString(),
    actor: 'system',
    details: { errorCode: 'E_EXIT', errorMessage: 'permission denied' },
  },
];

describe('SessionTimelineView', () => {
  it('renders empty state', () => {
    render(<SessionTimelineView events={[]} />);
    expect(screen.getByText('No timeline events yet')).toBeDefined();
  });

  it('renders loading state', () => {
    render(<SessionTimelineView events={[]} isLoading />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders events with descriptions', () => {
    render(<SessionTimelineView events={mockEvents} />);
    expect(screen.getByText(/User sent prompt/)).toBeDefined();
    expect(screen.getByText(/Tool call: bash/)).toBeDefined();
    expect(screen.getByText(/Command failed/)).toBeDefined();
  });

  it('shows event count', () => {
    render(<SessionTimelineView events={mockEvents} />);
    expect(screen.getByText('3 events')).toBeDefined();
  });

  it('shows error count', () => {
    render(<SessionTimelineView events={mockEvents} />);
    expect(screen.getByText('1 error')).toBeDefined();
  });

  it('expands event details on click', () => {
    render(<SessionTimelineView events={mockEvents} />);
    const toolBtn = screen.getByLabelText(/Tool: Tool call: bash/);
    fireEvent.click(toolBtn);
    // Should show toolName detail
    expect(screen.getByText(/toolName:/)).toBeDefined();
  });

  it('toggles filter bar', () => {
    render(<SessionTimelineView events={mockEvents} />);
    const filterBtn = screen.getByLabelText('Toggle event filters');
    fireEvent.click(filterBtn);
    expect(screen.getByLabelText('Tool events')).toBeDefined();
    expect(screen.getByLabelText('Error events')).toBeDefined();
  });

  it('filters events by category', () => {
    render(<SessionTimelineView events={mockEvents} />);
    fireEvent.click(screen.getByLabelText('Toggle event filters'));
    fireEvent.click(screen.getByLabelText('Tool events'));
    expect(screen.queryByText(/Tool call: bash/)).toBeNull();
    expect(screen.getByText(/User sent prompt/)).toBeDefined();
  });
});
