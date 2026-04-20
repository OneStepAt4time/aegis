/**
 * View Transitions API utility (Issue #009)
 * Wraps navigation in View Transitions when supported, graceful no-op otherwise.
 */

/**
 * Wraps a callback in the View Transitions API if available.
 * Falls back to immediate execution if not supported.
 */
export function withViewTransition(callback: () => void | Promise<void>): void {
  if (!document.startViewTransition) {
    // Browser doesn't support View Transitions — execute immediately
    void Promise.resolve(callback());
    return;
  }

  // Use View Transitions API
  document.startViewTransition(() => callback());
}

/**
 * Wraps async navigation in View Transitions.
 * Intended for React Router navigate() calls.
 */
export function withViewTransitionAsync(
  callback: () => Promise<void>
): Promise<void> {
  if (!document.startViewTransition) {
    return callback();
  }

  return new Promise<void>((resolve, reject) => {
    const transition = document.startViewTransition(() => callback());
    transition.finished.then(resolve).catch(reject);
  });
}
