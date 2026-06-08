/**
 * server-inbound-stable-actor.test.ts — Wiring of stable-actor resolver into
 * the inbound command handler (#4617).
 *
 * Covers:
 *   - stableActorId appears in approvedBy / statusChange detail
 *   - Drift detection (relayAccountId mismatch) logs a structured warning
 *   - Common path (no drift) preserves the human-readable form and emits no warning
 *   - Fallback (no actor) returns the default 'telegram' string
 *
 * TDD red phase: this file references `cmd.actor.relayAccountId` and a
 * `resolveInboundActor` helper that do not exist yet. The next commits add
 * the actor-type extension and the helper to make these tests pass.
 */
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { handleInbound } from '../server-inbound.js';
import type { AppContext } from '../app-context.js';
import type { InboundCommand } from '../channels/index.js';
import { _resetStableActorCacheForTesting } from '../identity/stable-actor.js';
import { logger } from '../logger.js';
import { channels } from '../server-channels.js';

interface TestCtx {
  sessions: {
    approveSession: Mock;
    rejectSession: Mock;
  };
}

function makeCtx(): TestCtx {
  return {
    sessions: {
      approveSession: vi.fn().mockResolvedValue(undefined),
      rejectSession: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function asAppCtx(ctx: TestCtx): AppContext {
  return ctx as unknown as AppContext;
}

describe('handleInbound + stable-actor resolver (#4617)', () => {
  beforeEach(() => {
    _resetStableActorCacheForTesting();
    vi.clearAllMocks();
  });

  describe('session_approve wiring', () => {
    it('includes the stableActorId in approvedBy and the statusChange detail', async () => {
      const ctx = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const statusChangeSpy = vi.spyOn(channels, 'statusChange').mockImplementation(() => {});

      const cmd: InboundCommand = {
        sessionId: 'sess-1',
        action: 'session_approve',
        actor: { type: 'telegram', userId: 42, firstName: 'Alice' },
      };
      await handleInbound(cmd, asAppCtx(ctx));

      // approvedBy was passed to approveSession
      expect(ctx.sessions.approveSession).toHaveBeenCalledTimes(1);
      const approvedBy = ctx.sessions.approveSession.mock.calls[0][1] as string;
      // Form: "telegram:<userId> (<firstName>) [stable:<16-hex>]"
      expect(approvedBy).toMatch(/^telegram:42 \(Alice\) \[stable:[0-9a-f]{16}\]$/);

      // statusChange detail includes the same tagged form
      expect(statusChangeSpy).toHaveBeenCalledTimes(1);
      const detail = statusChangeSpy.mock.calls[0][0].detail as string;
      expect(detail).toContain('Session approved by telegram:42 (Alice) [stable:');
      expect(detail).toMatch(/\[stable:[0-9a-f]{16}\]/);

      // No drift on first observation → no warning
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('preserves the human-readable form as a substring of approvedBy (no functional regression)', async () => {
      const ctx = makeCtx();
      const cmd: InboundCommand = {
        sessionId: 'sess-2',
        action: 'session_approve',
        actor: { type: 'telegram', userId: 7, firstName: 'Bob' },
      };
      await handleInbound(cmd, asAppCtx(ctx));

      const approvedBy = ctx.sessions.approveSession.mock.calls[0][1] as string;
      // The pre-#4617 form is still present (substring)
      expect(approvedBy).toContain('telegram:7 (Bob)');
    });

    it('does not log a warning when relayAccountId is absent (no baseline to differ from)', async () => {
      const ctx = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const cmd: InboundCommand = {
        sessionId: 'sess-3',
        action: 'session_approve',
        actor: { type: 'telegram', userId: 100, firstName: 'Carol' },
      };
      await handleInbound(cmd, asAppCtx(ctx));
      await handleInbound(cmd, asAppCtx(ctx));

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does not log a warning when relayAccountId matches the baseline', async () => {
      const ctx = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const base: InboundCommand = {
        sessionId: 'sess-4',
        action: 'session_approve',
        actor: { type: 'telegram', userId: 200, firstName: 'Dave', relayAccountId: 'acc-1' },
      };
      await handleInbound(base, asAppCtx(ctx));
      await handleInbound(base, asAppCtx(ctx));
      await handleInbound(base, asAppCtx(ctx));

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs a structured warning when relayAccountId drifts between calls', async () => {
      // First call establishes baseline.
      const ctx1 = makeCtx();
      const cmd1: InboundCommand = {
        sessionId: 'sess-5a',
        action: 'session_approve',
        actor: { type: 'telegram', userId: 300, firstName: 'Eve', relayAccountId: 'relay-A' },
      };
      await handleInbound(cmd1, asAppCtx(ctx1));

      // Second call with a different relayAccountId → drift.
      const ctx2 = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const cmd2: InboundCommand = {
        sessionId: 'sess-5b',
        action: 'session_approve',
        actor: { type: 'telegram', userId: 300, firstName: 'Eve', relayAccountId: 'relay-B' },
      };
      await handleInbound(cmd2, asAppCtx(ctx2));

      // Warning fired exactly once
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnArg = warnSpy.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(warnArg).toMatchObject({
        component: 'server-inbound',
        operation: 'stable_actor_drift',
        sessionId: 'sess-5b',
      });
      const attrs = warnArg.attributes as Record<string, unknown>;
      expect(attrs.observedRelayAccountId).toBe('relay-B');
      expect(attrs.stableActorId).toMatch(/^[0-9a-f]{16}$/);

      // The stableActorId is the SAME across the drift (relay drift doesn't change identity)
      const approvedBy1 = ctx1.sessions.approveSession.mock.calls[0][1] as string;
      const approvedBy2 = ctx2.sessions.approveSession.mock.calls[0][1] as string;
      const id1 = approvedBy1.match(/\[stable:([0-9a-f]{16})\]/)?.[1];
      const id2 = approvedBy2.match(/\[stable:([0-9a-f]{16})\]/)?.[1];
      expect(id1).toBeDefined();
      expect(id1).toBe(id2);
    });
  });

  describe('session_reject wiring', () => {
    it('includes the stableActorId in the statusChange detail', async () => {
      const ctx = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const statusChangeSpy = vi.spyOn(channels, 'statusChange').mockImplementation(() => {});

      const cmd: InboundCommand = {
        sessionId: 'sess-r1',
        action: 'session_reject',
        actor: { type: 'telegram', userId: 11, firstName: 'Frank' },
      };
      await handleInbound(cmd, asAppCtx(ctx));

      // rejectSession takes only the sessionId (current signature)
      expect(ctx.sessions.rejectSession).toHaveBeenCalledWith('sess-r1');
      // The detail field on the channel event carries the tagged form
      expect(statusChangeSpy).toHaveBeenCalledTimes(1);
      const detail = statusChangeSpy.mock.calls[0][0].detail as string;
      expect(detail).toContain('Session rejected by telegram:11 (Frank) [stable:');
      expect(detail).toMatch(/\[stable:[0-9a-f]{16}\]/);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs a structured warning when relayAccountId drifts on a session_reject', async () => {
      const ctx1 = makeCtx();
      await handleInbound(
        {
          sessionId: 'sess-r2a',
          action: 'session_reject',
          actor: { type: 'telegram', userId: 12, firstName: 'Gina', relayAccountId: 'relay-X' },
        },
        asAppCtx(ctx1),
      );

      const ctx2 = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      await handleInbound(
        {
          sessionId: 'sess-r2b',
          action: 'session_reject',
          actor: { type: 'telegram', userId: 12, firstName: 'Gina', relayAccountId: 'relay-Y' },
        },
        asAppCtx(ctx2),
      );

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatchObject({
        component: 'server-inbound',
        operation: 'stable_actor_drift',
        sessionId: 'sess-r2b',
      });
    });
  });

  describe('fallback (no actor supplied)', () => {
    it('uses the default "telegram" string and emits no warning', async () => {
      const ctx = makeCtx();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const cmd: InboundCommand = { sessionId: 'sess-f1', action: 'session_approve' };
      await handleInbound(cmd, asAppCtx(ctx));

      const approvedBy = ctx.sessions.approveSession.mock.calls[0][1] as string;
      expect(approvedBy).toBe('telegram');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
