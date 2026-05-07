import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality check for secret strings.
 * Pads both inputs to equal length before comparison so the function always
 * runs in constant time, preventing length-leak timing attacks (#2633).
 * Returns false when either argument is falsy.
 */
export function timingSafeStringEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a, 'utf8');
  bufB.write(b, 'utf8');
  return timingSafeEqual(bufA, bufB) && a.length === b.length;
}
