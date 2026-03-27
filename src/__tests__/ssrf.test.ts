/**
 * ssrf.test.ts — Tests for shared SSRF validation utility.
 */
import { describe, it, expect, vi } from 'vitest';
import { isPrivateIP, validateWebhookUrl, resolveAndCheckIp } from '../ssrf.js';
import type { DnsLookupFn } from '../ssrf.js';

// ── isPrivateIP ──────────────────────────────────────────────────────
describe('isPrivateIP', () => {
  // Loopback
  it('rejects 127.0.0.1 (loopback)', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
  });
  it('rejects 127.255.255.255 (loopback)', () => {
    expect(isPrivateIP('127.255.255.255')).toBe(true);
  });
  // RFC 1918
  it('rejects 10.0.0.1 (RFC 1918)', () => {
    expect(isPrivateIP('10.0.0.1')).toBe(true);
  });
  it('rejects 172.16.0.1 (RFC 1918)', () => {
    expect(isPrivateIP('172.16.0.1')).toBe(true);
  });
  it('rejects 172.31.255.255 (RFC 1918)', () => {
    expect(isPrivateIP('172.31.255.255')).toBe(true);
  });
  it('rejects 192.168.1.1 (RFC 1918)', () => {
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });
  // Link-local
  it('rejects 169.254.0.1 (link-local)', () => {
    expect(isPrivateIP('169.254.0.1')).toBe(true);
  });
  // Current network
  it('rejects 0.0.0.0', () => {
    expect(isPrivateIP('0.0.0.0')).toBe(true);
  });
  // CGNAT (RFC 6598) 100.64.0.0/10
  it('rejects 100.64.0.1 (CGNAT)', () => {
    expect(isPrivateIP('100.64.0.1')).toBe(true);
  });
  it('rejects 100.127.255.255 (CGNAT)', () => {
    expect(isPrivateIP('100.127.255.255')).toBe(true);
  });
  // Boundary: 100.63.255.255 is NOT CGNAT
  it('allows 100.63.255.255 (below CGNAT range)', () => {
    expect(isPrivateIP('100.63.255.255')).toBe(false);
  });
  // Boundary: 100.128.0.0 is NOT CGNAT
  it('allows 100.128.0.0 (above CGNAT range)', () => {
    expect(isPrivateIP('100.128.0.0')).toBe(false);
  });
  // Boundary: 172.15.255.255 is NOT private
  it('allows 172.15.255.255 (below 172.16 range)', () => {
    expect(isPrivateIP('172.15.255.255')).toBe(false);
  });
  it('allows 172.32.0.0 (above 172.31 range)', () => {
    expect(isPrivateIP('172.32.0.0')).toBe(false);
  });
  // IPv6 loopback
  it('rejects ::1 (IPv6 loopback)', () => {
    expect(isPrivateIP('::1')).toBe(true);
  });
  // IPv6 unspecified
  it('rejects :: (unspecified)', () => {
    expect(isPrivateIP('::')).toBe(true);
  });
  // IPv6 link-local
  it('rejects fe80::1 (IPv6 link-local)', () => {
    expect(isPrivateIP('fe80::1')).toBe(true);
  });
  // IPv6 unique-local
  it('rejects fc00::1 (IPv6 unique-local)', () => {
    expect(isPrivateIP('fc00::1')).toBe(true);
  });
  it('rejects fd12:3456::1 (IPv6 unique-local)', () => {
    expect(isPrivateIP('fd12:3456::1')).toBe(true);
  });
  // Valid public IPs
  it('allows 8.8.8.8 (public)', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
  });
  it('allows 1.1.1.1 (public)', () => {
    expect(isPrivateIP('1.1.1.1')).toBe(false);
  });
  it('allows 203.0.113.1 (public)', () => {
    expect(isPrivateIP('203.0.113.1')).toBe(false);
  });
});

// ── validateWebhookUrl ──────────────────────────────────────────────
describe('validateWebhookUrl', () => {
  it('accepts valid HTTPS URL', () => {
    expect(validateWebhookUrl('https://example.com/hook')).toBeNull();
  });

  it('accepts HTTP to localhost (dev mode)', () => {
    expect(validateWebhookUrl('http://localhost:3000/hook')).toBeNull();
  });

  it('accepts HTTP to 127.0.0.1 (dev mode)', () => {
    expect(validateWebhookUrl('http://127.0.0.1:3000/hook')).toBeNull();
  });

  it('accepts HTTPS to localhost', () => {
    expect(validateWebhookUrl('https://localhost/hook')).toBeNull();
  });

  it('rejects HTTP to external host', () => {
    expect(validateWebhookUrl('http://example.com/hook')).toBe('Only HTTPS URLs are allowed for external hosts');
  });

  it('rejects non-http(s) scheme', () => {
    expect(validateWebhookUrl('file:///etc/passwd')).toMatch(/Only HTTPS URLs/);
  });

  it('rejects invalid URL', () => {
    expect(validateWebhookUrl('not-a-url')).toBe('Invalid URL');
  });

  it('rejects empty string', () => {
    expect(validateWebhookUrl('')).toBe('Invalid URL');
  });

  it('rejects private IP in URL', () => {
    expect(validateWebhookUrl('https://10.0.0.1/hook')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects .local hostname', () => {
    expect(validateWebhookUrl('https://myserver.local/hook')).toBe('Localhost URLs are not allowed');
  });
});

// ── resolveAndCheckIp ───────────────────────────────────────────────
describe('resolveAndCheckIp', () => {
  it('returns error when DNS resolves to private IP', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '10.0.0.1',
      family: 4,
    });
    const result = await resolveAndCheckIp('internal.corp', mockLookup);
    expect(result).toBe('DNS resolution points to a private/internal IP: 10.0.0.1');
  });

  it('returns null when DNS resolves to public IP', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '93.184.216.34',
      family: 4,
    });
    const result = await resolveAndCheckIp('example.com', mockLookup);
    expect(result).toBeNull();
  });

  it('returns error when DNS lookup fails', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await resolveAndCheckIp('nonexistent.invalid', mockLookup);
    expect(result).toBe('DNS resolution failed for nonexistent.invalid');
  });

  it('returns null for literal IP that is already public', async () => {
    const mockLookup: DnsLookupFn = vi.fn();
    const result = await resolveAndCheckIp('8.8.8.8', mockLookup);
    expect(result).toBeNull();
    // Should NOT call DNS for literal IPs
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('returns error for literal private IP', async () => {
    const mockLookup: DnsLookupFn = vi.fn();
    const result = await resolveAndCheckIp('192.168.1.1', mockLookup);
    expect(result).toBe('DNS resolution points to a private/internal IP: 192.168.1.1');
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
