import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    // JSX escaping — the <b> should appear as literal text, not a real tag
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
