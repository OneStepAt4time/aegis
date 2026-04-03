import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ParsedEntry } from '../types';
import { TranscriptViewer } from '../components/session/TranscriptViewer';
import { useStore } from '../store/useStore';

const mockGetSessionMessages = vi.fn();
const mockSubscribeSSE = vi.fn();
const originalConsoleError = console.error;

vi.mock('../api/client', () => ({
  getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
  subscribeSSE: (...args: unknown[]) => mockSubscribeSSE(...args),
}));

vi.mock('../components/session/MessageBubble', () => ({
  MessageBubble: ({ entry }: { entry: ParsedEntry }) => (
    <div data-height="48" data-message-bubble data-testid="message-bubble">
      {entry.text}
    </div>
  ),
}));

function createRect(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: 800,
    width: 800,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeMessage(index: number): ParsedEntry {
  return {
    role: index % 4 === 0 ? 'user' : 'assistant',
    contentType: 'text',
    text: `message-${index}`,
    timestamp: new Date(2026, 3, 3, 12, 0, index).toISOString(),
  };
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(options: ScrollToOptions) {
      if (typeof options.top === 'number') {
        Object.defineProperty(this, 'scrollTop', {
          configurable: true,
          writable: true,
          value: options.top,
        });

        this.dispatchEvent(new Event('scroll'));
      }
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      if (this.getAttribute('data-testid') === 'transcript-scroll-container') {
        return createRect(480);
      }

      const height = Number(this.getAttribute('data-height') ?? 0);
      return createRect(height);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.getAttribute('data-testid') === 'transcript-scroll-container') {
        return 480;
      }

      return Number(this.getAttribute('data-height') ?? 0);
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 800;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.clientHeight;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.clientWidth;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (this.getAttribute('data-testid') === 'transcript-scroll-container') {
        const virtualizer = this.querySelector('[data-testid="transcript-virtualizer"]') as HTMLElement | null;
        return virtualizer ? Number.parseFloat(virtualizer.style.height) : 0;
      }

      return this.clientHeight;
    },
  });
});

describe('TranscriptViewer virtualization', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(console, 'error').mockImplementation((message: unknown, ...args: unknown[]) => {
      if (
        typeof message === 'string' &&
        message.includes('flushSync was called from inside a lifecycle method')
      ) {
        return;
      }

      originalConsoleError(message, ...args);
    });

    useStore.setState({ token: null });

    mockSubscribeSSE.mockReturnValue(() => undefined);
    mockGetSessionMessages.mockResolvedValue({
      messages: Array.from({ length: 200 }, (_, index) => makeMessage(index)),
      status: 'working',
      statusText: null,
      interactiveContent: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders only a virtualized subset for large transcripts', async () => {
    render(<TranscriptViewer sessionId="session-1" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('message-bubble').length).toBeGreaterThan(0);
    });

    const renderedMessages = screen.getAllByTestId('message-bubble');
    expect(renderedMessages.length).toBeLessThan(60);
    expect(screen.getByText('message-0')).toBeDefined();
    expect(screen.queryByText('message-199')).toBeNull();
  });

  it('keeps the rendered window subset when new live messages arrive', async () => {
    let sseHandler: ((event: MessageEvent) => void) | null = null;
    mockSubscribeSSE.mockImplementation((_sessionId: string, handler: (event: MessageEvent) => void) => {
      sseHandler = handler;
      return () => undefined;
    });

    render(<TranscriptViewer sessionId="session-2" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('message-bubble').length).toBeGreaterThan(0);
    });

    const container = screen.getByTestId('transcript-scroll-container');
    await act(async () => {
      Object.defineProperty(container, 'scrollTop', {
        configurable: true,
        writable: true,
        value: container.scrollHeight - container.clientHeight,
      });
      container.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      expect(screen.getByText('message-199')).toBeDefined();
    });

    await act(async () => {
      sseHandler?.(new MessageEvent('message', {
        data: JSON.stringify({
          event: 'message',
          data: makeMessage(200),
        }),
      }));
    });

    await waitFor(() => {
      expect(screen.getByText('message-200')).toBeDefined();
    });

    expect(screen.getAllByTestId('message-bubble').length).toBeLessThan(60);
    expect(screen.queryByText('message-0')).toBeNull();
  });
});