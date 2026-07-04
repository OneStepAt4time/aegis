/**
 * Aegis envelope-garble defensive resolver tests (issue #4828, Layer 2).
 *
 * Mirrors the stable-actor.ts (#4615) TDD pattern: red-phase tests committed
 * first as `test(...)`, then minimal implementation to pass as `feat(...)`.
 *
 * The OpenClaw relay layer has been observed to garble the `displayName` /
 * sender-metadata envelope field on cross-agent relay messages (observed in
 * #aegis-devs, 2026-06-08 — see MEMORY.md "Sender-metadata relay garble"
 * and the Layer-2 dispatch in the Layer-3 escalation chain).
 *
 * The resolver MUST derive `canonicalSenderId` from `(channel, userId)`
 * only — never from `displayName`, which is the unreliable layer.
 * `isDriftSuspected` is a soft signal (false positives acceptable; false
 * negatives are not — missed drift means acting on stale auth metadata).
 */
import { describe, it, expect } from 'vitest';
import { resolveLayer2Envelope } from '../../identity/layer2-envelope-resolver.js';

describe('resolveLayer2Envelope (#4828 — sender-metadata garble defense)', () => {
  // DoD scenario: deterministic canonical id for same (channel, userId)
  // regardless of relay-supplied displayName drift.
  it('returns the same canonicalSenderId across calls when (channel, userId) are equal', () => {
    const clean = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'athena',
    });
    const drifted = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'AAAAAAAAAAAAthena', // observed Layer-2 drift pattern
    });
    expect(drifted.canonicalSenderId).toBe(clean.canonicalSenderId);
  });

  // DoD scenario: garbled displayName flags isDriftSuspected.
  it('flags isDriftSuspected=true for the observed A-prefix drift pattern', () => {
    const drifted = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'AAAAAAAAAAAAthena',
    });
    expect(drifted.isDriftSuspected).toBe(true);
  });

  // DoD scenario (positive sanity): clean displayName is NOT drift.
  it('does not flag drift for a clean displayName matching the expected handle', () => {
    const clean = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'athena',
    });
    expect(clean.isDriftSuspected).toBe(false);
  });

  // DoD scenario: distinct userIds produce distinct canonicalSenderIds,
  // even when displayName collides. (displayName is NOT identity.)
  it('produces different canonicalSenderIds for different userIds on the same channel', () => {
    const a = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'shared-handle',
    });
    const b = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490092150950465698,
      displayName: 'shared-handle',
    });
    expect(a.canonicalSenderId).not.toBe(b.canonicalSenderId);
  });

  // Argus pre-flight edge-case #1: empty sender-metadata.
  it('handles empty displayName without throwing and reports no drift', () => {
    expect(() =>
      resolveLayer2Envelope({
        channel: 'telegram',
        userId: 1490090121679339814,
        displayName: '',
      }),
    ).not.toThrow();
    const result = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: '',
    });
    expect(result.isDriftSuspected).toBe(false);
  });

  // Argus pre-flight edge-case #2: missing displayName (undefined).
  it('handles missing displayName without throwing and reports no drift', () => {
    expect(() =>
      resolveLayer2Envelope({
        channel: 'telegram',
        userId: 1490090121679339814,
      }),
    ).not.toThrow();
    const result = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
    });
    expect(result.isDriftSuspected).toBe(false);
  });

  // Argus pre-flight edge-case #3: both layers garbled (Layer 2 displayName garbled,
  // surface the flag — Layer-3 reviewer-state guard is out of scope for this PR).
  it('still returns a canonical id when both displayName and drift are detected', () => {
    const result = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'AAAAAAAAAAAAthena',
    });
    // canonical id must be present (auth-boundary consumers depend on it)
    expect(result.canonicalSenderId).toMatch(/^[a-f0-9]+$/);
    // drift flag must be set (so audit warnings fire)
    expect(result.isDriftSuspected).toBe(true);
  });

  // Argus pre-flight edge-case #4: neither layer garbled (sanity path).
  it('sanity: returns same canonical id with no drift on a clean round', () => {
    const r1 = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'athena',
    });
    const r2 = resolveLayer2Envelope({
      channel: 'telegram',
      userId: 1490090121679339814,
      displayName: 'athena',
    });
    expect(r1.canonicalSenderId).toBe(r2.canonicalSenderId);
    expect(r1.isDriftSuspected).toBe(false);
    expect(r2.isDriftSuspected).toBe(false);
  });
});
