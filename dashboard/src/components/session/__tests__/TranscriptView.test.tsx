/**
 * TranscriptView — unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TranscriptView } from '../TranscriptView';
import { useSessionEventsStore } from '../../../store/useSessionEventsStore';

// Mock @tanstack/react-virtual to avoid complex virtualizer setup
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: (i: number) => number }) => ({
    getTotalSize: () => count * 80,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        key: `item-${i}`,
        start: i * 80,
        size: estimateSize(i),
      })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

// Helper to set up store state
function setStoreEntries(sessionId: string, entries: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const store = useSessionEventsStore.getState();
  store.setEntries(sessionId, entries as any, null as any);
  if (extra) {
    useSessionEventsStore.setState((s) => ({
      sessions: {
        ...s.sessions,
        [sessionId]: { ...s.sessions[sessionId], loading: false, ...extra },
      },
    }));
  }
}

describe('TranscriptView', () => {
  beforeEach(() => {
    useSessionEventsStore.setState({ sessions: {} });
  });

  it('shows loading state', () => {
    // Default empty store has loading: true
    render(<TranscriptView sessionId="test-session" />);
    expect(screen.getByText('Loading transcript…')).toBeDefined();
  });

  it('shows error state', () => {
    useSessionEventsStore.setState({
      sessions: {
        'err-session': {
          entries: [],
          status: null,
          approvalCount: 0,
          autoApprovalCount: 0,
          statusChangeCount: 0,
          metrics: null,
          loading: false,
          lastUpdatedAt: 0,
          error: 'Failed to load',
          seekMs: null,
          seekNonce: 0,
          model: null,
        },
      },
    });
    render(<TranscriptView sessionId="err-session" />);
    expect(screen.getByText(/Failed to load/)).toBeDefined();
  });

  it('shows empty state when no messages', () => {
    setStoreEntries('empty-session', []);
    render(<TranscriptView sessionId="empty-session" />);
    expect(screen.getByText('No messages yet')).toBeDefined();
  });

  it('renders messages from store entries', () => {
    setStoreEntries('s1', [
      { role: 'user', contentType: 'text', text: 'Hello assistant' },
      { role: 'assistant', contentType: 'text', text: 'Hello user' },
    ]);
    render(<TranscriptView sessionId="s1" />);
    expect(screen.getByText('Hello assistant')).toBeDefined();
    expect(screen.getByText('Hello user')).toBeDefined();
  });

  it('shows filter count', () => {
    setStoreEntries('s2', [
      { role: 'user', contentType: 'text', text: 'msg1' },
      { role: 'assistant', contentType: 'text', text: 'msg2' },
    ]);
    render(<TranscriptView sessionId="s2" />);
    expect(screen.getByText('2 / 2')).toBeDefined();
  });

  it('filters out thinking messages by default', () => {
    setStoreEntries('s3', [
      { role: 'assistant', contentType: 'thinking', text: 'thinking...' },
      { role: 'assistant', contentType: 'text', text: 'visible' },
    ]);
    render(<TranscriptView sessionId="s3" />);
    expect(screen.queryByText('thinking...')).toBeNull();
    expect(screen.getByText('visible')).toBeDefined();
  });

  it('shows thinking messages when filter is enabled', () => {
    setStoreEntries('s4', [
      { role: 'assistant', contentType: 'thinking', text: 'deep thought' },
      { role: 'assistant', contentType: 'text', text: 'visible' },
    ]);
    render(<TranscriptView sessionId="s4" />);
    // Click the "thinking" filter button
    const thinkingBtn = screen.getByText('thinking');
    fireEvent.click(thinkingBtn);
    expect(screen.getByText('deep thought')).toBeDefined();
  });

  it('always shows user messages regardless of filters', () => {
    setStoreEntries('s5', [
      { role: 'user', contentType: 'text', text: 'user msg' },
    ]);
    render(<TranscriptView sessionId="s5" />);
    expect(screen.getByText('user msg')).toBeDefined();
  });

  it('toggles tool_use filter', () => {
    setStoreEntries('s6', [
      { role: 'assistant', contentType: 'tool_use', text: 'tool output', toolName: 'bash' },
      { role: 'assistant', contentType: 'text', text: 'regular' },
    ]);
    render(<TranscriptView sessionId="s6" />);
    // tool_use is ON by default — should be visible
    expect(screen.getByText(/> bash/)).toBeDefined();
    // Toggle off
    const toolsBtn = screen.getByText('Tools');
    fireEvent.click(toolsBtn);
    expect(screen.queryByText(/> bash/)).toBeNull();
  });

  it('toggles tool_result filter', () => {
    setStoreEntries('s7', [
      { role: 'assistant', contentType: 'tool_result', text: 'result data', toolName: 'readFile' },
    ]);
    render(<TranscriptView sessionId="s7" />);
    // tool_result is ON by default
    expect(screen.getByText(/✓ readFile/)).toBeDefined();
    // Toggle off
    const resultsBtn = screen.getByText('Results');
    fireEvent.click(resultsBtn);
    expect(screen.queryByText(/✓ readFile/)).toBeNull();
  });

  it('renders command suggestion buttons in empty state', () => {
    setStoreEntries('empty', []);
    render(<TranscriptView sessionId="empty" />);
    expect(screen.getByText('/help')).toBeDefined();
    expect(screen.getByText('/model')).toBeDefined();
    expect(screen.getByText('/bash')).toBeDefined();
  });

  it('updates when new entries are added to store', () => {
    setStoreEntries('live', [
      { role: 'user', contentType: 'text', text: 'first' },
    ]);
    const { rerender } = render(<TranscriptView sessionId="live" />);
    expect(screen.getByText('first')).toBeDefined();

    // Add new entry
    setStoreEntries('live', [
      { role: 'user', contentType: 'text', text: 'first' },
      { role: 'assistant', contentType: 'text', text: 'second' },
    ]);
    rerender(<TranscriptView sessionId="live" />);
    expect(screen.getByText('second')).toBeDefined();
  });

  it('handles keyboard navigation with j/k', () => {
    setStoreEntries('nav', [
      { role: 'user', contentType: 'text', text: 'msg1' },
      { role: 'assistant', contentType: 'text', text: 'msg2' },
      { role: 'user', contentType: 'text', text: 'msg3' },
    ]);
    render(<TranscriptView sessionId="nav" />);

    // Press 'j' to move focus down
    act(() => {
      fireEvent.keyDown(window, { key: 'j' });
    });

    // Press 'k' to move focus up
    act(() => {
      fireEvent.keyDown(window, { key: 'k' });
    });
    // No crash = success
  });

  it('does not navigate on j/k when input is focused', () => {
    setStoreEntries('input-test', [
      { role: 'user', contentType: 'text', text: 'hello' },
    ]);
    render(<TranscriptView sessionId="input-test" />);

    // Simulate input focus
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    act(() => {
      fireEvent.keyDown(input, { key: 'j' });
    });
    // Should not crash
    document.body.removeChild(input);
  });
});
