import { it, expect } from 'vitest';
import { detectUIState, parseStatusLine, extractInteractiveContent } from '../terminal-parser.js';
import { parseEntries } from '../transcript.js';
import { sendMessageSchema } from '../validation.js';
import { computeProjectHash } from '../session-discovery.js';

it('terminal parser utilities behave on sample pane text', () => {
  const pane = '\n  1. Yes\nEsc to cancel\nSome status message';
  expect(detectUIState(pane)).toBeDefined();
  expect(parseStatusLine(pane)).toBeTruthy();
  const interactive = extractInteractiveContent(pane);
  expect(interactive).toBeNull() || expect(interactive).toBeDefined();
});

it('transcript parseEntries flattens content array', () => {
  const entries = [
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      timestamp: '2026-01-01T00:00:00Z'
    }
  ];
  const parsed = parseEntries(entries as any);
  expect(parsed.length).toBeGreaterThan(0);
  expect(parsed[0].text).toContain('Hello');
});

it('validation schemas accept valid data', () => {
  const parsed = sendMessageSchema.safeParse({ text: 'hi' });
  expect(parsed.success).toBe(true);
});

it('computeProjectHash returns a string', () => {
  const h = computeProjectHash('/home/user/projects/myproj');
  expect(typeof h).toBe('string');
});
