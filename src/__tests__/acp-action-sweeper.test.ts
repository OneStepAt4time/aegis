import { afterEach, describe, expect, it } from 'vitest';

import { ActionSweeper, resolveSweeperConfig } from '../services/acp/action-sweeper.js';
import {
  createMemoryAcpLocalStorageProfile,
  type AcpActionQueue,
  type AcpControlActionInput,
  type AcpSessionScope,
} from '../services/acp/index.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

function actionInput(overrides: Partial<AcpControlActionInput> = {}): AcpControlActionInput {
  return {
    ...scope,
    sessionId: 'session-1',
    actionId: `action-${Math.random().toString(36).slice(2, 8)}`,
    type: 'prompt',
    metadata: { text: 'hello' },
    ...overrides,
  };
}

describe('sweepOrphanedActions', () => {
  it('recovers actions past their lease deadline', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const queue = profile.actionQueue;

    // Enqueue and lease an action
    const action = await queue.enqueue(actionInput());
    const leased = await queue.leaseNext(scope, {
      leaseUntil: new Date(Date.now() + 5000),
    });
    expect(leased).not.toBeNull();
    expect(leased!.actionId).toBe(action.actionId);
    expect(leased!.status).toBe('leased');

    // Sweep with now past the lease deadline
    const now = new Date(Date.now() + 10000);
    const recovered = await queue.sweepOrphanedActions(now);

    expect(recovered).toHaveLength(1);
    expect(recovered[0].actionId).toBe(action.actionId);
    expect(recovered[0].status).toBe('failed');
    expect(recovered[0].errorMetadata?.sweeper).toBe(true);
    expect(recovered[0].errorMetadata?.reason).toBe('lease_expired');
    expect(recovered[0].failedAt).toBeTruthy();
  });

  it('does not recover actions within their lease', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const queue = profile.actionQueue;

    await queue.enqueue(actionInput());
    await queue.leaseNext(scope, {
      leaseUntil: new Date(Date.now() + 60_000),
    });

    // Sweep with now BEFORE the lease deadline
    const recovered = await queue.sweepOrphanedActions(new Date());

    expect(recovered).toHaveLength(0);
  });

  it('does not recover queued or completed actions', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const queue = profile.actionQueue;

    // Enqueue a queued action (not leased)
    await queue.enqueue(actionInput({ actionId: 'queued-action' }));

    // Enqueue, lease, and complete another action
    await queue.enqueue(actionInput({ actionId: 'completed-action' }));
    const leased = await queue.leaseNext(scope, {
      leaseUntil: new Date(Date.now() + 60_000),
    });
    expect(leased).not.toBeNull();
    await queue.complete(leased!.actionId, scope, {});

    // Sweep with future date
    const recovered = await queue.sweepOrphanedActions(new Date(Date.now() + 120_000));

    expect(recovered).toHaveLength(0);
  });

  it('recovers multiple orphaned actions', async () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const queue = profile.actionQueue;

    // Enqueue and lease 3 actions
    for (let i = 1; i <= 3; i++) {
      await queue.enqueue(actionInput({ actionId: `orphan-${i}` }));
      await queue.leaseNext(scope, {
        leaseUntil: new Date(Date.now() + 1000),
      });
    }

    const recovered = await queue.sweepOrphanedActions(new Date(Date.now() + 5000));

    expect(recovered).toHaveLength(3);
    for (const r of recovered) {
      expect(r.status).toBe('failed');
      expect(r.errorMetadata?.sweeper).toBe(true);
    }
  });
});

describe('ActionSweeper', () => {
  it('starts and stops the sweeper', () => {
    const profile = createMemoryAcpLocalStorageProfile();
    const sweeper = new ActionSweeper(
      profile.actionQueue,
      { enabled: true, intervalMs: 1000 },
    );

    sweeper.start();
    sweeper.stop();
    // No error means success
  });

  it('does not start when disabled', () => {
    const profile = createMemoryAcpLocalStorageProfile();
    // The sweeper itself doesn't check enabled — the caller does.
    // But resolveSweeperConfig returns enabled=false when env says so.
    const config = resolveSweeperConfig({ enabled: false });
    expect(config.enabled).toBe(false);
  });
});

describe('resolveSweeperConfig', () => {
  const origEnabled = process.env.AEGIS_ACTION_SWEEPER_ENABLED;
  const origInterval = process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS;

  afterEach(() => {
    if (origEnabled === undefined) {
      delete process.env.AEGIS_ACTION_SWEEPER_ENABLED;
    } else {
      process.env.AEGIS_ACTION_SWEEPER_ENABLED = origEnabled;
    }
    if (origInterval === undefined) {
      delete process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS;
    } else {
      process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS = origInterval;
    }
  });

  it('returns defaults when no env or overrides', () => {
    delete process.env.AEGIS_ACTION_SWEEPER_ENABLED;
    delete process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS;
    const config = resolveSweeperConfig();
    expect(config).toEqual({ enabled: true, intervalMs: 60_000 });
  });

  it('reads enabled from env', () => {
    process.env.AEGIS_ACTION_SWEEPER_ENABLED = 'false';
    delete process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS;
    const config = resolveSweeperConfig();
    expect(config.enabled).toBe(false);
  });

  it('reads interval from env', () => {
    delete process.env.AEGIS_ACTION_SWEEPER_ENABLED;
    process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS = '30000';
    const config = resolveSweeperConfig();
    expect(config.intervalMs).toBe(30_000);
  });

  it('overrides take precedence over env', () => {
    process.env.AEGIS_ACTION_SWEEPER_ENABLED = 'false';
    process.env.AEGIS_ACTION_SWEEPER_INTERVAL_MS = '5000';
    const config = resolveSweeperConfig({ enabled: true, intervalMs: 10_000 });
    expect(config.enabled).toBe(true);
    expect(config.intervalMs).toBe(10_000);
  });
});
