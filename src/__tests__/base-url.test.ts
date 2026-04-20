import { describe, expect, it } from 'vitest';

import { deriveBaseUrl, getConfiguredBaseUrl, getDashboardUrl, normalizeBaseUrl } from '../base-url.js';

describe('base URL helpers', () => {
  it('normalizes wildcard hosts to localhost-safe origins', () => {
    expect(normalizeBaseUrl('http://0.0.0.0:9100')).toBe('http://127.0.0.1:9100');
    expect(normalizeBaseUrl('http://[::]:9100')).toBe('http://127.0.0.1:9100');
  });

  it('derives a default origin from host and port', () => {
    expect(deriveBaseUrl('127.0.0.1', 9100)).toBe('http://127.0.0.1:9100');
    expect(deriveBaseUrl('0.0.0.0', 9200)).toBe('http://127.0.0.1:9200');
  });

  it('prefers an explicit config baseUrl when present', () => {
    expect(getConfiguredBaseUrl({
      baseUrl: 'https://aegis.example.com/',
      host: '127.0.0.1',
      port: 9100,
    })).toBe('https://aegis.example.com');
  });

  it('builds dashboard URLs from normalized origins', () => {
    expect(getDashboardUrl('http://127.0.0.1:9100')).toBe('http://127.0.0.1:9100/dashboard/');
  });
});
