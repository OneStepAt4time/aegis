import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperatorTimelinePanel } from '../components/session/OperatorTimelinePanel';

const mockUseSessionTimeline = vi.fn();
vi.mock('../hooks/useSessionTimeline', () => ({
  useSessionTimeline: (...args: unknown[]) => mockUseSessionTimeline(...args),
}));

const defaultReturn = {
  events: [],
  isLoading: false,
  error: null,
  refresh: vi.fn(),
  clearError: vi.fn(),
};

describe('OperatorTimelinePanel', () => {
  beforeEach(() => {
    mockUseSessionTimeline.mockReturnValue(defaultReturn);
  });

  it('renders without crashing with no events', () => {
    const { container } = render(<OperatorTimelinePanel sessionId="s1" />);
    expect(container).not.toBeNull();
  });

  it('calls hook with sessionId', () => {
    render(<OperatorTimelinePanel sessionId="sess-789" />);
    expect(mockUseSessionTimeline).toHaveBeenCalledWith('sess-789');
  });

  it('shows error state when no events and error present', () => {
    mockUseSessionTimeline.mockReturnValue({
      ...defaultReturn,
      error: 'Connection failed',
    });

    render(<OperatorTimelinePanel sessionId="s1" />);
    expect(screen.getByText(/Timeline requires an active ACP backend/)).not.toBeNull();
  });

  it('renders timeline even with error if events exist', () => {
    mockUseSessionTimeline.mockReturnValue({
      ...defaultReturn,
      events: [{ id: '1', type: 'prompt', timestamp: new Date().toISOString(), summary: 'Test event' }],
      error: 'Transient error',
    });

    const { container } = render(<OperatorTimelinePanel sessionId="s1" />);
    // Should render OperatorTimeline content, not the error overlay
    expect(screen.queryByText(/Timeline requires an active ACP backend/)).toBeNull();
  });
});
