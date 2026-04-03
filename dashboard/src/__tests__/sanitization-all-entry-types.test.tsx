/**
 * Verify XSS payloads are inert for all entry types.
 * Rendering uses plain React text nodes, which are escaped by default.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MessageBubble } from '../components/session/MessageBubble';
import type { ParsedEntry } from '../types';

const xssPayload = '<script>alert("xss")</script>';
const imgPayload = '<img src=x onerror="alert(1)">';

const contentTypes: Array<ParsedEntry['contentType']> = [
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'permission_request',
];

describe('Escaped rendering — all entry types are inert', () => {
  it.each(contentTypes)('sanitizes %s entries', (contentType) => {
    const entry: ParsedEntry = {
      role: contentType === 'permission_request' ? 'assistant' : 'assistant',
      contentType,
      text: xssPayload,
      ...(contentType === 'tool_use' || contentType === 'tool_result'
        ? { toolName: 'Bash' }
        : {}),
    };
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>');
  });

  it.each(contentTypes)('sanitizes <img onerror> in %s entries', (contentType) => {
    const entry: ParsedEntry = {
      role: 'assistant',
      contentType,
      text: imgPayload,
      ...(contentType === 'tool_use' || contentType === 'tool_result'
        ? { toolName: 'Read' }
        : {}),
    };
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    if (contentType !== 'thinking') {
      expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    }
  });

  it('sanitizes user role text entries', () => {
    const entry: ParsedEntry = {
      role: 'user',
      contentType: 'text',
      text: xssPayload,
    };
    const { container } = render(<MessageBubble entry={entry} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('<script>');
  });
});
