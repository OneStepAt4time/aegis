/**
 * Issue #3143: /read endpoint returns empty messages for ACP sessions.
 *
 * Tests that SessionTranscripts falls back to ACP event store when no JSONL
 * file exists, correctly converting ACP events to ParsedEntry format.
 */
import { describe, it, expect, vi } from 'vitest';
import { SessionTranscripts } from '../session-transcripts.js';
import type { SessionInfo, UIState } from '../session.js';
import type { Config } from '../config.js';
import type { AcpEventStore, AcpEventRecord } from '../services/acp/event-store.js';
import type { AcpEventJsonValue } from '../services/acp/event-store.js';

function makeConfig(): Config {
  return {
    claudeProjectsDir: '/tmp/nonexistent',
    stateDir: '/tmp/aegis-test-3143',
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
  } as unknown as Config;
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'test-session-3143',
    windowId: '',
    displayName: 'test-session',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle' as UIState,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 30_000,
    permissionStallMs: 60_000,
    permissionMode: 'default',
    ownerKeyId: 'key-1',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function makeEvent(eventType: string, payload: AcpEventJsonValue, seq = 1): AcpEventRecord {
  return {
    sessionId: 'test-session-3143',
    tenantId: 'tenant-1',
    ownerKeyId: 'key-1',
    eventSeq: seq,
    eventId: `evt-${seq}`,
    eventType,
    occurredAt: new Date(),
    ingestedAt: new Date(),
    payload,
  };
}

describe('Issue #3143: ACP event store fallback for /read', () => {
  it('returns empty when no JSONL path and no ACP event store', async () => {
    const transcripts = new SessionTranscripts(makeConfig());
    const session = makeSession();
    const result = await transcripts.readMessages(session);
    expect(result.messages).toEqual([]);
  });

  it('reads messages from ACP event store when no JSONL path exists', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('message.delta', { text: 'Hello ', messageId: 'msg-1' }, 1),
      makeEvent('message.delta', { text: 'world!', messageId: 'msg-1' }, 2),
      makeEvent('tool.started', { toolCallId: 'tc-1', title: 'ReadFile' }, 3),
      makeEvent('tool.completed', { toolCallId: 'tc-1', output: 'file contents' }, 4),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();
    const result = await transcripts.readMessages(session);

    expect(result.messages.length).toBe(3);
    // Message delta accumulated into single entry
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        contentType: 'text',
        text: 'Hello world!',
      }),
    );
    // Tool use
    expect(result.messages[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        contentType: 'tool_use',
        text: 'ReadFile',
        toolUseId: 'tc-1',
      }),
    );
    // Tool result
    expect(result.messages[2]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        contentType: 'tool_result',
        text: 'file contents',
        toolUseId: 'tc-1',
      }),
    );

    // Should have called list with correct scope
    expect(mockStore.list).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'test-session-3143',
        limit: 10_000,
      }),
    );
  });

  it('handles thinking delta events', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('thinking.delta', { text: 'Let me think...' }, 1),
      makeEvent('message.delta', { text: 'Here is the answer', messageId: 'msg-1' }, 2),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();
    const result = await transcripts.readMessages(session);

    expect(result.messages.length).toBe(2);
    expect(result.messages[0].contentType).toBe('thinking');
    expect(result.messages[0].text).toBe('Let me think...');
    expect(result.messages[1].contentType).toBe('text');
    expect(result.messages[1].text).toBe('Here is the answer');
  });

  it('flushes pending message when messageId changes', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('message.delta', { text: 'First message', messageId: 'msg-1' }, 1),
      makeEvent('message.delta', { text: 'Second message', messageId: 'msg-2' }, 2),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();
    const result = await transcripts.readMessages(session);

    expect(result.messages.length).toBe(2);
    expect(result.messages[0].text).toBe('First message');
    expect(result.messages[1].text).toBe('Second message');
  });

  it('handles permission request events', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('approval.requested', {
        toolCall: { title: 'Write file foo.txt', toolCallId: 'tc-1' },
        options: [{ id: 'allow', label: 'Allow' }],
      }, 1),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();
    const result = await transcripts.readMessages(session);

    expect(result.messages.length).toBe(1);
    expect(result.messages[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        contentType: 'permission_request',
        text: 'Write file foo.txt',
      }),
    );
  });

  it('skips unsupported event types', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('session.updated', { updateType: 'session_info_update' }, 1),
      makeEvent('usage.updated', { inputTokens: 100 }, 2),
      makeEvent('turn.completed', { stopReason: 'end_turn' }, 3),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();
    const result = await transcripts.readMessages(session);

    expect(result.messages).toEqual([]);
  });

  it('getCachedEntries falls back to ACP when no JSONL', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('message.delta', { text: 'Test message', messageId: 'msg-1' }, 1),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();

    // readTranscript uses getCachedEntries internally
    const result = await transcripts.readTranscript(session);
    expect(result.messages.length).toBe(1);
    expect(result.messages[0].text).toBe('Test message');
  });

  it('handles tool error in tool.completed', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockEvents: AcpEventRecord[] = [
      makeEvent('tool.completed', { toolCallId: 'tc-1', status: 'error', output: 'Permission denied' }, 1),
    ];

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue(mockEvents),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession();
    const result = await transcripts.readMessages(session);

    expect(result.messages.length).toBe(1);
    expect(result.messages[0].contentType).toBe('tool_error');
  });

  it('uses default scope when tenantId/ownerKeyId missing', async () => {
    const transcripts = new SessionTranscripts(makeConfig());

    const mockStore = {
      append: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    } as unknown as AcpEventStore;

    transcripts.setAcpEventStore(mockStore);
    const session = makeSession({ tenantId: undefined, ownerKeyId: undefined });
    await transcripts.readMessages(session);

    expect(mockStore.list).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'default',
        ownerKeyId: '',
      }),
    );
  });
});
