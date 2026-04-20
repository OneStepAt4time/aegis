import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { TranscriptViewer } from '../components/session/TranscriptViewer';

const mockGetSessionMessages = vi.fn();
const mockSubscribeSSE = vi.fn();

vi.mock('../api/client', () => ({
  getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
  subscribeSSE: (...args: unknown[]) => mockSubscribeSSE(...args),
}));

vi.mock('../store/useStore', () => ({
  useStore: (selector: (state: { token: string | null }) => unknown) => selector({ token: 'test-token' }),
}));

describe('TranscriptViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionMessages.mockResolvedValue({
      messages: [],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });
    mockSubscribeSSE.mockReturnValue(() => {});
  });

  it('renders an empty state when transcript replay has no messages', async () => {
    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    expect(screen.queryByText('Loading transcript…')).toBeNull();
    expect(mockGetSessionMessages).toHaveBeenCalledWith('session-1');
  });
});
