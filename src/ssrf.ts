/**
 * ssrf.ts — Shared SSRF (Server-Side Request Forgery) prevention utilities.
 *
 * Validates URLs by checking scheme, hostname, and DNS resolution against
 * private/internal IP ranges. Used by webhook channel and screenshot endpoint.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Check if an IP address (v4 or v6) is private/internal.
 *
 * Rejects:
 * - RFC 1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Loopback: 127.0.0.0/8, ::1
 * - Link-local: 169.254.0.0/16, fe80::/10
 * - Current network: 0.0.0.0/8
 * - Unspecified: ::
 * - IPv6 unique-local: fc00::/7
 * - IPv4-mapped IPv6: ::ffff:x.x.x.x (RFC 4291)
 * - IPv4-compatible IPv6: ::x.x.x.x (deprecated)
 * - CGNAT: 100.64.0.0/10 (RFC 6598)
 * - Broadcast: 255.255.255.255
 * - Multicast: 224.0.0.0/4 (RFC 5771)
 * - Documentation: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (RFC 5737)
 * - Benchmarking: 198.18.0.0/15 (RFC 2544)
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b, c] = parts;
    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8
    if (a === 10) return true;
    // 127.0.0.0/8
    if (a === 127) return true;
    // 169.254.0.0/16
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 255.255.255.255 (broadcast)
    if (a === 255 && b === 255 && c === 255 && parts[3] === 255) return true;
    // 224.0.0.0/4 (multicast) — 224.0.0.0 to 239.255.255.255
    if (a >= 224 && a <= 239) return true;
    // 192.0.2.0/24 (documentation, RFC 5737)
    if (a === 192 && b === 0 && c === 2) return true;
    // 198.51.100.0/24 (documentation, RFC 5737)
    if (a === 198 && b === 51 && c === 100) return true;
    // 203.0.113.0/24 (documentation, RFC 5737)
    if (a === 203 && b === 0 && c === 113) return true;
    // 198.18.0.0/15 (benchmarking, RFC 2544) — 198.18.0.0 to 198.19.255.255
    if (a === 198 && b >= 18 && b <= 19) return true;
    return false;
  }

  // IPv6
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:x.x.x.x, RFC 4291 §2.5.5)
  // Handles dotted-quad form (::ffff:127.0.0.1) and hex form (::ffff:7f00:1).
  // Also handles IPv4-compatible IPv6 (::x.x.x.x, deprecated).
  if (lower.startsWith('::ffff:')) {
    const suffix = lower.slice(7);
    // Dotted quad form: ::ffff:127.0.0.1
    if (net.isIPv4(suffix)) {
      return isPrivateIP(suffix);
    }
    // Hex form: ::ffff:7f00:1 → parse last 32 bits as IPv4
    const hexGroups = suffix.split(':').map(h => parseInt(h, 16));
    if (hexGroups.length === 2 && hexGroups.every(n => !isNaN(n))) {
      const embedded = `${(hexGroups[0] >> 8) & 0xff}.${hexGroups[0] & 0xff}.${(hexGroups[1] >> 8) & 0xff}.${hexGroups[1] & 0xff}`;
      if (net.isIPv4(embedded)) {
        return isPrivateIP(embedded);
      }
    }
  }

  // IPv4-compatible IPv6 (::x.x.x.x, deprecated RFC 4291 §2.5.5)
  const afterPrefix = lower.startsWith('::') && lower !== '::' && lower !== '::1' ? lower.slice(2) : null;
  if (afterPrefix !== null && net.isIPv4(afterPrefix)) {
    return isPrivateIP(afterPrefix);
  }

  // ::1 (loopback)
  if (lower === '::1') return true;
  // :: (unspecified)
  if (lower === '::') return true;
  // fe80::/10 (link-local)
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  // fc00::/7 (unique-local) — includes fc and fd prefixes
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  return false;
}

/**
 * Validate a URL for webhook configuration.
 *
 * Checks:
 * 1. Valid URL format
 * 2. HTTPS scheme required for external hosts
 * 3. HTTP allowed only for localhost / 127.0.0.1
 * 4. Rejects private/internal IP addresses (except 127.0.0.1 in dev mode)
 * 5. Rejects *.local hostnames
 *
 * Returns null if valid, or an error string if invalid.
 */
export function validateWebhookUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch { /* malformed URL string */
    return 'Invalid URL';
  }

  const hostname = parsed.hostname;

  // Strip brackets from IPv6 URLs: [::1] → ::1
  const bareHost = hostname.replace(/^\[|\]$/g, '');

  // Scheme check — must be HTTPS, or HTTP only for local dev
  const isLocalDev = bareHost === '127.0.0.1' || bareHost === '::1' || bareHost === 'localhost';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDev)) {
    if (parsed.protocol === 'http:') {
      return 'Only HTTPS URLs are allowed for external hosts';
    }
    return 'Only HTTPS URLs are allowed';
  }

  // Reject *.local hostnames (but allow literal localhost for dev)
  if (bareHost.endsWith('.local')) {
    return 'Localhost URLs are not allowed';
  }

  // Reject private/internal IPs (except 127.0.0.1/::1 which are allowed for dev over HTTP)
  if (net.isIP(bareHost) && isPrivateIP(bareHost) && !isLocalDev) {
    return 'Private/internal IP addresses are not allowed';
  }

  return null;
}

/** DNS lookup result shape (matches node:dns/promises.LookupAddress). */
export interface DnsLookupResult {
  address: string;
  family: number;
}

/** DNS lookup function type for dependency injection. */
export type DnsLookupFn = (hostname: string) => Promise<DnsLookupResult>;

/** Default DNS lookup using node:dns/promises. */
const defaultLookup: DnsLookupFn = (hostname: string) => dns.lookup(hostname);

/**
 * Result of DNS resolution with SSRF check.
 * On success, includes the resolved IP address for TOCTOU-safe pinning.
 */
export interface DnsCheckResult {
  error: string | null;
  resolvedIp: string | null;
}

/**
 * Resolve a hostname via DNS and check if the resulting IP is private/internal.
 *
 * For literal IP addresses, checks directly without DNS resolution.
 * Returns a DnsCheckResult with error string if unsafe, or the resolved IP on success.
 *
 * The resolved IP should be used with Chromium --host-resolver-rules to pin the
 * address and prevent DNS rebinding (TOCTOU) attacks between validation and page.goto().
 *
 * @param hostname - Hostname or literal IP to check
 * @param lookupFn - Optional DNS lookup function (for testing)
 */
export async function resolveAndCheckIp(
  hostname: string,
  lookupFn: DnsLookupFn = defaultLookup,
): Promise<DnsCheckResult> {
  // Literal IP — check directly
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      return { error: `DNS resolution points to a private/internal IP: ${hostname}`, resolvedIp: null };
    }
    return { error: null, resolvedIp: hostname };
  }

  try {
    const result = await lookupFn(hostname);
    if (isPrivateIP(result.address)) {
      return { error: `DNS resolution points to a private/internal IP: ${result.address}`, resolvedIp: null };
    }
    return { error: null, resolvedIp: result.address };
  } catch { /* DNS lookup failed — treat as unsafe */
    return { error: `DNS resolution failed for ${hostname}`, resolvedIp: null };
  }
}

/**
 * Build Chromium --host-resolver-rules argument to pin a hostname to a specific IP.
 *
 * This prevents DNS rebinding (TOCTOU) attacks between SSRF validation and page.goto()
 * by ensuring Chromium resolves the hostname to the same IP that was validated.
 *
 * @param hostname - The original hostname from the URL
 * @param resolvedIp - The IP address that was validated as safe
 * @returns The --host-resolver-rules argument string
 */
export function buildHostResolverRule(hostname: string, resolvedIp: string): string {
  return `MAP ${hostname} ${resolvedIp}`;
}

/**
 * Build a connection URL where the hostname is replaced by the resolved IP address.
 *
 * This prevents DNS rebinding (TOCTOU) attacks in HTTP clients (like Node fetch)
 * by ensuring the connection goes to the validated IP, not a re-resolved address.
 * The original hostname is returned separately so callers can set the Host header.
 *
 * For IPv6 addresses, wraps the IP in brackets per RFC 2732.
 *
 * @param originalUrl - The original URL (e.g. "https://example.com/path")
 * @param resolvedIp - The validated IP address to connect to
 * @returns Object with the connection URL and the original hostname for Host header
 */
export function buildConnectionUrl(originalUrl: string, resolvedIp: string): { connectionUrl: string; hostHeader: string } {
  const parsed = new URL(originalUrl);
  const originalHost = parsed.host; // includes port if non-default
  // IPv6 literals need brackets in URLs
  const ipForUrl = parsed.hostname.startsWith('[') || resolvedIp.includes(':')
    ? `[${resolvedIp}]`
    : resolvedIp;
  parsed.hostname = ipForUrl;
  return { connectionUrl: parsed.toString(), hostHeader: originalHost };
}

/**
 * Validate a URL for the screenshot endpoint to prevent SSRF attacks.
 *
 * Checks:
 * 1. Valid URL format
 * 2. http: or https: scheme only
 * 3. Rejects private/internal IP addresses (literal)
 * 4. Rejects localhost / *.local hostnames
 *
 * For full DNS-resolution protection, call resolveAndCheckIp() separately.
 *
 * Returns null if valid, or an error string if invalid.
 */
export function validateScreenshotUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch { /* malformed URL string */
    return 'Invalid URL';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http and https URLs are allowed';
  }

  const hostname = parsed.hostname;

  // Strip brackets from IPv6 URLs: [::1] → ::1
  const bareHost = hostname.replace(/^\[|\]$/g, '');

  // Reject localhost / *.local hostnames
  if (bareHost === 'localhost' || bareHost.endsWith('.local')) {
    return 'Localhost URLs are not allowed';
  }

  // Reject private/internal IPs
  if (net.isIP(bareHost) && isPrivateIP(bareHost)) {
    return 'Private/internal IP addresses are not allowed';
  }

  return null;
}
