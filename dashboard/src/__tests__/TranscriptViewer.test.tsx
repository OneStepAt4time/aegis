import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { TranscriptViewer } from '../components/session/TranscriptViewer';
import type { ParsedEntry } from '../types';

const mockGetSessionMessages = vi.fn();
const mockSubscribeSSE = vi.fn();

vi.mock('../api/client', () => ({
  getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
  subscribeSSE: (...args: unknown[]) => mockSubscribeSSE(...args),
}));

vi.mock('../store/useStore', () => ({
  useStore: (selector: (state: { token: string | null }) => unknown) => selector({ token: 'test-token' }),
}));

// Mock @tanstack/react-virtual for jsdom (no layout)
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getTotalSize: () => opts.count * 80,
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, i) => ({
        key: `msg-${i}`,
        index: i,
        start: i * 80,
        size: 80,
      })),
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

function makeMessages(count: number, overrides: Partial<ParsedEntry> = {}): ParsedEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    role: 'assistant' as const,
    contentType: 'text' as const,
    text: `Message ${i + 1}`,
    timestamp: `2026-04-24T10:00:${String(i).padStart(2, '0')}Z`,
    ...overrides,
  }));
}

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

  // ── Loading state ──────────────────────────────────────────────────

  it('shows loading state while fetching', () => {
    mockGetSessionMessages.mockReturnValue(new Promise(() => {}));
    render(<TranscriptViewer sessionId="session-1" />);
    expect(screen.getByText(/loading transcript/i)).toBeDefined();
  });

  // ── Empty state ────────────────────────────────────────────────────

  it('renders empty state when no messages', async () => {
    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('No messages yet')).toBeDefined();
    });

    expect(screen.queryByText(/loading transcript/i)).toBeNull();
    expect(mockGetSessionMessages).toHaveBeenCalledWith('session-1');
  });

  // ── Error state ────────────────────────────────────────────────────

  it('shows error state when fetch fails', async () => {
    mockGetSessionMessages.mockRejectedValue(new Error('Network error'));

    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeDefined();
    });
  });

  // ── Message rendering ──────────────────────────────────────────────

  it('renders user messages', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        { role: 'user', contentType: 'text', text: 'Hello, Claude!', timestamp: '2026-04-24T10:00:00Z' },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('Hello, Claude!')).toBeDefined();
    });
  });

  it('renders assistant messages with code blocks', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          contentType: 'text',
          text: 'Here is code:\n```ts\nconst x = 1;\n```',
          timestamp: '2026-04-24T10:00:01Z',
        },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    const { container } = render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      // CodeBlock renders language label and highlighted code via dangerouslySetInnerHTML.
      // Syntax highlighter wraps keywords in spans, so check for parts.
      expect(container.querySelector('code')).toBeDefined();
      expect(container.querySelector('pre')).toBeDefined();
      // The language label "ts" is rendered in the code block header
      expect(container.textContent).toContain('ts');
    });
  });

  it('renders tool_use entries', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          contentType: 'tool_use',
          text: '{"command": "ls -la"}',
          toolName: 'Bash',
          toolUseId: 'tool-1',
          timestamp: '2026-04-24T10:00:02Z',
        },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('Bash')).toBeDefined();
      expect(screen.getByText('tool_use')).toBeDefined();
    });
  });

  it('renders tool_result entries', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        {
          role: 'assistant',
          contentType: 'tool_result',
          text: 'file1.txt\nfile2.txt',
          toolName: 'Bash',
          toolUseId: 'tool-1',
          timestamp: '2026-04-24T10:00:03Z',
        },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('OK Result')).toBeDefined();
    });
  });

  // ── SSE subscription ───────────────────────────────────────────────

  it('subscribes to SSE on mount with session ID and token', async () => {
    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(mockSubscribeSSE).toHaveBeenCalledWith(
        'session-1',
        expect.any(Function),
        'test-token',
      );
    });
  });

  it('unsubscribes from SSE on unmount', async () => {
    const unsubscribe = vi.fn();
    mockSubscribeSSE.mockReturnValue(unsubscribe);

    const { unmount } = render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(mockSubscribeSSE).toHaveBeenCalled();
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  // ── Filtering ──────────────────────────────────────────────────────

  it('shows filter buttons', async () => {
    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('thinking')).toBeDefined();
      expect(screen.getByText('Tools')).toBeDefined();
      expect(screen.getByText('Results')).toBeDefined();
    });
  });

  it('shows filtered count in the filter bar', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        { role: 'user', contentType: 'text', text: 'Hi', timestamp: '2026-04-24T10:00:00Z' },
        { role: 'assistant', contentType: 'thinking', text: 'hmm', timestamp: '2026-04-24T10:00:01Z' },
        { role: 'assistant', contentType: 'text', text: 'Done', timestamp: '2026-04-24T10:00:02Z' },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    // thinking filter is off by default, so 2/3 visible
    await waitFor(() => {
      expect(screen.getByText('2 / 3')).toBeDefined();
    });
  });

  it('toggles thinking filter when clicked', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        { role: 'user', contentType: 'text', text: 'Hi', timestamp: '2026-04-24T10:00:00Z' },
        { role: 'assistant', contentType: 'thinking', text: 'hmm', timestamp: '2026-04-24T10:00:01Z' },
        { role: 'assistant', contentType: 'text', text: 'Done', timestamp: '2026-04-24T10:00:02Z' },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getByText('2 / 3')).toBeDefined();
    });

    fireEvent.click(screen.getByText('thinking'));

    await waitFor(() => {
      expect(screen.getByText('3 / 3')).toBeDefined();
    });
  });

  it('hides tool_use when Tools filter is toggled off', async () => {
    mockGetSessionMessages.mockResolvedValue({
      messages: [
        { role: 'user', contentType: 'text', text: 'Hi', timestamp: '2026-04-24T10:00:00Z' },
        { role: 'assistant', contentType: 'tool_use', text: 'ls', toolName: 'Bash', timestamp: '2026-04-24T10:00:01Z' },
      ],
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    // Both visible initially (user + tool_use)
    await waitFor(() => {
      expect(screen.getByText('2 / 2')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Tools'));

    await waitFor(() => {
      expect(screen.getByText('1 / 2')).toBeDefined();
    });
  });

  // ── Message cap ────────────────────────────────────────────────────

  it('caps messages at 1000', async () => {
    const messages = makeMessages(1050);

    mockGetSessionMessages.mockResolvedValue({
      messages,
      status: 'idle',
      statusText: null,
      interactiveContent: null,
    });

    render(<TranscriptViewer sessionId="session-1" />);

    // Should show 1000 messages (the last 1000 of the 1050)
    await waitFor(() => {
      expect(screen.getByText('1000 / 1000')).toBeDefined();
    });
  });
});
