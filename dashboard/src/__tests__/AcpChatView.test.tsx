/**
 * __tests__/AcpChatView.test.tsx
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AcpChatView } from '../components/session/AcpChatView';
import type { AcpChatMessage, AcpSessionTokenUsage } from '../types/acp-chat';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = vi.fn();

const mockMessages: AcpChatMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'Hello, can you help me?',
    timestamp: '2026-05-05T10:00:00Z',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'Of course! I can help with that.',
    timestamp: '2026-05-05T10:00:05Z',
    thinking: [{ id: 't-1', content: 'The user needs help with something.' }],
    usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
  },
];

const mockUsage: AcpSessionTokenUsage = {
  inputTokens: 500,
  outputTokens: 200,
  cacheReadTokens: 100,
  cacheWriteTokens: 50,
  totalTokens: 850,
  estimatedCostUsd: 0.0125,
};

describe('AcpChatView', () => {
  it('renders empty state when no messages', () => {
    render(<AcpChatView sessionId="s1" messages={[]} />);
    expect(screen.getByText('No messages yet. Send a prompt to start.')).toBeDefined();
  });

  it('renders user messages', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} />);
    expect(screen.getByText('Hello, can you help me?')).toBeDefined();
  });

  it('renders assistant messages', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} />);
    expect(screen.getByText('Of course! I can help with that.')).toBeDefined();
  });

  it('shows role labels', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} />);
    expect(screen.getByText('You')).toBeDefined();
    expect(screen.getByText('Assistant')).toBeDefined();
  });

  it('renders thinking block toggle', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} />);
    expect(screen.getByText('Thinking')).toBeDefined();
  });

  it('expands thinking block on click', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} />);
    fireEvent.click(screen.getByText('Thinking'));
    expect(screen.getByText('The user needs help with something.')).toBeDefined();
  });

  it('shows token meter when usage provided', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} sessionUsage={mockUsage} />);
    expect(screen.getByText('850')).toBeDefined();
    expect(screen.getByText('tokens')).toBeDefined();
  });

  it('shows cache tokens in token meter', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} sessionUsage={mockUsage} />);
    expect(screen.getByText('100')).toBeDefined();
  });

  it('shows estimated cost in token meter', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} sessionUsage={mockUsage} />);
    expect(screen.getByText(/0\.0125/)).toBeDefined();
  });

  it('shows per-message usage when configured', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} config={{ showPerMessageUsage: true }} />);
    expect(screen.getByText('70 tokens')).toBeDefined();
  });

  it('hides per-message usage by default', () => {
    render(<AcpChatView sessionId="s1" messages={mockMessages} />);
    expect(screen.queryByText('70 tokens')).toBeNull();
  });

  it('renders message input when user is driver', () => {
    render(<AcpChatView sessionId="s1" messages={[]} isDriver={true} />);
    expect(screen.getByLabelText('Message input')).toBeDefined();
  });

  it('shows observer mode when not driver', () => {
    render(<AcpChatView sessionId="s1" messages={[]} isDriver={false} />);
    expect(screen.getByText('Observer mode — you cannot send prompts')).toBeDefined();
  });

  it('calls onSend when message is submitted', () => {
    const onSend = vi.fn();
    render(<AcpChatView sessionId="s1" messages={[]} onSend={onSend} />);
    const input = screen.getByLabelText('Message input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Hello');
  });

  it('clears input after send', () => {
    const onSend = vi.fn();
    render(<AcpChatView sessionId="s1" messages={[]} onSend={onSend} />);
    const input = screen.getByLabelText('Message input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('does not send empty message', () => {
    const onSend = vi.fn();
    render(<AcpChatView sessionId="s1" messages={[]} onSend={onSend} />);
    const input = screen.getByLabelText('Message input');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows stop button when generating', () => {
    render(<AcpChatView sessionId="s1" messages={[]} isGenerating={true} onStop={vi.fn()} />);
    expect(screen.getByLabelText('Stop generation')).toBeDefined();
  });

  it('calls onStop when stop button clicked', () => {
    const onStop = vi.fn();
    render(<AcpChatView sessionId="s1" messages={[]} isGenerating={true} onStop={onStop} />);
    fireEvent.click(screen.getByLabelText('Stop generation'));
    expect(onStop).toHaveBeenCalled();
  });

  it('disables send button when input is empty', () => {
    render(<AcpChatView sessionId="s1" messages={[]} />);
    expect(screen.getByLabelText('Send message').hasAttribute('disabled')).toBe(true);
  });

  it('shows streaming indicator', () => {
    const streamingMsg: AcpChatMessage = {
      id: 'msg-3',
      role: 'assistant',
      content: 'Still typing',
      isStreaming: true,
      timestamp: '2026-05-05T10:00:10Z',
    };
    render(<AcpChatView sessionId="s1" messages={[streamingMsg]} />);
    // The streaming indicator is a span inside the content
    expect(screen.getByText('Still typing')).toBeDefined();
  });

  it('renders tool call placeholder', () => {
    const msgWithTool: AcpChatMessage = {
      id: 'msg-4',
      role: 'assistant',
      content: 'Let me run that command.',
      toolCalls: [
        { id: 'tc-1', toolName: 'bash', status: 'completed' },
      ],
      timestamp: '2026-05-05T10:00:15Z',
    };
    render(<AcpChatView sessionId="s1" messages={[msgWithTool]} />);
    expect(screen.getByText('bash')).toBeDefined();
  });

  it('has log role for messages area', () => {
    render(<AcpChatView sessionId="s1" messages={[]} />);
    expect(screen.getByRole('log')).toBeDefined();
  });

  it('sets data-session-id', () => {
    render(<AcpChatView sessionId="test-123" messages={[]} />);
    expect(document.querySelector('[data-session-id]')?.getAttribute('data-session-id')).toBe('test-123');
  });
});
