/**
 * localhost.ts — Shared localhost detection utility.
 *
 * Consolidates the isLocalhostHost (init.ts) and isLocalhostBinding (AuthManager)
 * duplicate checks into a single source of truth.
 *
 * Issue #3513.
 */

/**
 * Returns true when the host is a localhost interface.
 * Covers IPv4 loopback (127.0.0.1), IPv6 loopback (::1), and the localhost hostname.
 */
export function isLocalhost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}
