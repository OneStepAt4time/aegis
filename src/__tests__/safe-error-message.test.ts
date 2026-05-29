import { describe, it, expect } from 'vitest';
import { safeErrorMessage } from '../routes/context.js';

describe('safeErrorMessage', () => {
  it('returns generic message for 5xx errors', () => {
    const err = new Error('Internal path: /Users/admin/.aegis/keys.json');
    expect(safeErrorMessage(err, 500)).toBe('Internal server error');
  });

  it('returns generic message for 5xx non-Error throws', () => {
    expect(safeErrorMessage('raw string', 500)).toBe('Internal server error');
    expect(safeErrorMessage(42, 500)).toBe('Internal server error');
    expect(safeErrorMessage(undefined, 500)).toBe('Internal server error');
  });

  it('returns original message for 4xx errors (client-facing)', () => {
    const err = new Error('Session not found');
    expect(safeErrorMessage(err, 404)).toBe('Session not found');
  });

  it('returns stringified non-Error for 4xx', () => {
    expect(safeErrorMessage('raw string', 400)).toBe('raw string');
    expect(safeErrorMessage(42, 400)).toBe('42');
  });

  it('treats 4xx as client-facing boundary', () => {
    const err = new Error('Too many requests');
    expect(safeErrorMessage(err, 429)).toBe('Too many requests');
  });

  it('redacts internal paths from 5xx via Error objects', () => {
    const err = new Error('ENOENT: no such file, open \'/home/user/.aegis/state/keys.json\'');
    expect(safeErrorMessage(err, 500)).toBe('Internal server error');
  });

  it('redacts internal variable names from 5xx', () => {
    const err = new Error('Cannot read property acpAgentSessionId of undefined');
    expect(safeErrorMessage(err, 500)).toBe('Internal server error');
  });
});
