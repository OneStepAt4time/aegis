/**
 * Issue #3863: Transcript API must return full (untruncated) assistant messages.
 *
 * Root cause: getCachedEntries() truncated text to MAX_CACHED_TEXT_LENGTH (2048 chars).
 * Fix: readTranscript() and readTranscriptCursor() now use getFullEntries() which
 * reads directly from JSONL without cache truncation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionTranscripts } from '../session-transcripts.js';
import type { SessionInfo } from '../session.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), 'aegis-test-3863');
const JSONL_PATH = join(TEST_DIR, 'session.jsonl');

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    status: 'idle',
    workDir: '/tmp/test',
    byteOffset: 0,
    monitorOffset: 0,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 120000,
    permissionStallMs: 300000,
    permissionMode: 'default',
    settingsPatched: false,
    ownerKeyId: 'test-key',
    tenantId: '_system',
    runnerName: 'claude-code',
    isolationMode: 'worktree',
    isolationPolicy: 'respect-cc',
    jsonlPath: JSONL_PATH,
    ...overrides,
  } as SessionInfo;
}

// We mock readNewEntries but the actual code also checks existsSync
// So we create real JSONL files and let the real readNewEntries work.
// But for unit test isolation, let's mock readNewEntries and ensure the file exists.

vi.mock('../transcript.js', () => ({
  readNewEntries: vi.fn(),
  findSessionFile: vi.fn().mockResolvedValue(null),
  findSessionFileWithFanout: vi.fn().mockResolvedValue(null),
}));

import { readNewEntries } from '../transcript.js';
const mockReadNewEntries = vi.mocked(readNewEntries);

const LONG_TEXT = 'A'.repeat(5000);

describe('#3863: getFullEntries returns untruncated text', () => {
  let transcripts: SessionTranscripts;

  beforeEach(() => {
    vi.clearAllMocks();
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(JSONL_PATH, ''); // Ensure existsSync passes
    transcripts = new SessionTranscripts({
      claudeProjectsDir: '/tmp/.claude/projects',
      worktreeAwareContinuation: false,
      worktreeSiblingDirs: [],
    } as any);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('readTranscript returns full text (not truncated to 2048)', async () => {
    mockReadNewEntries.mockResolvedValue({
      entries: [
        { role: 'assistant', contentType: 'text', text: LONG_TEXT, timestamp: '2026-05-20T00:00:00Z' },
      ],
      newOffset: 100,
      raw: '',
    });

    const result = await transcripts.readTranscript(makeSession(), 1, 50);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe(LONG_TEXT);
    expect(result.messages[0].text.length).toBe(5000);
  });

  it('readTranscriptCursor returns full text (not truncated to 2048)', async () => {
    mockReadNewEntries.mockResolvedValue({
      entries: [
        { role: 'assistant', contentType: 'text', text: LONG_TEXT, timestamp: '2026-05-20T00:00:00Z' },
      ],
      newOffset: 100,
      raw: '',
    });

    const result = await transcripts.readTranscriptCursor(makeSession(), undefined, 50);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe(LONG_TEXT);
    expect(result.messages[0].text.length).toBe(5000);
  });

  it('readTranscript returns multiple untruncated entries', async () => {
    const text1 = 'X'.repeat(3000);
    const text2 = 'Y'.repeat(6000);

    mockReadNewEntries.mockResolvedValue({
      entries: [
        { role: 'user', contentType: 'text', text: 'short query', timestamp: '2026-05-20T00:00:00Z' },
        { role: 'assistant', contentType: 'text', text: text1, timestamp: '2026-05-20T00:00:01Z' },
        { role: 'assistant', contentType: 'text', text: text2, timestamp: '2026-05-20T00:00:02Z' },
      ],
      newOffset: 300,
      raw: '',
    });

    const result = await transcripts.readTranscript(makeSession(), 1, 50);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].text).toBe(text1);
    expect(result.messages[2].text).toBe(text2);
  });

  it('readTranscript with roleFilter preserves full text', async () => {
    mockReadNewEntries.mockResolvedValue({
      entries: [
        { role: 'user', contentType: 'text', text: 'short', timestamp: '2026-05-20T00:00:00Z' },
        { role: 'assistant', contentType: 'text', text: LONG_TEXT, timestamp: '2026-05-20T00:00:01Z' },
      ],
      newOffset: 200,
      raw: '',
    });

    const result = await transcripts.readTranscript(makeSession(), 1, 50, 'assistant');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].text).toBe(LONG_TEXT);
    expect(result.messages[0].text.length).toBe(5000);
  });

  it('falls back to empty array when JSONL read fails', async () => {
    mockReadNewEntries.mockRejectedValue(new Error('ENOENT'));

    const result = await transcripts.readTranscript(makeSession(), 1, 50);

    expect(result.messages).toHaveLength(0);
  });
});
