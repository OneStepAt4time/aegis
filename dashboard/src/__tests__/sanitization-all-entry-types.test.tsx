/**
 * Test for Issue #628: Verify DOMPurify sanitization is applied to ALL entry types.
 * Previously only permission_request entries were sanitized.
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

describe('DOMPurify — all entry types sanitized (#628)', () => {
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
    expect(container.innerHTML).not.toContain('onerror');
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
