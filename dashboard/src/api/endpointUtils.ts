/**
 * Derive a clean endpoint path (pathname only) from a full URL.
 * Strips protocol, host, query, and hash so tokens do not leak into
 * recorder snapshots.
 */
export function endpointFromUrl(url: string): string {
  try {
    const u = new URL(url, window.location.href);
    return u.pathname;
  } catch {
    return url;
  }
}
