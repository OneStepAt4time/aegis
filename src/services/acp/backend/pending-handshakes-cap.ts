/**
 * pending-handshakes-cap.ts — cap policy for `pendingHandshakes` (#4777).
 *
 * Extracted from backend.ts to keep that file under the 500-line gate:arch
 * limit. Pure policy module: no state, no side effects beyond throwing.
 *
 * The cap is enforced at the producer boundary (`launchBackgroundHandshake`)
 * BEFORE `startNewRuntimeBackground` is called, so a rejected call never
 * spawns a runtime (no resource leak). The dedup fast path in
 * `createSessionAsync` runs BEFORE `launchBackgroundHandshake`, so duplicate
 * calls for the same sessionId return the existing entry without consuming
 * cap space.
 */
import { AcpBackendPendingHandshakesCapExceededError } from './errors.js';

/** Issue #4777 default cap on concurrent in-flight background handshakes. */
export const DEFAULT_MAX_PENDING_HANDSHAKES = 1000;

/**
 * Throws AcpBackendPendingHandshakesCapExceededError if `pendingMap.size >= max`.
 * Inclusive upper bound: at exactly `max`, the next request rejects.
 */
export function enforcePendingHandshakesCap(
  pendingMap: { readonly size: number },
  max: number,
  sessionId: string
): void {
  if (pendingMap.size >= max) {
    throw new AcpBackendPendingHandshakesCapExceededError(sessionId, max, pendingMap.size);
  }
}
