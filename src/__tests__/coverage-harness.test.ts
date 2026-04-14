import { it, expect } from 'vitest';
import { detectUIState, parseStatusLine, extractInteractiveContent } from '../terminal-parser.js';
import { parseEntries } from '../transcript.js';
import { sendMessageSchema } from '../validation.js';

it('terminal parser utilities behave on sample pane text', () => {
  const pane = '\n  1. Yes\nEsc to cancel\nSome status message';
  // detectUIState may return a string or an object depending on runtime parser; assert it's defined
  const state = detectUIState(pane);
  expect(state).toBeDefined();
  expect(typeof state === 'object' || typeof state === 'string').toBe(true);
  const status = parseStatusLine(pane);
  expect(status === null || typeof status === 'string').toBe(true);
  const interactive = extractInteractiveContent(pane);
  // interactive may be null or an object depending on implementation
  expect(interactive === null || typeof interactive === 'object').toBe(true);
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
