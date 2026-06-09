/**
 * channels/telegram-status-handler.test.ts — Tests for #4621.
 *
 * Targets ≥80% line coverage on src/channels/telegram/telegram-status-handler.ts.
 * Mocks telegram-sender to capture sendImmediate/flushReads/flushQueue dispatches
 * and verify the styled-message content sent through ctx.sendStyled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../channels/telegram/telegram-sender.js', () => ({
  sendImmediate: vi.fn().mockResolvedValue(42),
  flushReads: vi.fn().mockResolvedValue(undefined),
  flushQueue: vi.fn().mockResolvedValue(undefined),
  queueMessage: vi.fn().mockResolvedValue(undefined),
  addPendingRead: vi.fn(),
  editMessage: vi.fn().mockResolvedValue(true),
}));

import { handleOnStatusChange } from '../../channels/telegram/telegram-status-handler.js';
import { sendImmediate, flushReads, flushQueue } from '../../channels/telegram/telegram-sender.js';
import type { TelegramChannelInternals, SessionProgress } from '../../channels/telegram/types.js';
import type { SessionEventPayload, SessionEvent } from '../../channels/types.js';

const mockedSendImmediate = vi.mocked(sendImmediate);
const mockedFlushReads = vi.mocked(flushReads);
const mockedFlushQueue = vi.mocked(flushQueue);

type HandlerCtx = TelegramChannelInternals & { sendStyled(sessionId: string, styled: any): Promise<number | null> };

function makeCtx(opts: { topicExists?: boolean } = {}): HandlerCtx {
  const topicExists = opts.topicExists ?? true;
  const ctx: any = {
    config: { botToken: 't', groupChatId: 'g', allowedUserIds: [], verbose: false },
    topics: new Map(),
    progress: new Map(),
    messageQueue: new Map(),
    lastSent: new Map(),
    flushTimers: new Map(),
    pendingTool: new Map(),
    inFlightCount: new Map(),
    pendingReads: new Map(),
    readTimer: new Map(),
    preTopicBuffer: new Map(),
    lastUserMessage: new Map(),
    rateLimitUntil: 0,
    pollOffset: 0,
    polling: false,
    pollBackoffMs: 1000,
    onInbound: null,
    topicCleanupTimers: new Map(),
    topicCleanupSweepTimer: null,
    topicTtlMs: 86400000,
    topicAutoDelete: true,
    topicPersistence: {},
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    deliveryFailCount: 0,
    pollLoopPromise: Promise.resolve(),
    tgApi: vi.fn().mockResolvedValue({}),
    trackSuccess: vi.fn(),
    trackFailure: vi.fn(),
    redactError: vi.fn((e: unknown) => e),
    sendStyled: vi.fn().mockResolvedValue(100),
  };
  if (topicExists) {
    ctx.topics.set('s1', {
      sessionId: 's1', topicId: 1, displayName: 's1',
      endedAt: null, cleanupScheduledAt: null, cleanupRetries: 0, deleting: false,
    });
    ctx.progress.set('s1', {
      totalMessages: 0, reads: 0, edits: 0, creates: 0, commands: 0, searches: 0, errors: 0,
      filesRead: [], filesEdited: [], startedAt: 1_000_000, lastMessage: '', currentStatus: 'starting',
      progressMessageId: null,
    });
  }
  return ctx as HandlerCtx;
}

function makePayload(event: SessionEvent, detail = 'detail', meta?: Record<string, unknown>): SessionEventPayload {
  return {
    event,
    timestamp: '2026-06-12T10:30:00.000Z',
    session: { id: 's1', name: 'Test', workDir: '/test' },
    detail,
    meta,
  };
}

describe('handleOnStatusChange (#4621)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pre-topic buffer', () => {
    it('buffers a status event when the topic does not exist', async () => {
      const ctx = makeCtx({ topicExists: false });
      await handleOnStatusChange(ctx, makePayload('status.idle'));
      expect(ctx.preTopicBuffer.get('s1')).toEqual([
        { method: 'statusChange', payload: expect.objectContaining({ event: 'status.idle' }) },
      ]);
    });
  });

  describe('progress.currentStatus tracking', () => {
    it('updates currentStatus to the suffix after "status."', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.idle'));
      expect((ctx.progress.get('s1') as SessionProgress).currentStatus).toBe('idle');
    });
  });

  describe('status.permission', () => {
    it('sends Approve/Reject buttons when the detail has no parseable options', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.permission', 'Run this Bash command?'));
      expect(mockedFlushReads).toHaveBeenCalledWith(ctx, 's1');
      expect(mockedFlushQueue).toHaveBeenCalledWith(ctx, 's1');
      expect(ctx.sendStyled).toHaveBeenCalledTimes(1);
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      expect(styled.text).toContain('Permission:');
      const buttons = styled.reply_markup.inline_keyboard[0];
      expect(buttons.map((b: any) => b.text)).toEqual(['✅ Approve', '❌ Reject']);
    });

    it('sends option buttons when the detail has numbered options', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.permission', '1. Yes\n2. Yes, allow all\n3. No'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      const buttons = styled.reply_markup.inline_keyboard[0];
      expect(buttons.length).toBe(3);
      expect(buttons[0].text).toMatch(/^1\./);
      expect(buttons[0].callback_data).toMatch(/^cb_option:s1:1$/);
    });
  });

  describe('status.idle / status.working', () => {
    it('status.idle is a no-op except for progress tracking', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.idle'));
      expect(ctx.sendStyled).not.toHaveBeenCalled();
      expect(mockedSendImmediate).not.toHaveBeenCalled();
    });

    it('status.working is a no-op except for progress tracking', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.working'));
      expect(ctx.sendStyled).not.toHaveBeenCalled();
      expect(mockedSendImmediate).not.toHaveBeenCalled();
    });
  });

  describe('status.question', () => {
    it('sends Yes/No/Skip buttons when the detail has no parseable options', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.question', 'Continue?'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      const buttons = styled.reply_markup.inline_keyboard[0];
      expect(buttons.map((b: any) => b.text)).toEqual(['✅ Yes', '❌ No', '🤷 Skip']);
    });

    it('adds a Skip button when there are options and fewer than 4', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.question', '1. First\n2. Second'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      const buttons = styled.reply_markup.inline_keyboard[0];
      expect(buttons.length).toBe(3); // 2 options + 1 skip
      expect(buttons[2].text).toBe('🤷 Skip');
    });

    it('omits the Skip button when there are 4 or more options', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.question', '1. A\n2. B\n3. C\n4. D'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      const buttons = styled.reply_markup.inline_keyboard[0];
      expect(buttons.length).toBe(4);
    });
  });

  describe('status.plan', () => {
    it('sends a single-line plan without a blockquote body', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.plan', 'First line only'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      expect(styled.text).toContain('📋');
      expect(styled.text).not.toContain('<blockquote');
      const row = styled.reply_markup.inline_keyboard[0];
      expect(row.map((b: any) => b.text)).toEqual(['▶ Execute', '⚡ Execute All', '❌ Cancel']);
    });

    it('wraps the multi-line plan body in an expandable blockquote', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('status.plan', 'Summary line\nbody line 1\nbody line 2'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      expect(styled.text).toContain('<blockquote expandable>');
    });
  });

  describe('swarm.teammate_spawned', () => {
    it('includes both teammateName and teammateWindowId when both are present', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('swarm.teammate_spawned', 'spawned', {
        teammateName: 'explorer',
        teammateWindowId: 'win-42',
      }));
      expect(mockedFlushReads).toHaveBeenCalledWith(ctx, 's1');
      expect(mockedSendImmediate).toHaveBeenCalledTimes(1);
      const [, , text] = mockedSendImmediate.mock.calls[0];
      expect(text).toContain('explorer');
      expect(text).toContain('win-42');
      expect(text).toContain('🔧 Teammate');
      expect(text).toContain('spawned');
    });

    it('uses "unknown" for teammateName when meta is missing', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('swarm.teammate_spawned', 'spawned'));
      const [, , text] = mockedSendImmediate.mock.calls[0];
      expect(text).toContain('unknown');
      expect(text).not.toContain('win-');
    });
  });

  describe('swarm.teammate_finished', () => {
    it('emits the "Teammate … finished" message with the teammate name', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('swarm.teammate_finished', 'done', { teammateName: 'reviewer' }));
      const [, , text] = mockedSendImmediate.mock.calls[0];
      expect(text).toContain('✅ Teammate');
      expect(text).toContain('reviewer');
      expect(text).toContain('finished');
    });

    it('falls back to "unknown" when teammateName is absent', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('swarm.teammate_finished', 'done'));
      const [, , text] = mockedSendImmediate.mock.calls[0];
      expect(text).toContain('unknown');
    });
  });

  describe('session.awaiting_approval', () => {
    it('sends a styled message with Approve/Reject buttons', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('session.awaiting_approval', 'need approval'));
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      expect(styled.text).toContain('Session Approval Required');
      const row = styled.reply_markup.inline_keyboard[0];
      expect(row.map((b: any) => b.text)).toEqual(['✅ Approve', '❌ Reject']);
      expect(row[0].callback_data).toBe('session_approve:s1');
    });
  });

  describe('session.approved / session.rejected', () => {
    it('emits "Session … approved" via sendImmediate', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('session.approved', 'approved'));
      const [, , text] = mockedSendImmediate.mock.calls[0];
      expect(text).toContain('✅ Session');
      expect(text).toContain('approved');
    });

    it('emits "Session … rejected" via sendImmediate', async () => {
      const ctx = makeCtx();
      await handleOnStatusChange(ctx, makePayload('session.rejected', 'rejected'));
      const [, , text] = mockedSendImmediate.mock.calls[0];
      expect(text).toContain('❌ Session');
      expect(text).toContain('rejected');
    });
  });
});
