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

  // Scheme check — must be HTTPS, or HTTP only for local dev
  const isLocalDev = hostname === '127.0.0.1' || hostname === '::1' || hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLocalDev)) {
    if (parsed.protocol === 'http:') {
      return 'Only HTTPS URLs are allowed for external hosts';
    }
    return 'Only HTTPS URLs are allowed';
  }

  // Reject *.local hostnames (but allow literal localhost for dev)
  if (hostname.endsWith('.local')) {
    return 'Localhost URLs are not allowed';
  }

  // Reject private/internal IPs (except 127.0.0.1/::1 which are allowed for dev over HTTP)
  if (net.isIP(hostname) && isPrivateIP(hostname) && !isLocalDev) {
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
 * Resolve a hostname via DNS and check if the resulting IP is private/internal.
 *
 * For literal IP addresses, checks directly without DNS resolution.
 * Returns null if safe, or an error string if the IP is private.
 *
 * @param hostname - Hostname or literal IP to check
 * @param lookupFn - Optional DNS lookup function (for testing)
 */
export async function resolveAndCheckIp(
  hostname: string,
  lookupFn: DnsLookupFn = defaultLookup,
): Promise<string | null> {
  // Literal IP — check directly
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      return `DNS resolution points to a private/internal IP: ${hostname}`;
    }
    return null;
  }

  try {
    const result = await lookupFn(hostname);
    if (isPrivateIP(result.address)) {
      return `DNS resolution points to a private/internal IP: ${result.address}`;
    }
    return null;
  } catch { /* DNS lookup failed — treat as unsafe */
    return `DNS resolution failed for ${hostname}`;
  }
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

  // Reject localhost / *.local hostnames
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    return 'Localhost URLs are not allowed';
  }

  // Reject private/internal IPs
  if (net.isIP(hostname) && isPrivateIP(hostname)) {
    return 'Private/internal IP addresses are not allowed';
  }

  return null;
}
