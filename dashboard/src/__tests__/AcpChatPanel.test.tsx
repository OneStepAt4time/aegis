/**
 * __tests__/AcpChatPanel.test.tsx — Tests for wired ACP chat panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AcpChatPanel } from '../components/session/AcpChatPanel';

// Mock scrollIntoView (not available in jsdom)
Element.prototype.scrollIntoView = vi.fn();

const mockUseAcpChat = vi.fn();
vi.mock('../hooks/useAcpChat', () => ({
  useAcpChat: (...args: unknown[]) => mockUseAcpChat(...args),
}));

const defaultReturn = {
  messages: [],
  sessionUsage: undefined,
  isGenerating: false,
  error: null,
  sendPrompt: vi.fn(),
  stop: vi.fn(),
};

describe('AcpChatPanel', () => {
  beforeEach(() => {
    mockUseAcpChat.mockReturnValue(defaultReturn);
  });

  it('renders empty chat state when connected', () => {
    render(<AcpChatPanel sessionId="s1" />);
    expect(screen.getByText('No messages yet. Send a prompt to start.')).not.toBeNull();
  });

  it('shows backend unavailable when hook errors with no messages', () => {
    mockUseAcpChat.mockReturnValue({
      ...defaultReturn,
      error: 'Connection refused',
    });

    render(<AcpChatPanel sessionId="s1" />);
    expect(screen.getByText(/Chat requires an active ACP backend/)).not.toBeNull();
    expect(screen.getByText('Connection refused')).not.toBeNull();
  });

  it('renders chat even with error if messages exist', () => {
    mockUseAcpChat.mockReturnValue({
      ...defaultReturn,
      messages: [{ id: '1', role: 'user', content: 'Hello' }],
      error: 'Transient error',
    });

    render(<AcpChatPanel sessionId="s1" />);
    expect(screen.getByText('Hello')).not.toBeNull();
  });
});
