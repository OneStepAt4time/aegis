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
  // Broadcast
  it('rejects 255.255.255.255 (broadcast)', () => {
    expect(isPrivateIP('255.255.255.255')).toBe(true);
  });
  // Multicast 224.0.0.0/4
  it('rejects 224.0.0.1 (multicast)', () => {
    expect(isPrivateIP('224.0.0.1')).toBe(true);
  });
  it('rejects 239.255.255.255 (multicast upper bound)', () => {
    expect(isPrivateIP('239.255.255.255')).toBe(true);
  });
  it('allows 240.0.0.0 (above multicast range)', () => {
    expect(isPrivateIP('240.0.0.0')).toBe(false);
  });
  // Documentation 192.0.2.0/24 (RFC 5737)
  it('rejects 192.0.2.1 (documentation, RFC 5737)', () => {
    expect(isPrivateIP('192.0.2.1')).toBe(true);
  });
  it('rejects 192.0.2.255 (documentation, RFC 5737)', () => {
    expect(isPrivateIP('192.0.2.255')).toBe(true);
  });
  // Documentation 198.51.100.0/24 (RFC 5737)
  it('rejects 198.51.100.1 (documentation, RFC 5737)', () => {
    expect(isPrivateIP('198.51.100.1')).toBe(true);
  });
  // Documentation 203.0.113.0/24 (RFC 5737)
  it('rejects 203.0.113.1 (documentation, RFC 5737)', () => {
    expect(isPrivateIP('203.0.113.1')).toBe(true);
  });
  it('rejects 203.0.113.255 (documentation, RFC 5737)', () => {
    expect(isPrivateIP('203.0.113.255')).toBe(true);
  });
  // Benchmarking 198.18.0.0/15 (RFC 2544)
  it('rejects 198.18.0.1 (benchmarking, RFC 2544)', () => {
    expect(isPrivateIP('198.18.0.1')).toBe(true);
  });
  it('rejects 198.19.255.255 (benchmarking upper bound)', () => {
    expect(isPrivateIP('198.19.255.255')).toBe(true);
  });
  it('allows 198.17.255.255 (below benchmarking range)', () => {
    expect(isPrivateIP('198.17.255.255')).toBe(false);
  });
  it('allows 198.20.0.0 (above benchmarking range)', () => {
    expect(isPrivateIP('198.20.0.0')).toBe(false);
  });
  // Valid public IPs
  it('allows 8.8.8.8 (public)', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
  });
  it('allows 1.1.1.1 (public)', () => {
    expect(isPrivateIP('1.1.1.1')).toBe(false);
  });

  // ── IPv4-mapped IPv6 (::ffff:x.x.x.x) — SSRF bypass vector (#621) ────
  it('rejects ::ffff:127.0.0.1 (mapped loopback)', () => {
    expect(isPrivateIP('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects ::ffff:10.0.0.1 (mapped RFC 1918)', () => {
    expect(isPrivateIP('::ffff:10.0.0.1')).toBe(true);
  });
  it('rejects ::ffff:172.16.0.1 (mapped RFC 1918)', () => {
    expect(isPrivateIP('::ffff:172.16.0.1')).toBe(true);
  });
  it('rejects ::ffff:192.168.1.1 (mapped RFC 1918)', () => {
    expect(isPrivateIP('::ffff:192.168.1.1')).toBe(true);
  });
  it('rejects ::ffff:169.254.0.1 (mapped link-local)', () => {
    expect(isPrivateIP('::ffff:169.254.0.1')).toBe(true);
  });
  it('rejects ::ffff:0.0.0.0 (mapped unspecified)', () => {
    expect(isPrivateIP('::ffff:0.0.0.0')).toBe(true);
  });
  it('rejects ::ffff:100.64.0.1 (mapped CGNAT)', () => {
    expect(isPrivateIP('::ffff:100.64.0.1')).toBe(true);
  });
  it('rejects ::ffff:255.255.255.255 (mapped broadcast)', () => {
    expect(isPrivateIP('::ffff:255.255.255.255')).toBe(true);
  });
  it('rejects ::ffff:224.0.0.1 (mapped multicast)', () => {
    expect(isPrivateIP('::ffff:224.0.0.1')).toBe(true);
  });
  it('allows ::ffff:8.8.8.8 (mapped public)', () => {
    expect(isPrivateIP('::ffff:8.8.8.8')).toBe(false);
  });
  it('allows ::ffff:1.1.1.1 (mapped public)', () => {
    expect(isPrivateIP('::ffff:1.1.1.1')).toBe(false);
  });
  // Case-insensitive ::FFFF:
  it('rejects ::FFFF:127.0.0.1 (uppercase mapped loopback)', () => {
    expect(isPrivateIP('::FFFF:127.0.0.1')).toBe(true);
  });

  // ── IPv4-mapped IPv6 hex form (::ffff:XXXX:XXXX) — URL-normalized ──
  it('rejects ::ffff:7f00:1 (hex form of ::ffff:127.0.0.1)', () => {
    expect(isPrivateIP('::ffff:7f00:1')).toBe(true);
  });
  it('rejects ::ffff:a00:1 (hex form of ::ffff:10.0.0.1)', () => {
    expect(isPrivateIP('::ffff:a00:1')).toBe(true);
  });
  it('rejects ::ffff:ac10:1 (hex form of ::ffff:172.16.0.1)', () => {
    expect(isPrivateIP('::ffff:ac10:1')).toBe(true);
  });
  it('rejects ::ffff:c0a8:101 (hex form of ::ffff:192.168.1.1)', () => {
    expect(isPrivateIP('::ffff:c0a8:101')).toBe(true);
  });
  it('allows ::ffff:808:808 (hex form of ::ffff:8.8.8.8, public)', () => {
    expect(isPrivateIP('::ffff:808:808')).toBe(false);
  });

  // ── IPv4-compatible IPv6 (::x.x.x.x) — deprecated bypass vector ──────
  it('rejects ::127.0.0.1 (compat loopback)', () => {
    expect(isPrivateIP('::127.0.0.1')).toBe(true);
  });
  it('rejects ::10.0.0.1 (compat RFC 1918)', () => {
    expect(isPrivateIP('::10.0.0.1')).toBe(true);
  });
  it('rejects ::192.168.1.1 (compat RFC 1918)', () => {
    expect(isPrivateIP('::192.168.1.1')).toBe(true);
  });
  it('rejects ::0.0.0.0 (compat unspecified)', () => {
    expect(isPrivateIP('::0.0.0.0')).toBe(true);
  });
  it('allows ::8.8.8.8 (compat public)', () => {
    expect(isPrivateIP('::8.8.8.8')).toBe(false);
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

  it('rejects IPv4-mapped IPv6 loopback in URL', () => {
    expect(validateWebhookUrl('https://[::ffff:127.0.0.1]/hook')).toBe('Private/internal IP addresses are not allowed');
  });

  it('rejects IPv4-mapped IPv6 private in URL', () => {
    expect(validateWebhookUrl('https://[::ffff:10.0.0.1]/hook')).toBe('Private/internal IP addresses are not allowed');
  });

  it('allows IPv6 loopback via HTTPS (local dev)', () => {
    expect(validateWebhookUrl('https://[::1]/hook')).toBeNull();
  });

  it('rejects IPv6 unique-local in URL', () => {
    expect(validateWebhookUrl('https://[fc00::1]/hook')).toBe('Private/internal IP addresses are not allowed');
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
    expect(result.error).toBe('DNS resolution points to a private/internal IP: 10.0.0.1');
    expect(result.resolvedIp).toBeNull();
  });

  it('returns resolved IP when DNS resolves to public IP', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '93.184.216.34',
      family: 4,
    });
    const result = await resolveAndCheckIp('example.com', mockLookup);
    expect(result.error).toBeNull();
    expect(result.resolvedIp).toBe('93.184.216.34');
  });

  it('returns error when DNS lookup fails', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    const result = await resolveAndCheckIp('nonexistent.invalid', mockLookup);
    expect(result.error).toBe('DNS resolution failed for nonexistent.invalid');
    expect(result.resolvedIp).toBeNull();
  });

  it('returns resolved IP for literal public IP without DNS lookup', async () => {
    const mockLookup: DnsLookupFn = vi.fn();
    const result = await resolveAndCheckIp('8.8.8.8', mockLookup);
    expect(result.error).toBeNull();
    expect(result.resolvedIp).toBe('8.8.8.8');
    // Should NOT call DNS for literal IPs
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('returns error for literal private IP without DNS lookup', async () => {
    const mockLookup: DnsLookupFn = vi.fn();
    const result = await resolveAndCheckIp('192.168.1.1', mockLookup);
    expect(result.error).toBe('DNS resolution points to a private/internal IP: 192.168.1.1');
    expect(result.resolvedIp).toBeNull();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('returns error when DNS resolves to IPv4-mapped private IPv6', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '::ffff:10.0.0.1',
      family: 6,
    });
    const result = await resolveAndCheckIp('evil.corp', mockLookup);
    expect(result.error).toBe('DNS resolution points to a private/internal IP: ::ffff:10.0.0.1');
    expect(result.resolvedIp).toBeNull();
  });

  it('returns null when DNS resolves to IPv4-mapped public IPv6', async () => {
    const mockLookup: DnsLookupFn = vi.fn().mockResolvedValue({
      address: '::ffff:8.8.8.8',
      family: 6,
    });
    const result = await resolveAndCheckIp('safe.example.com', mockLookup);
    expect(result.error).toBeNull();
    expect(result.resolvedIp).toBe('::ffff:8.8.8.8');
  });
});
