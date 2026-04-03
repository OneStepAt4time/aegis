import { describe, it, expect } from 'vitest';
import { describeEvent, safeStr } from '../components/ActivityStream';
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
});

describe('describeEvent — type guards', () => {
  it('handles session_status_change with valid string status', () => {
    const e = makeEvent('session_status_change', { status: 'working', detail: 'thinking' });
    expect(describeEvent(e)).toBe('Status -> working: thinking');
  });

  it('handles session_status_change with non-string status', () => {
    const e = makeEvent('session_status_change', { status: 42 });
    expect(describeEvent(e)).toBe('Status -> unknown');
  });

  it('handles session_status_change with non-string detail', () => {
    const e = makeEvent('session_status_change', { status: 'idle', detail: { nested: true } });
    expect(describeEvent(e)).toBe('Status -> idle');
  });

  it('handles session_message with string text', () => {
    const e = makeEvent('session_message', { role: 'user', text: 'hello world' });
    expect(describeEvent(e)).toBe('User: hello world');
  });

  it('handles session_message with non-string text (object)', () => {
    const e = makeEvent('session_message', { role: 'assistant', text: { blocks: [] } });
    expect(describeEvent(e)).toBe('Claude: {"blocks":[]}');
  });

  it('handles session_message with null text', () => {
    const e = makeEvent('session_message', { role: 'assistant', text: null });
    expect(describeEvent(e)).toBe('Claude: ""');
  });

  it('handles session_message with undefined text', () => {
    const e = makeEvent('session_message', { role: 'assistant' });
    expect(describeEvent(e)).toBe('Claude: ""');
  });

  it('handles session_approval with string prompt', () => {
    const e = makeEvent('session_approval', { prompt: 'Allow bash command?' });
    expect(describeEvent(e)).toBe('Approval needed: Allow bash command?');
  });

  it('handles session_approval with non-string prompt', () => {
    const e = makeEvent('session_approval', { prompt: { type: 'tool' } });
    expect(describeEvent(e)).toBe('Approval needed: {"type":"tool"}');
  });

  it('handles session_ended with non-string reason', () => {
    const e = makeEvent('session_ended', { reason: 500 });
    expect(describeEvent(e)).toBe('Session ended: unknown');
  });

  it('handles session_created with non-string workDir', () => {
    const e = makeEvent('session_created', { workDir: null });
    expect(describeEvent(e)).toBe('Created in unknown dir');
  });

  it('handles session_stall with non-string stallType', () => {
    const e = makeEvent('session_stall', { stallType: { kind: 'jsonl' } });
    expect(describeEvent(e)).toBe('Session stalled: unknown');
  });

  it('handles session_dead with non-string stallType', () => {
    const e = makeEvent('session_dead', { stallType: 99 });
    expect(describeEvent(e)).toBe('Session dead: unknown');
  });

  it('handles session_subagent_start with non-string name', () => {
    const e = makeEvent('session_subagent_start', { name: false });
    expect(describeEvent(e)).toBe('Subagent started: unknown');
  });

  it('handles session_subagent_stop with non-string name', () => {
    const e = makeEvent('session_subagent_stop', { name: [1, 2] });
    expect(describeEvent(e)).toBe('Subagent finished: unknown');
  });
});
