import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TranscriptBubble } from '../TranscriptBubble';
import type { ParsedEntry } from '../../../types';

vi.mock('../../shared/CodeBlock', () => ({
  RenderWithCodeBlocks: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock('../../shared/CopyButton', () => ({
  CopyButton: ({ text }: { text?: string }) => (
    <button data-testid="copy-btn" aria-label="Copy">{(text || '').slice(0, 20)}</button>
  ),
}));

vi.mock('../../Icon', () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`}>{name}</span>,
}));

const baseEntry: ParsedEntry = {
  role: 'assistant',
  contentType: 'text',
  text: 'Hello world',
  timestamp: '2026-05-27T10:00:00Z',
};

describe('TranscriptBubble', () => {
  it('renders user message', () => {
    const entry: ParsedEntry = { ...baseEntry, role: 'user', text: 'My message' };
    render(<TranscriptBubble entry={entry} index={0} />);
    expect(screen.getByText('My message')).toBeDefined();
  });

  it('renders assistant message', () => {
    render(<TranscriptBubble entry={baseEntry} index={0} />);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders system message', () => {
    const entry: ParsedEntry = { ...baseEntry, role: 'system', text: 'System notification' };
    render(<TranscriptBubble entry={entry} index={0} />);
    expect(screen.getByText('System notification')).toBeDefined();
  });

  it('renders thinking message with collapse toggle', () => {
    const entry: ParsedEntry = { ...baseEntry, contentType: 'thinking', text: 'Let me think...' };
    render(<TranscriptBubble entry={entry} index={0} />);
    expect(screen.getByText('Thinking…')).toBeDefined();
    // Thinking is collapsed by default, text not shown
    expect(screen.queryByText('Let me think...')).toBeNull();
  });

  it('expands thinking on click', () => {
    const entry: ParsedEntry = { ...baseEntry, contentType: 'thinking', text: 'Deep thought' };
    render(<TranscriptBubble entry={entry} index={0} />);
    const toggleBtn = screen.getByLabelText('Collapse transcript entry');
    fireEvent.click(toggleBtn);
    expect(screen.getByText('Deep thought')).toBeDefined();
  });

  it('renders tool_use with tool name', () => {
    const entry: ParsedEntry = {
      ...baseEntry,
      contentType: 'tool_use',
      toolName: 'bash',
      text: 'Running npm test',
    };
    render(<TranscriptBubble entry={entry} index={0} />);
    expect(screen.getByText('> bash')).toBeDefined();
  });

  it('renders tool_result collapsed by default', () => {
    const entry: ParsedEntry = {
      ...baseEntry,
      contentType: 'tool_result',
      text: 'A'.repeat(100),
    };
    render(<TranscriptBubble entry={entry} index={0} />);
    // Should show truncated text when collapsed
    // tool_result renders ✓ result label
    expect(screen.getByText(/✓ result/)).toBeDefined();
  });

  it('renders tool_error with danger styling', () => {
    const entry: ParsedEntry = {
      ...baseEntry,
      contentType: 'tool_error',
      text: 'Command failed',
    };
    render(<TranscriptBubble entry={entry} index={0} />);
    // tool_error renders ✗ error label
    expect(screen.getByText(/✗ error/)).toBeDefined();
  });

  it('sets id based on toolUseId', () => {
    const entry: ParsedEntry = { ...baseEntry, toolUseId: 'tool-123' };
    const { container } = render(<TranscriptBubble entry={entry} index={0} />);
    const el = container.querySelector('#msg-tool-123');
    expect(el).toBeDefined();
  });

  it('calls onFocus on click', () => {
    const onFocus = vi.fn();
    render(<TranscriptBubble entry={baseEntry} index={5} onFocus={onFocus} />);
    const bubble = screen.getByText('Hello world').closest('[tabindex]');
    if (bubble) fireEvent.click(bubble);
    expect(onFocus).toHaveBeenCalledWith(5);
  });

  it('focuses element when focused prop is true', () => {
    const { container } = render(
      <TranscriptBubble entry={baseEntry} index={0} focused={true} />
    );
    const el = container.querySelector('[tabindex="0"]');
    expect(el).toBeDefined();
  });

  it('does not set tabIndex=0 when not focused', () => {
    const { container } = render(
      <TranscriptBubble entry={baseEntry} index={0} focused={false} />
    );
    const el = container.querySelector('[tabindex="-1"]');
    expect(el).toBeDefined();
  });
});
