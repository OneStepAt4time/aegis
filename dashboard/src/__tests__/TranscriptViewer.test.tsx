import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { TranscriptViewer } from '../components/session/TranscriptViewer';

const mockGetSessionTranscript = vi.fn();
const mockSubscribeSSE = vi.fn();

vi.mock('../api/client', () => ({
  getSessionTranscript: (...args: unknown[]) => mockGetSessionTranscript(...args),
  subscribeSSE: (...args: unknown[]) => mockSubscribeSSE(...args),
}));

vi.mock('../store/useStore', () => ({
  useStore: (selector: (state: { token: string | null }) => unknown) => selector({ token: 'test-token' }),
}));

describe('TranscriptViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSessionTranscript.mockResolvedValue({
      messages: [],
      has_more: false,
      oldest_id: null,
      newest_id: null,
    });
    mockSubscribeSSE.mockReturnValue(() => {});
  });

  it('renders an empty state when transcript replay has no messages', async () => {
    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    expect(screen.queryByText('Loading transcript…')).toBeNull();
    expect(mockGetSessionTranscript).toHaveBeenCalledWith('session-1', 1000);
  });
});
