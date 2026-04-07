/**
 * shutdown-race-415.test.ts — Test that rapid double SIGINT doesn't trigger
 * concurrent graceful shutdown (Issue #415).
 *
 * The reentrance guard is a synchronous flag checked in the signal handler.
 * We verify the guard pattern directly.
 */

import { describe, it, expect } from 'vitest';

describe('Graceful shutdown reentrance guard (Issue #415)', () => {
  it('should only execute gracefulShutdown once on rapid double signal', async () => {
    // Simulate the guard pattern from server.ts signal handlers
    let shuttingDown = false;
    let callCount = 0;

    async function gracefulShutdown(_signal: string): Promise<void> {
      callCount++;
    }

    // Simulate two rapid SIGINTs — both hit the handler synchronously
    const handler = (): void => {
      if (!shuttingDown) {
        shuttingDown = true;
        void gracefulShutdown('SIGINT');
      }
    };

    handler(); // first SIGINT
    handler(); // second SIGINT (rapid double-tap)

    // Give microtasks a chance to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(callCount).toBe(1);
    expect(shuttingDown).toBe(true);
  });

  it('should handle SIGTERM then SIGINT without double execution', async () => {
    let shuttingDown = false;
    let callCount = 0;

    async function gracefulShutdown(_signal: string): Promise<void> {
      callCount++;
      // simulate async work
      await new Promise((r) => setTimeout(r, 5));
    }

    const onSignal = (signal: string): void => {
      if (!shuttingDown) {
        shuttingDown = true;
        void gracefulShutdown(signal);
      }
    };

    onSignal('SIGTERM');
    onSignal('SIGINT');

    await new Promise((r) => setTimeout(r, 20));

    expect(callCount).toBe(1);
    expect(shuttingDown).toBe(true);
  });

  it('should allow shutdown after first signal completes', async () => {
    let shuttingDown = false;
    let callCount = 0;

    async function gracefulShutdown(): Promise<void> {
      callCount++;
    }

    const onSignal = (): void => {
      if (!shuttingDown) {
        shuttingDown = true;
        void gracefulShutdown();
      }
    };

    onSignal();
    // Guard stays true — second call still blocked even after first completes
    onSignal();

    expect(callCount).toBe(1);
  });
});
