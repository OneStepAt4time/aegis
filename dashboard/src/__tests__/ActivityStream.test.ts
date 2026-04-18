import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describeEvent, normalizeDisplayText, safeStr } from '../components/ActivityStream';
import ActivityStream from '../components/ActivityStream';
import { useStore } from '../store/useStore';
import type { GlobalSSEEvent } from '../types';

function makeEvent(
  event: GlobalSSEEvent['event'],
  data: Record<string, unknown>,
): GlobalSSEEvent {
  return { event, sessionId: 'sess-1', timestamp: '2026-03-29T00:00:00Z', data };
}

describe('safeStr', () => {
  it('returns string values unchanged', () => {
    expect(safeStr('hello')).toBe('hello');
  });

  it('returns fallback for non-string values', () => {
    expect(safeStr(123)).toBe('unknown');
    expect(safeStr(null)).toBe('unknown');
    expect(safeStr(undefined)).toBe('unknown');
    expect(safeStr({ foo: 1 })).toBe('unknown');
    expect(safeStr(true)).toBe('unknown');
  });

  it('uses custom fallback when provided', () => {
    expect(safeStr(null, 'fallback')).toBe('fallback');
    expect(safeStr(42, 'n/a')).toBe('n/a');
  });

  it('normalizes malformed display text before returning it', () => {
    expect(safeStr('hello\u0000\r\nworld\uFFFD')).toBe('hello world');
  });
});

describe('normalizeDisplayText', () => {
  it('removes control characters and replacement glyphs', () => {
    expect(normalizeDisplayText('line\u0000 one\u001F\uFFFD')).toBe('line one');
  });

  it('collapses whitespace for single-line activity rendering', () => {
    expect(normalizeDisplayText('alpha\r\n\tbeta   gamma')).toBe('alpha beta gamma');
  });
});

describe('describeEvent — type guards', () => {
  it('handles session_status_change with valid string status', () => {
    const e = makeEvent('session_status_change', { status: 'working', detail: 'thinking' });
    expect(describeEvent(e)).toBe('State changed to Working — thinking');
  });

  it('handles session_status_change with non-string status', () => {
    const e = makeEvent('session_status_change', { status: 42 });
    expect(describeEvent(e)).toBe('State changed to Unknown');
  });

  it('handles session_status_change with non-string detail', () => {
    const e = makeEvent('session_status_change', { status: 'idle', detail: { nested: true } });
    expect(describeEvent(e)).toBe('State changed to Idle');
  });

  it('handles session_message with string text', () => {
    const e = makeEvent('session_message', { role: 'user', text: 'hello world' });
    expect(describeEvent(e)).toBe('User prompt: hello world');
  });

  it('normalizes malformed session_message text', () => {
    const e = makeEvent('session_message', { role: 'assistant', text: 'hi\u0000\r\nthere\uFFFD' });
    expect(describeEvent(e)).toBe('Agent response: hi there');
  });

  it('handles session_message with non-string text (object)', () => {
    const e = makeEvent('session_message', { role: 'assistant', text: { blocks: [] } });
    expect(describeEvent(e)).toBe('Agent response: Blocks: ...');
  });

  it('handles session_message with null text', () => {
    const e = makeEvent('session_message', { role: 'assistant', text: null });
    expect(describeEvent(e)).toBe('Agent response: ');
  });

  it('handles session_message with undefined text', () => {
    const e = makeEvent('session_message', { role: 'assistant' });
    expect(describeEvent(e)).toBe('Agent response: ');
  });

  it('handles session_approval with string prompt', () => {
    const e = makeEvent('session_approval', { prompt: 'Allow bash command?' });
    expect(describeEvent(e)).toBe('Permission request: Allow bash command?');
  });

  it('handles session_approval with non-string prompt', () => {
    const e = makeEvent('session_approval', { prompt: { type: 'tool' } });
    expect(describeEvent(e)).toBe('Permission request: Type: tool');
  });

  it('handles session_ended with non-string reason', () => {
    const e = makeEvent('session_ended', { reason: 500 });
    expect(describeEvent(e)).toBe('Session completed — no reason given');
  });

  it('handles session_created with non-string workDir', () => {
    const e = makeEvent('session_created', { workDir: null });
    expect(describeEvent(e)).toBe('New session in unknown directory');
  });

  it('handles session_stall with non-string stallType', () => {
    const e = makeEvent('session_stall', { stallType: { kind: 'jsonl' } });
    expect(describeEvent(e)).toBe('Agent stalled: unknown type');
  });

  it('handles session_dead with non-string stallType', () => {
    const e = makeEvent('session_dead', { stallType: 99 });
    expect(describeEvent(e)).toBe('Agent unresponsive: connection lost');
  });

  it('handles session_subagent_start with non-string name', () => {
    const e = makeEvent('session_subagent_start', { name: false });
    expect(describeEvent(e)).toBe('Subagent launched: unnamed');
  });

  it('handles session_subagent_stop with non-string name', () => {
    const e = makeEvent('session_subagent_stop', { name: [1, 2] });
    expect(describeEvent(e)).toBe('Subagent finished: unnamed');
  });
});

describe('ActivityStream degraded SSE state', () => {
  it('shows a paused-state badge and message when SSE is unavailable', () => {
    useStore.setState({
      activities: [],
      sessions: [],
      sseConnected: false,
      sseError: 'Real-time updates unavailable. Overview widgets are using fallback polling where available.',
      activityFilterSession: null,
      activityFilterType: null,
    });

    render(createElement(ActivityStream));

    expect(screen.getByText('Live updates paused')).toBeDefined();
  });
});

describe('ActivityStream recent-events variant', () => {
  it('supports a compact recent-events view without filters', () => {
    useStore.setState({
      activities: [
        {
          event: 'session_status_change',
          sessionId: 'sess-1',
          timestamp: '2026-03-29T00:00:01Z',
          data: { status: 'working' },
          renderKey: 'evt-1',
        },
        {
          event: 'session_message',
          sessionId: 'sess-2',
          timestamp: '2026-03-29T00:00:00Z',
          data: { role: 'assistant', text: 'done' },
          renderKey: 'evt-2',
        },
      ],
      sessions: [],
      sseConnected: true,
      sseError: null,
      activityFilterSession: 'filtered-out',
      activityFilterType: 'session_ended',
    });

    render(createElement(ActivityStream, { title: 'Recent events', showFilters: false, maxItems: 1 }));

    expect(screen.getByText('Recent events')).toBeDefined();
    expect(screen.queryAllByRole('combobox').length).toBe(0);
    expect(screen.getByText('State changed to Working')).toBeDefined();
    expect(screen.queryByText('Agent response: done')).toBeNull();
  });
});
