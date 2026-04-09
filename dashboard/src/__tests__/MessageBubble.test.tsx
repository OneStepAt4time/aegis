import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageBubble } from '../components/session/MessageBubble';
import type { ParsedEntry } from '../types';

function makeEntry(overrides: Partial<ParsedEntry> = {}): ParsedEntry {
  return {
    role: 'assistant',
    contentType: 'permission_request',
    text: 'Bash: echo hello',
    ...overrides,
  };
}

// ── sanitizeText is exercised through MessageBubble ──────────────

describe('MessageBubble — XSS prevention', () => {
  it('escapes <script> tags in permission_request text', () => {
    const entry = makeEntry({
      text: '<script>alert("xss")</script>',
    });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>');
  });

  it('escapes <img onerror> payloads', () => {
    const entry = makeEntry({
      text: '<img src=x onerror="alert(1)">',
    });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('escapes <iframe> payloads', () => {
    const entry = makeEntry({
      text: '<iframe src="https://evil.com"></iframe>',
    });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('<iframe src="https://evil.com"></iframe>');
  });

  it('escapes event handler attributes', () => {
    const entry = makeEntry({
      text: '<div onmouseover="alert(1)">hover me</div>',
    });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('div[onmouseover]')).toBeNull();
    expect(container.textContent).toContain('<div onmouseover="alert(1)">hover me</div>');
  });

  it('renders safe plain text without alteration', () => {
    const safeText = 'Bash: rm -rf /tmp/old-files';
    const entry = makeEntry({ text: safeText });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain(safeText);
  });

  it('renders safe text for non-permission_request content types', () => {
    const entry: ParsedEntry = {
      role: 'assistant',
      contentType: 'text',
      text: '<b>bold</b> is just text',
    };
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<b>bold</b> is just text');
  });

  it('shows permission_request text with readable formatting and inert content', () => {
    const entry = makeEntry({
      role: 'user',
      text: 'Bash command:\n<svg onload="alert(1)">\nProceed?',
    });

    const { container } = render(<MessageBubble entry={entry} />);

    expect(screen.getByText('Permission Request')).toBeDefined();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toContain('Bash command:\n<svg onload="alert(1)">\nProceed?');
  });

  it('does not classify ordinary text starting with error as a failed tool result', () => {
    const entry = makeEntry({
      contentType: 'tool_result',
      text: 'error handling documentation updated successfully',
    });

    render(<MessageBubble entry={entry} />);

    expect(screen.getByText('OK Result')).toBeDefined();
  });
});

// ── Content type routing ─────────────────────────────────────────

describe('MessageBubble — content type routing', () => {
  it('renders permission_request for any role when contentType is permission_request', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'permission_request' });
    render(<MessageBubble entry={entry} />);
    expect(screen.getByText('Permission Request')).toBeDefined();
  });

  it('renders user messages as TextMessage', () => {
    const entry = makeEntry({ role: 'user', contentType: 'text', text: 'Hello' });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('Hello');
    expect(screen.queryByText('Permission Request')).toBeNull();
  });

  it('renders text assistant messages as TextMessage', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'text', text: 'Hi there' });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('Hi there');
  });

  it('renders thinking blocks as collapsible', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'thinking', text: 'Let me think...' });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('Thinking');
    // Content hidden by default
    expect(container.textContent).not.toContain('Let me think...');
  });

  it('toggles thinking block content on click', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'thinking', text: 'Hidden thought' });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).not.toContain('Hidden thought');

    fireEvent.click(screen.getByText(/Thinking/));
    expect(container.textContent).toContain('Hidden thought');
  });

  it('renders tool_use cards with tool name and preview', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_use', text: 'Reading file /etc/hosts', toolName: 'Read' });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('Read');
    expect(container.textContent).toContain('tool_use');
    expect(container.textContent).toContain('Reading file /etc/hosts');
  });

  it('truncates tool_use preview at 100 chars', () => {
    const longText = 'a'.repeat(150);
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_use', text: longText, toolName: 'Bash' });
    const { container } = render(<MessageBubble entry={entry} />);
    // Long text should be truncated (preview shorter than full text)
    expect(container.textContent.length).toBeLessThan(160);
  });

  it('renders tool_result with OK status for normal text', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_result', text: 'All good', toolName: 'Bash' });
    render(<MessageBubble entry={entry} />);
    expect(screen.getByText('OK Result')).toBeDefined();
    expect(screen.getByText('Bash')).toBeDefined();
  });

  it('renders tool_result with error status for error-prefixed text', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_result', text: 'Error: command not found' });
    render(<MessageBubble entry={entry} />);
    expect(screen.getByText('X Result')).toBeDefined();
  });

  it('renders tool_result with error status for failed-prefixed text', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_result', text: 'Failed: connection refused' });
    render(<MessageBubble entry={entry} />);
    expect(screen.getByText('X Result')).toBeDefined();
  });

  it('renders tool_result with error status for exception-prefixed text', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_result', text: 'Exception: timeout exceeded' });
    render(<MessageBubble entry={entry} />);
    expect(screen.getByText('X Result')).toBeDefined();
  });

  it('renders tool_result with empty text as (empty)', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_result', text: '' });
    render(<MessageBubble entry={entry} />);
    expect(screen.getByText('(empty)')).toBeDefined();
  });

  it('falls back to TextMessage for unknown content types', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'progress', text: 'Loading...' });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('Loading...');
  });

  it('shows timestamp on text messages', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'text', text: 'Hello', timestamp: '2026-01-15T12:00:00Z' });
    const { container } = render(<MessageBubble entry={entry} />);
    // formatTimestamp produces time string from Date
    expect(container.textContent).toMatch(/\d{1,2}:\d{2}/);
  });

  it('omits timestamp when not provided', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'text', text: 'Hello' });
    render(<MessageBubble entry={entry} />);
    // Should not throw — just no timestamp rendered
  });

  it('handles tool_use with no toolName gracefully', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_use', text: 'Some action', toolName: undefined });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('Tool');
  });

  it('renders tool_result without toolName (no tool label)', () => {
    const entry = makeEntry({ role: 'assistant', contentType: 'tool_result', text: 'result data', toolName: undefined });
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.textContent).toContain('OK Result');
    expect(container.textContent).toContain('result data');
  });
});
