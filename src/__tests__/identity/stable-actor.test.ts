import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveStableActor,
  _resetStableActorCacheForTesting,
} from '../../identity/stable-actor.js';

describe('resolveStableActor (#4615 — relay drift defense)', () => {
  beforeEach(() => {
    // Each test starts with a clean baseline cache.
    _resetStableActorCacheForTesting();
  });

  // DoD scenario 1: deterministic identity across calls with no relayAccountId.
  it('returns the same stableActorId across 3 calls when only (channel, userId) are given', () => {
    const a = resolveStableActor({ channel: 'telegram', userId: 42 });
    const b = resolveStableActor({ channel: 'telegram', userId: 42 });
    const c = resolveStableActor({ channel: 'telegram', userId: 42 });

    expect(a.stableActorId).toBe(b.stableActorId);
    expect(b.stableActorId).toBe(c.stableActorId);
    // No baseline candidate present, so no drift signal either.
    expect(a.isDriftSuspected).toBe(false);
    expect(b.isDriftSuspected).toBe(false);
    expect(c.isDriftSuspected).toBe(false);
  });

  // DoD scenario 1 (edge): firstName does not affect stableActorId.
  it('ignores firstName when computing stableActorId (display name is not identity)', () => {
    const alice = resolveStableActor({ channel: 'telegram', userId: 42, firstName: 'Alice' });
    const aliceRenamed = resolveStableActor({
      channel: 'telegram',
      userId: 42,
      firstName: 'Alicia',
    });
    expect(aliceRenamed.stableActorId).toBe(alice.stableActorId);
  });

  // DoD scenario 2: drift detection when relayAccountId changes.
  it('flags isDriftSuspected=true on the drifted call while stableActorId stays stable', () => {
    const first = resolveStableActor({
      channel: 'telegram',
      userId: 999,
      relayAccountId: 'relay-A',
    });
    expect(first.isDriftSuspected).toBe(false);

    const drifted = resolveStableActor({
      channel: 'telegram',
      userId: 999,
      relayAccountId: 'relay-B',
    });

    expect(drifted.stableActorId).toBe(first.stableActorId);
    expect(drifted.isDriftSuspected).toBe(true);
  });

  // DoD scenario 2 (complement): matching baseline is not drift.
  it('does not flag drift when relayAccountId matches the established baseline', () => {
    const first = resolveStableActor({
      channel: 'telegram',
      userId: 1000,
      relayAccountId: 'relay-X',
    });
    const same = resolveStableActor({
      channel: 'telegram',
      userId: 1000,
      relayAccountId: 'relay-X',
    });

    expect(first.isDriftSuspected).toBe(false);
    expect(same.isDriftSuspected).toBe(false);
    expect(same.stableActorId).toBe(first.stableActorId);
  });

  // DoD scenario 2 (edge): absent relayAccountId is never drift.
  it('does not flag drift when relayAccountId is absent (no baseline to differ from)', () => {
    const r1 = resolveStableActor({ channel: 'telegram', userId: 7 });
    const r2 = resolveStableActor({ channel: 'telegram', userId: 7 });
    expect(r1.isDriftSuspected).toBe(false);
    expect(r2.isDriftSuspected).toBe(false);
  });

  // DoD scenario 3: distinct identities.
  it('returns different stableActorId for different (channel, userId) pairs', () => {
    const alice = resolveStableActor({ channel: 'telegram', userId: 1 });
    const bob = resolveStableActor({ channel: 'telegram', userId: 2 });
    const aliceOnDiscord = resolveStableActor({ channel: 'discord', userId: 1 });

    expect(alice.stableActorId).not.toBe(bob.stableActorId);
    expect(alice.stableActorId).not.toBe(aliceOnDiscord.stableActorId);
    expect(bob.stableActorId).not.toBe(aliceOnDiscord.stableActorId);
  });

  // Drift isolation: drift on one actor does not flag another.
  it('isolates drift detection per actor (one actor drifting does not flag another)', () => {
    // Alice has a stable baseline.
    resolveStableActor({ channel: 'telegram', userId: 42, relayAccountId: 'a-1' });
    const aliceAgain = resolveStableActor({ channel: 'telegram', userId: 42, relayAccountId: 'a-1' });
    // Bob is observed fresh — not drift.
    const bob = resolveStableActor({ channel: 'telegram', userId: 43, relayAccountId: 'b-1' });
    // Bob's relay now drifts — drift.
    const bobDrifted = resolveStableActor({ channel: 'telegram', userId: 43, relayAccountId: 'b-2' });

    expect(aliceAgain.isDriftSuspected).toBe(false);
    expect(bob.isDriftSuspected).toBe(false);
    expect(bobDrifted.isDriftSuspected).toBe(true);
  });
});
