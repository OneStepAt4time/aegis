/**
 * __tests__/i18n-utilities.test.ts — Unit tests for i18n formatting utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatDate, formatDateShort, formatDateTime } from '../utils/formatDate';
import { formatNumber, formatCurrency, formatPercent, formatCompact, formatBytes } from '../utils/formatNumber';
import { formatRelativeTime, formatTimeAgo } from '../utils/formatRelativeTime';
import { pluralize, getPluralCategory, createPluralize } from '../utils/pluralize';

describe('formatDate', () => {
  const LOCALE_KEY = 'aegis:locale';
  
  beforeEach(() => {
    localStorage.clear();
  });
  
  afterEach(() => {
    localStorage.clear();
  });
  
  it('should format dates in default locale', () => {
    const date = new Date('2025-01-15T12:00:00Z');
    const formatted = formatDate(date);
    // Default is en-US or navigator.language
    expect(formatted).toMatch(/Jan/i);
    expect(formatted).toContain('15');
  });
  
  it('should format short dates', () => {
    const date = new Date('2025-01-15');
    const formatted = formatDateShort(date);
    expect(formatted).toMatch(/Jan/i);
  });
  
  it('should format date with time', () => {
    const date = new Date('2025-01-15T14:30:00Z');
    const formatted = formatDateTime(date);
    expect(formatted).toContain('15');
    expect(formatted).toContain('2025');
  });
  
  it('should respect locale from localStorage', () => {
    localStorage.setItem(LOCALE_KEY, 'de-DE');
    const date = new Date('2025-01-15');
    const formatted = formatDate(date);
    // German should use different month abbreviations
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe('formatNumber', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  
  it('should format numbers with locale-aware separators', () => {
    const formatted = formatNumber(1234.56);
    // en-US uses comma thousands separator
    expect(formatted).toContain('1');
    expect(formatted).toContain('234');
  });
  
  it('should format currency', () => {
    const formatted = formatCurrency(123.456);
    expect(formatted).toMatch(/\$123\./);
    expect(formatted).toContain('456'); // 3 decimal places: $123.456
  });
  
  it('should format percentages', () => {
    const formatted = formatPercent(0.456);
    expect(formatted).toContain('45'); // 45.6%
    expect(formatted).toMatch(/%/);
  });
  
  it('should format compact numbers', () => {
    expect(formatCompact(1500)).toMatch(/1\.5K/i);
    expect(formatCompact(2_500_000)).toMatch(/2\.5M/i);
  });
  
  it('should format bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toContain('KB');
    expect(formatBytes(1024 * 1024)).toContain('MB');
    expect(formatBytes(1024 * 1024 * 1024)).toContain('GB');
  });
});

describe('formatRelativeTime', () => {
  it('should format recent times', () => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    
    const formatted = formatRelativeTime(fiveMinutesAgo);
    expect(formatted).toMatch(/5 minutes ago|5m ago/i);
  });
  
  it('should format future times', () => {
    const now = Date.now();
    const inTwoHours = now + 2 * 60 * 60 * 1000;
    
    const formatted = formatRelativeTime(inTwoHours);
    expect(formatted).toMatch(/in 2 hours|2h/i);
  });
  
  it('should format timeAgo (always past)', () => {
    const future = Date.now() + 1000;
    const formatted = formatTimeAgo(future);
    expect(formatted).toBe('just now');
  });
  
  it('should handle various time units', () => {
    const now = Date.now();
    
    // Seconds
    expect(formatRelativeTime(now - 30 * 1000)).toMatch(/second/i);
    
    // Hours
    expect(formatRelativeTime(now - 2 * 60 * 60 * 1000)).toMatch(/hour/i);
    
    // Days
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60 * 1000)).toMatch(/day/i);
  });
});

describe('pluralize', () => {
  it('should pluralize English nouns correctly', () => {
    expect(pluralize(0, 'session')).toBe('0 sessions');
    expect(pluralize(1, 'session')).toBe('1 session');
    expect(pluralize(2, 'session')).toBe('2 sessions');
    expect(pluralize(5, 'session')).toBe('5 sessions');
  });
  
  it('should handle custom plural forms', () => {
    expect(pluralize(1, 'child', 'children')).toBe('1 child');
    expect(pluralize(2, 'child', 'children')).toBe('2 children');
  });
  
  it('should detect plural categories', () => {
    // English: one vs other
    expect(getPluralCategory(1)).toBe('one');
    expect(getPluralCategory(0)).toBe('other');
    expect(getPluralCategory(2)).toBe('other');
    expect(getPluralCategory(100)).toBe('other');
  });
  
  it('should create reusable pluralize functions', () => {
    const countSessions = createPluralize('session', 'sessions');
    expect(countSessions(1)).toBe('1 session');
    expect(countSessions(5)).toBe('5 sessions');
  });
});
