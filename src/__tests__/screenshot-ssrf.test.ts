/**
 * screenshot-ssrf.test.ts — Tests for SSRF protection in screenshot endpoint.
 *
 * Tests the shared SSRF utility applied to screenshot URL validation,
 * including DNS resolution checks.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateScreenshotUrl, resolveAndCheckIp } from '../ssrf.js';
import type { DnsLookupFn } from '../ssrf.js';

describe('validateScreenshotUrl', () => {
  it('accepts valid HTTPS URL', () => {
    expect(validateScreenshotUrl('https://example.com')).toBeNull();
  });

  it('accepts valid HTTP URL', () => {
    expect(validateScreenshotUrl('http://example.com')).toBeNull();
  });

  it('rejects private IPv4 10.0.0.1', () => {
    expect(validateScreenshotUrl('http://10.0.0.1/page')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects private IPv4 172.16.0.1', () => {
    expect(validateScreenshotUrl('http://172.16.0.1/page')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects private IPv4 192.168.1.1', () => {
    expect(validateScreenshotUrl('http://192.168.1.1/page')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects loopback 127.0.0.1', () => {
    expect(validateScreenshotUrl('http://127.0.0.1/page')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects link-local 169.254.0.1', () => {
    expect(validateScreenshotUrl('http://169.254.0.1/page')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects CGNAT 100.64.0.1', () => {
    expect(validateScreenshotUrl('http://100.64.0.1/page')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects localhost hostname', () => {
    expect(validateScreenshotUrl('http://localhost/page')).toBe('Localhost URLs are not allowed');
  });

  it('rejects .local hostname', () => {
    expect(validateScreenshotUrl('http://myserver.local/page')).toBe('Localhost URLs are not allowed');
  });

  it('rejects invalid URL', () => {
    expect(validateScreenshotUrl('not-a-url')).toBe('Invalid URL');
  });

  it('rejects non-http(s) scheme', () => {
    expect(validateScreenshotUrl('file:///etc/passwd')).toBe('Only http and https URLs are allowed');
  });

  it('accepts public IP 8.8.8.8', () => {
    expect(validateScreenshotUrl('http://8.8.8.8/page')).toBeNull();
  });
});

describe('resolveAndCheckIp (for screenshot URLs)', () => {
  it('returns error when DNS resolves to 10.x.x.x', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '10.0.0.1',
      family: 4,
    });
    const result = await resolveAndCheckIp('internal.corp', mockLookup);
    expect(result).toContain('private/internal IP');
  });

  it('returns null when DNS resolves to public IP', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '93.184.216.34',
      family: 4,
    });
    const result = await resolveAndCheckIp('example.com', mockLookup);
    expect(result).toBeNull();
  });
});
