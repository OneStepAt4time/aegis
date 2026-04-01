/**
 * screenshot-ssrf.test.ts — Tests for SSRF protection in screenshot endpoint.
 *
 * Tests the shared SSRF utility applied to screenshot URL validation,
 * including DNS resolution checks.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateScreenshotUrl, resolveAndCheckIp, buildHostResolverRule } from '../ssrf.js';
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
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue([
      { address: '10.0.0.1', family: 4 },
    ]);
    const result = await resolveAndCheckIp('internal.corp', mockLookup);
    expect(result.error).toContain('private/internal IP');
    expect(result.resolvedIp).toBeNull();
  });

  it('returns resolved IP when DNS resolves to public IP', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ]);
    const result = await resolveAndCheckIp('example.com', mockLookup);
    expect(result.error).toBeNull();
    expect(result.resolvedIp).toBe('93.184.216.34');
  });

  it('returns resolved IP for literal public IP without DNS lookup', async () => {
    const mockLookup: DnsLookupFn = vi.fn();
    const result = await resolveAndCheckIp('8.8.8.8', mockLookup);
    expect(result.error).toBeNull();
    expect(result.resolvedIp).toBe('8.8.8.8');
    // Should not call DNS for literal IPs
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('returns error for literal private IP without DNS lookup', async () => {
    const mockLookup: DnsLookupFn = vi.fn();
    const result = await resolveAndCheckIp('10.0.0.1', mockLookup);
    expect(result.error).toContain('private/internal IP');
    expect(result.resolvedIp).toBeNull();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('returns error when DNS lookup fails', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await resolveAndCheckIp('nonexistent.example', mockLookup);
    expect(result.error).toContain('DNS resolution failed');
    expect(result.resolvedIp).toBeNull();
  });

  // ── Multi-answer DNS SSRF bypass prevention (issue #831) ─────────
  it('rejects when DNS returns public + private addresses (SSRF bypass)', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    const result = await resolveAndCheckIp('attacker.com', mockLookup);
    expect(result.error).toContain('private/internal IP');
    expect(result.error).toContain('169.254.169.254');
    expect(result.resolvedIp).toBeNull();
  });
});

describe('buildHostResolverRule', () => {
  it('builds MAP rule for hostname and IP', () => {
    expect(buildHostResolverRule('example.com', '93.184.216.34'))
      .toBe('MAP example.com 93.184.216.34');
  });

  it('handles subdomains', () => {
    expect(buildHostResolverRule('sub.example.com', '1.2.3.4'))
      .toBe('MAP sub.example.com 1.2.3.4');
  });

  it('handles IPv6 addresses', () => {
    expect(buildHostResolverRule('example.com', '2606:2800:220:1:248:1893:25c8:1946'))
      .toBe('MAP example.com 2606:2800:220:1:248:1893:25c8:1946');
  });
});
