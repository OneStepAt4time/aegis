/**
 * ADR-0034 M4: Gate CC JSONL transcript parsing on runnerName.
 * Non-claude-code runners must never trigger JSONL discovery or parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionTranscripts } from '../session-transcripts.js';
import type { SessionInfo, UIState } from '../session-types.js';
import type { Config } from '../config.js';

vi.mock('../transcript.js', () => ({
  findSessionFile: vi.fn().mockResolvedValue('/fake/path/session.jsonl'),
  readNewEntries: vi.fn().mockResolvedValue({ entries: [{ role: 'assistant', contentType: 'text', text: 'hello' }], newOffset: 100, raw: [] }),
}));

vi.mock('../worktree-lookup.js', () => ({
  findSessionFileWithFanout: vi.fn().mockResolvedValue('/fake/path/session.jsonl'),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock('../services/acp/transcript-events.js', () => ({
  listAllTranscriptEvents: vi.fn().mockResolvedValue([]),
}));

function makeConfig(): Config {
  return {
    claudeProjectsDir: '/fake/claude/projects',
    stateDir: '/tmp/aegis-test',
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
  } as unknown as Config;
}

function makeSession(runnerName?: string): SessionInfo {
  return {
    id: 'sess-1',
    windowId: '',
    displayName: 'test',
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
    runnerName,
    claudeSessionId: 'cc-session-uuid',
  } as SessionInfo;
}

describe('ADR-0034 M4: transcript runner gate', () => {
  let transcripts: SessionTranscripts;
  let findSessionFile: ReturnType<typeof vi.fn>;
  let readNewEntries: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const transcriptMod = await import('../transcript.js');
    findSessionFile = transcriptMod.findSessionFile as ReturnType<typeof vi.fn>;
    readNewEntries = transcriptMod.readNewEntries as ReturnType<typeof vi.fn>;
    transcripts = new SessionTranscripts(makeConfig());
  });

  it('claude-code runner: discovers JSONL and parses', async () => {
    const session = makeSession('claude-code');
    const result = await transcripts.readMessages(session);
    expect(findSessionFile).toHaveBeenCalled();
    expect(readNewEntries).toHaveBeenCalled();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('undefined runnerName (legacy): discovers JSONL and parses', async () => {
    const session = makeSession(undefined);
    await transcripts.readMessages(session);
    expect(findSessionFile).toHaveBeenCalled();
    expect(readNewEntries).toHaveBeenCalled();
  });

  it('kimi runner: skips JSONL discovery and returns empty', async () => {
    const session = makeSession('kimi');
    const result = await transcripts.readMessages(session);
    expect(findSessionFile).not.toHaveBeenCalled();
    expect(readNewEntries).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
    expect(session.jsonlPath).toBeUndefined();
  });

  it('kimi runner: readMessagesForMonitor skips JSONL', async () => {
    const session = makeSession('kimi');
    const result = await transcripts.readMessagesForMonitor(session);
    expect(findSessionFile).not.toHaveBeenCalled();
    expect(readNewEntries).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
  });

  it('kimi runner: readTranscript returns empty', async () => {
    const session = makeSession('kimi');
    const result = await transcripts.readTranscript(session);
    expect(findSessionFile).not.toHaveBeenCalled();
    expect(readNewEntries).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('kimi runner: readTranscriptCursor returns empty', async () => {
    const session = makeSession('kimi');
    const result = await transcripts.readTranscriptCursor(session);
    expect(findSessionFile).not.toHaveBeenCalled();
    expect(readNewEntries).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
  });

  it('kimi runner with ACP event store: uses ACP events not JSONL', async () => {
    const session = makeSession('kimi');
    const fakeStore = {} as never;
    const fakeEvents = [{ role: 'assistant' as const, contentType: 'text' as const, text: 'acp-reply' }];
    // readFromAcpEvents is private; verify by checking JSONL mocks stay uncalled
    transcripts.setAcpEventStore(fakeStore);
    await transcripts.readMessages(session);
    expect(findSessionFile).not.toHaveBeenCalled();
    expect(readNewEntries).not.toHaveBeenCalled();
    void fakeEvents; // suppress unused warning
  });
});
