/**
 * channels/telegram-message-handler.test.ts — Tests for #4621.
 *
 * Targets ≥80% line coverage on src/channels/telegram/telegram-message-handler.ts.
 * Mocks telegram-sender (queueMessage / flushReads / addPendingRead / editMessage
 * / sendImmediate) and message-formatter (formatAssistantMessage / parseToolUse
 * / formatToolResult / formatProgressCard / formatTimestamp) so the handler can
 * be exercised in isolation without timing or external dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock telegram-sender: capture dispatch calls, bypass rate-limit + flush timers.
vi.mock('../../channels/telegram/telegram-sender.js', () => ({
  queueMessage: vi.fn().mockResolvedValue(undefined),
  flushReads: vi.fn().mockResolvedValue(undefined),
  flushQueue: vi.fn().mockResolvedValue(undefined),
  addPendingRead: vi.fn(),
  editMessage: vi.fn().mockResolvedValue(true),
  sendImmediate: vi.fn().mockResolvedValue(42),
}));

// Mock message-formatter: pure functions, replaced with deterministic stubs.
vi.mock('../../channels/telegram/message-formatter.js', () => ({
  formatTimestamp: vi.fn().mockReturnValue('[12/06/2026 10:30]'),
  formatAssistantMessage: vi.fn().mockReturnValue('💬 formatted assistant'),
  parseToolUse: vi.fn().mockReturnValue({
    icon: '📖', label: 'Read foo.txt', file: 'foo.txt', cmd: undefined, category: 'read',
  }),
  formatToolResult: vi.fn().mockReturnValue({ text: '✅ success', isError: false }),
  formatProgressCard: vi.fn().mockReturnValue('📊 progress card'),
}));

import { handleOnMessage } from '../../channels/telegram/telegram-message-handler.js';
import {
  queueMessage,
  flushReads,
  addPendingRead,
  editMessage,
  sendImmediate,
} from '../../channels/telegram/telegram-sender.js';
import {
  formatAssistantMessage,
  parseToolUse,
  formatToolResult,
  formatProgressCard,
} from '../../channels/telegram/message-formatter.js';
import type { TelegramChannelInternals, SessionProgress, ToolInfo } from '../../channels/telegram/types.js';
import type { SessionEventPayload, SessionEvent } from '../../channels/types.js';

const mockedQueueMessage = vi.mocked(queueMessage);
const mockedFlushReads = vi.mocked(flushReads);
const mockedAddPendingRead = vi.mocked(addPendingRead);
const mockedEditMessage = vi.mocked(editMessage);
const mockedSendImmediate = vi.mocked(sendImmediate);
const mockedFormatAssistant = vi.mocked(formatAssistantMessage);
const mockedParseToolUse = vi.mocked(parseToolUse);
const mockedFormatToolResult = vi.mocked(formatToolResult);
const mockedFormatProgressCard = vi.mocked(formatProgressCard);

type HandlerCtx = TelegramChannelInternals & { sendStyled(sessionId: string, styled: any): Promise<number | null> };

function makeCtx(opts: { verbose?: boolean; topicExists?: boolean } = {}): HandlerCtx {
  const verbose = opts.verbose ?? false;
  const topicExists = opts.topicExists ?? true;
  const ctx = {
    config: { botToken: 't', groupChatId: 'g', allowedUserIds: [], verbose },
    topics: new Map() as any,
    progress: new Map() as any,
    messageQueue: new Map() as any,
    lastSent: new Map() as any,
    flushTimers: new Map() as any,
    pendingTool: new Map() as any,
    inFlightCount: new Map() as any,
    pendingReads: new Map() as any,
    readTimer: new Map() as any,
    preTopicBuffer: new Map() as any,
    lastUserMessage: new Map() as any,
    rateLimitUntil: 0,
    pollOffset: 0,
    polling: false,
    pollBackoffMs: 1000,
    onInbound: null,
    topicCleanupTimers: new Map() as any,
    topicCleanupSweepTimer: null,
    topicTtlMs: 86400000,
    topicAutoDelete: true,
    topicPersistence: {} as any,
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
    } as SessionProgress);
  }
  return ctx as HandlerCtx;
}

function makePayload(event: SessionEvent, detail = 'test detail', meta?: Record<string, unknown>): SessionEventPayload {
  return {
    event,
    timestamp: '2026-06-12T10:30:00.000Z',
    session: { id: 's1', name: 'Test', workDir: '/test' },
    detail,
    meta,
  };
}

describe('handleOnMessage (#4621)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default parseToolUse returns a 'read' tool with a label+file
    mockedParseToolUse.mockReturnValue({
      icon: '📖', label: 'Read foo.txt', file: 'foo.txt', cmd: undefined, category: 'read',
    });
    mockedFormatToolResult.mockReturnValue({ text: '✅ success', isError: false });
    mockedFormatAssistant.mockReturnValue('💬 formatted assistant');
  });

  describe('pre-topic buffer (Issue #46)', () => {
    it('buffers message.user when topic does not exist', async () => {
      const ctx = makeCtx({ topicExists: false });
      await handleOnMessage(ctx, makePayload('message.user', 'hello'));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
      const buffered = ctx.preTopicBuffer.get('s1');
      expect(buffered).toHaveLength(1);
      expect(buffered![0].method).toBe('message');
    });
  });

  describe('message.user', () => {
    it('queues "User: <text>" with high priority on first call', async () => {
      const ctx = makeCtx();
      await handleOnMessage(ctx, makePayload('message.user', 'first message'));
      expect(mockedFlushReads).toHaveBeenCalledWith(ctx, 's1');
      expect(mockedQueueMessage).toHaveBeenCalledTimes(1);
      const [passedCtx, passedSessionId, text, priority] = mockedQueueMessage.mock.calls[0];
      expect(passedCtx).toBe(ctx);
      expect(passedSessionId).toBe('s1');
      expect(text).toContain('User:');
      expect(text).toContain('first message');
      expect(priority).toBe('high');
      expect(ctx.lastUserMessage.get('s1')).toBe('first message');
    });

    it('deduplicates consecutive identical user messages', async () => {
      const ctx = makeCtx();
      await handleOnMessage(ctx, makePayload('message.user', 'same'));
      await handleOnMessage(ctx, makePayload('message.user', 'same'));
      expect(mockedQueueMessage).toHaveBeenCalledTimes(1);
    });

    it('queues when the new detail differs from the last user message', async () => {
      const ctx = makeCtx();
      await handleOnMessage(ctx, makePayload('message.user', 'one'));
      await handleOnMessage(ctx, makePayload('message.user', 'two'));
      expect(mockedQueueMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('message.assistant', () => {
    it('queues the formatted assistant text with normal priority', async () => {
      const ctx = makeCtx();
      mockedFormatAssistant.mockReturnValue('💬 hello world');
      await handleOnMessage(ctx, makePayload('message.assistant', 'raw text'));
      expect(mockedQueueMessage).toHaveBeenCalledWith(ctx, 's1', '💬 hello world', 'normal');
      expect((ctx.progress.get('s1') as SessionProgress).lastMessage).toBe('raw text');
    });

    it('does not queue when formatAssistantMessage returns null', async () => {
      const ctx = makeCtx();
      mockedFormatAssistant.mockReturnValue(null);
      await handleOnMessage(ctx, makePayload('message.assistant', 'filler only'));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
    });
  });

  describe('message.thinking', () => {
    it('does not queue when verbose is false', async () => {
      const ctx = makeCtx({ verbose: false });
      await handleOnMessage(ctx, makePayload('message.thinking', 'some thinking'));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
    });

    it('queues italic thinking with low priority when verbose is true', async () => {
      const ctx = makeCtx({ verbose: true });
      await handleOnMessage(ctx, makePayload('message.thinking', 'deep thought'));
      expect(mockedQueueMessage).toHaveBeenCalledTimes(1);
      const [, , text, priority] = mockedQueueMessage.mock.calls[0];
      expect(text).toContain('💭');
      expect(priority).toBe('low');
    });

    it('does not queue when verbose is true but the thinking detail is empty', async () => {
      const ctx = makeCtx({ verbose: true });
      await handleOnMessage(ctx, makePayload('message.thinking', '   '));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
    });
  });

  describe('message.tool_use', () => {
    it('does nothing for empty detail', async () => {
      const ctx = makeCtx();
      await handleOnMessage(ctx, makePayload('message.tool_use', '   '));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
      expect(ctx.pendingTool.has('s1')).toBe(false);
    });

    it('records the parsed tool in pendingTool regardless of verbose mode', async () => {
      const ctx = makeCtx();
      const tool: ToolInfo = { icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read' };
      mockedParseToolUse.mockReturnValue(tool);
      await handleOnMessage(ctx, makePayload('message.tool_use', 'Read: a.ts'));
      expect(ctx.pendingTool.get('s1')).toBe(tool);
    });

    it('queues a label-only "Exec: …" message with normal priority in non-verbose mode', async () => {
      const ctx = makeCtx({ verbose: false });
      mockedParseToolUse.mockReturnValue({
        icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read',
      });
      await handleOnMessage(ctx, makePayload('message.tool_use', 'Read: a.ts'));
      const [, , text, priority] = mockedQueueMessage.mock.calls[0];
      expect(text).toContain('🛠️ Exec:');
      expect(text).toContain('Read a.ts');
      expect(priority).toBe('normal');
    });

    it('queues a verbose tool detail block in <pre> with low priority when verbose=true', async () => {
      const ctx = makeCtx({ verbose: true });
      mockedParseToolUse.mockReturnValue({
        icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read',
      });
      await handleOnMessage(ctx, makePayload('message.tool_use', 'Read: a.ts'));
      const [, , text, priority] = mockedQueueMessage.mock.calls[0];
      expect(text).toContain('<pre>');
      expect(priority).toBe('low');
    });

    it('does not queue a tool_use message when verbose=true and the tool has no label', async () => {
      const ctx = makeCtx({ verbose: true });
      mockedParseToolUse.mockReturnValue({
        icon: '', label: '', category: 'other',
      });
      await handleOnMessage(ctx, makePayload('message.tool_use', 'unrecognized tool'));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
    });

    it.each([
      ['read', 'reads', 'filesRead'],
      ['edit', 'edits', 'filesEdited'],
      ['create', 'creates', 'filesEdited'],
      ['search', 'searches', null],
      ['command', 'commands', null],
    ] as const)('increments progress counter for category=%s', async (category, counterKey, fileKey) => {
      const ctx = makeCtx();
      mockedParseToolUse.mockReturnValue({
        icon: '🔧', label: 'op', file: 'f.ts', category,
      });
      await handleOnMessage(ctx, makePayload('message.tool_use', 'op'));
      const progress = ctx.progress.get('s1') as SessionProgress;
      expect((progress as any)[counterKey]).toBe(1);
      if (fileKey) {
        expect((progress as any)[fileKey]).toContain('f.ts');
      }
    });
    it.each([
      ['edit', 'edits'],
      ['create', 'creates'],
      ['search', 'searches'],
      ['command', 'commands'],
    ] as const)('increments progress counter for category=%s in message.tool_result (edit/create hit dedup-rejected when file already in filesEdited)', async (category, counterKey) => {
      const ctx = makeCtx();
      // Pre-seed filesEdited to trigger the dedup-rejected branch in 'edit'/'create' cases
      // (the `!progress.filesEdited.includes(tool.file)` guard returns false → push skipped).
      if (category === 'edit' || category === 'create') {
        (ctx.progress.get('s1') as SessionProgress).filesEdited = ['a.ts'];
      }
      const tool: ToolInfo = { icon: '🔧', label: 'op', file: 'a.ts', category };
      ctx.pendingTool.set('s1', tool);
      // Non-success detail so the `!^(success|ok|done|completed|passed)$` regex misses and the
      // verbose=false branch runs to the progress counter switch (lines 130-133).
      await handleOnMessage(ctx, makePayload('message.tool_result', 'partial output'));
      const progress = ctx.progress.get('s1') as SessionProgress;
      // Type-narrowed switch on the counterKey literal — avoids untyped cast.
      switch (counterKey) {
        case 'edits': expect(progress.edits).toBe(1); break;
        case 'creates': expect(progress.creates).toBe(1); break;
        case 'searches': expect(progress.searches).toBe(1); break;
        case 'commands': expect(progress.commands).toBe(1); break;
      }
      if (category === 'edit' || category === 'create') {
        // Dedup-guard rejected the second push: filesEdited is still ['a.ts']
        expect(progress.filesEdited).toEqual(['a.ts']);
      }
    });
  });

  describe('message.tool_result', () => {
    it('does not queue a completion message for a "success" result but still increments the counter', async () => {
      const ctx = makeCtx();
      const tool: ToolInfo = { icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read' };
      ctx.pendingTool.set('s1', tool);
      await handleOnMessage(ctx, makePayload('message.tool_result', 'success'));
      expect(mockedQueueMessage).not.toHaveBeenCalled();
      const progress = ctx.progress.get('s1') as SessionProgress;
      expect(progress.reads).toBe(1);
      expect(ctx.pendingTool.has('s1')).toBe(false);
    });

    it('queues "Exec: completed; <summary>" for a non-success result in non-verbose mode', async () => {
      const ctx = makeCtx();
      ctx.pendingTool.set('s1', {
        icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read',
      });
      await handleOnMessage(ctx, makePayload('message.tool_result', 'partial output here'));
      const [, , text, priority] = mockedQueueMessage.mock.calls[0];
      expect(text).toContain('completed;');
      expect(priority).toBe('normal');
    });

    it('routes a verbose tool_result through formatToolResult and queues success with normal priority', async () => {
      const ctx = makeCtx({ verbose: true });
      ctx.pendingTool.set('s1', { icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read' });
      mockedFormatToolResult.mockReturnValue({ text: '✅ ok', isError: false });
      await handleOnMessage(ctx, makePayload('message.tool_result', 'raw output'));
      expect(mockedFormatToolResult).toHaveBeenCalledWith('raw output');
      expect(mockedFlushReads).toHaveBeenCalledWith(ctx, 's1');
      expect(mockedQueueMessage).toHaveBeenCalledWith(ctx, 's1', '✅ ok', 'normal');
    });

    it('sends a styleAlert via sendStyled for a command-category error result', async () => {
      const ctx = makeCtx({ verbose: true });
      ctx.pendingTool.set('s1', { icon: '💻', label: 'pnpm test', cmd: 'pnpm test', category: 'command' });
      mockedFormatToolResult.mockReturnValue({ text: '❌ 3 tests failed', isError: true });
      await handleOnMessage(ctx, makePayload('message.tool_result', 'failed'));
      expect(ctx.sendStyled).toHaveBeenCalledTimes(1);
      const styled = (ctx.sendStyled as any).mock.calls[0][1];
      expect(styled.text).toContain('pnpm test'); // tool.label drives the alert title
      expect(mockedQueueMessage).not.toHaveBeenCalled();
    });

    it('queues a non-command error result with high priority', async () => {
      const ctx = makeCtx({ verbose: true });
      ctx.pendingTool.set('s1', { icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read' });
      mockedFormatToolResult.mockReturnValue({ text: '❌ ENOENT', isError: true });
      await handleOnMessage(ctx, makePayload('message.tool_result', 'missing'));
      expect(mockedQueueMessage).toHaveBeenCalledWith(ctx, 's1', '❌ ENOENT', 'high');
      const progress = ctx.progress.get('s1') as SessionProgress;
      expect(progress.errors).toBe(1);
    });

    it('adds a pending read for a read-category tool when formatToolResult returns null', async () => {
      const ctx = makeCtx({ verbose: true });
      ctx.pendingTool.set('s1', { icon: '📖', label: 'Read a.ts', file: 'a.ts', category: 'read' });
      mockedFormatToolResult.mockReturnValue(null);
      await handleOnMessage(ctx, makePayload('message.tool_result', 'ok'));
      expect(mockedAddPendingRead).toHaveBeenCalledWith(ctx, 's1', 'a.ts');
    });

    it('flushes reads and queues the tool label for an other-category tool when formatToolResult returns null', async () => {
      const ctx = makeCtx({ verbose: true });
      ctx.pendingTool.set('s1', { icon: '🔧', label: 'mystery-tool', category: 'other' });
      mockedFormatToolResult.mockReturnValue(null);
      await handleOnMessage(ctx, makePayload('message.tool_result', 'ok'));
      expect(mockedFlushReads).toHaveBeenCalledWith(ctx, 's1');
      expect(mockedQueueMessage).toHaveBeenCalledTimes(1);
      const [, , text] = mockedQueueMessage.mock.calls[0];
      expect(text).toContain('mystery-tool');
    });
  });

  describe('progress card every 5 messages', () => {
    it('emits a progress card by sending a new message when the 5th message is processed and no messageId is set', async () => {
      const ctx = makeCtx();
      const progress = ctx.progress.get('s1') as SessionProgress;
      progress.totalMessages = 4; // post-increment becomes 5 → emit
      await handleOnMessage(ctx, makePayload('message.assistant', 'hi'));
      expect(mockedFormatProgressCard).toHaveBeenCalledWith(progress);
      expect(mockedFlushReads).toHaveBeenCalled();
      expect(mockedSendImmediate).toHaveBeenCalledWith(ctx, 's1', '📊 progress card');
      expect(progress.progressMessageId).toBe(42);
    });

    it('edits the existing progress message when one is already set', async () => {
      const ctx = makeCtx();
      const progress = ctx.progress.get('s1') as SessionProgress;
      progress.progressMessageId = 99;
      progress.totalMessages = 4; // post-increment becomes 5 → edit the existing msg
      await handleOnMessage(ctx, makePayload('message.assistant', 'hi'));
      expect(mockedEditMessage).toHaveBeenCalledWith(ctx, 's1', 99, '📊 progress card');
      expect(mockedSendImmediate).not.toHaveBeenCalled();
    });

    it('does not emit a progress card when the post-increment totalMessages is not a multiple of 5', async () => {
      const ctx = makeCtx();
      const progress = ctx.progress.get('s1') as SessionProgress;
      progress.totalMessages = 0; // post-increment becomes 1, no card
      await handleOnMessage(ctx, makePayload('message.assistant', 'hi'));
      expect(mockedSendImmediate).not.toHaveBeenCalled();
      expect(mockedEditMessage).not.toHaveBeenCalled();
    });
  });
});
