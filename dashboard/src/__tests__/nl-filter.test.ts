/**
 * __tests__/nl-filter.test.ts — Unit tests for NL filter parser
 */

import { describe, it, expect } from 'vitest';
import { parseNLQuery } from '../components/shared/NLFilterBar';

describe('NL Filter Parser', () => {
  it('should parse status keyword', () => {
    const tokens = parseNLQuery('failed sessions');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'status',
      op: 'eq',
      value: 'error',
      display: 'status: error',
    });
  });

  it('should parse date: today', () => {
    const tokens = parseNLQuery('sessions today');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'date',
      op: 'gte',
      display: 'today',
    });
    expect(tokens[0].value).toBeTruthy();
  });

  it('should parse date: yesterday', () => {
    const tokens = parseNLQuery('from yesterday');
    expect(tokens.length).toBeGreaterThanOrEqual(1);
    expect(tokens[0]).toMatchObject({
      field: 'date',
      op: 'gte',
      display: 'from yesterday',
    });
  });

  it('should parse date: last week', () => {
    const tokens = parseNLQuery('last week');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'date',
      op: 'gte',
      display: 'last week',
    });
  });

  it('should parse date: this month', () => {
    const tokens = parseNLQuery('this month');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'date',
      op: 'gte',
      display: 'this month',
    });
  });

  it('should parse owner keyword', () => {
    const tokens = parseNLQuery('by admin');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'owner',
      op: 'contains',
      value: 'admin',
      display: 'by: admin',
    });
  });

  it('should parse combined query: status + date', () => {
    const tokens = parseNLQuery('failed sessions from yesterday');
    expect(tokens.length).toBeGreaterThanOrEqual(2);
    expect(tokens.some((t) => t.field === 'status' && t.value === 'error')).toBe(true);
    expect(tokens.some((t) => t.field === 'date')).toBe(true);
  });

  it('should parse combined query: status + owner + date', () => {
    const tokens = parseNLQuery('active sessions by master last week');
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(tokens.some((t) => t.field === 'status' && t.value === 'active')).toBe(true);
    expect(tokens.some((t) => t.field === 'owner' && t.value === 'master')).toBe(true);
    expect(tokens.some((t) => t.field === 'date')).toBe(true);
  });

  it('should parse text fallback for unknown terms', () => {
    const tokens = parseNLQuery('myproject backend');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'text',
      op: 'contains',
      value: 'myproject backend',
      display: '"myproject backend"',
    });
  });

  it('should handle empty input', () => {
    const tokens = parseNLQuery('');
    expect(tokens).toHaveLength(0);
  });

  it('should ignore common stop words', () => {
    const tokens = parseNLQuery('the sessions and the errors');
    // 'the', 'and' should be ignored, only 'errors' mapped to status
    expect(tokens.some((t) => t.field === 'status')).toBe(true);
  });

  it('should parse complex query with multiple keywords', () => {
    const tokens = parseNLQuery('idle sessions by ops-user last 7 days');
    expect(tokens.length).toBeGreaterThanOrEqual(3);
    expect(tokens.some((t) => t.field === 'status' && t.value === 'idle')).toBe(true);
    expect(tokens.some((t) => t.field === 'owner')).toBe(true);
    expect(tokens.some((t) => t.field === 'date')).toBe(true);
  });

  it('should normalize status aliases (running -> active)', () => {
    const tokens = parseNLQuery('running sessions');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'status',
      value: 'active',
    });
  });

  it('should normalize status aliases (dead -> killed)', () => {
    const tokens = parseNLQuery('dead sessions');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      field: 'status',
      value: 'killed',
    });
  });
});
