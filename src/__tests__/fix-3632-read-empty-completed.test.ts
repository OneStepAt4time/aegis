/**
 * Issue #3632: GET /v1/sessions/:id/read returns empty messages for completed sessions.
 *
 * Root cause: session.byteOffset was consumed during the session by prior reads
 * (dashboard polling, MCP getTranscript, etc.). When the session completes and
 * the user calls /read, byteOffset is at the end of the file → 0 new messages.
 *
 * Fix: In readMessages(), when the session is idle/killed and returns empty,
 * reset byteOffset to 0 and re-read the full JSONL transcript.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionTranscripts } from '../session-transcripts.js';
import type { SessionInfo } from '../session.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'a9e04f5e-ba93-4ec7-b0d6-76648b4a33e5',
    displayName: 'test-session',
    workDir: '/tmp/test',
    status: 'idle',
    createdAt: Date.now() - 60_000,
    lastActivity: Date.now(),
    stallThresholdMs: 120_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    settingsPatched: false,
    ownerKeyId: 'test-key',
    tenantId: 'default',
    byteOffset: 0,
    monitorOffset: 0,
    windowId: "", isolationMode: "worktree",
    ...overrides,
  };
}

describe('Issue #3632: readMessages returns empty for completed sessions', () => {
  const testDir = join(tmpdir(), 'aegis-test-3632');
  let transcripts: SessionTranscripts;
  let jsonlPath: string;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    jsonlPath = join(testDir, 'session.jsonl');

    transcripts = new SessionTranscripts({
      claudeProjectsDir: testDir,
      configDir: testDir,
    } as any);
  });

  it('returns empty when byteOffset is at end and session is working (no reset)', async () => {
    // Write a JSONL with content
    const entries = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } }),
    ].join('\n');
    writeFileSync(jsonlPath, entries);

    const session = makeSession({
      status: 'working',
      jsonlPath,
      byteOffset: Buffer.byteLength(entries), // at end
    });

    const result = await transcripts.readMessages(session);
    // Working session: should NOT reset, returns empty (expected streaming behavior)
    expect(result.messages.length).toBe(0);
  });

  it('returns full transcript when byteOffset is at end and session is idle', async () => {
    const entries = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } }),
    ].join('\n');
    writeFileSync(jsonlPath, entries);

    const session = makeSession({
      status: 'idle',
      jsonlPath,
      byteOffset: Buffer.byteLength(entries), // at end — consumed during session
    });

    const result = await transcripts.readMessages(session);
    // Idle session: should reset byteOffset and return full transcript
    expect(result.messages.length).toBeGreaterThan(0);
    expect(session.byteOffset).toBe(Buffer.byteLength(entries));
  });

  it('returns full transcript when byteOffset is at end and session is killed', async () => {
    const entries = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'response' }] } }),
    ].join('\n');
    writeFileSync(jsonlPath, entries);

    const session = makeSession({
      status: 'killed',
      jsonlPath,
      byteOffset: Buffer.byteLength(entries),
    });

    const result = await transcripts.readMessages(session);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('does not reset when byteOffset is 0 (nothing consumed)', async () => {
    const entries = [
      JSON.stringify({ type: 'user', message: { content: 'hello' } }),
    ].join('\n');
    writeFileSync(jsonlPath, entries);

    const session = makeSession({
      status: 'idle',
      jsonlPath,
      byteOffset: 0,
    });

    const result = await transcripts.readMessages(session);
    expect(result.messages.length).toBe(1);
    expect(session.byteOffset).toBe(Buffer.byteLength(entries));
  });

  it('does not reset when there are new messages (streaming works normally)', async () => {
    const entry1 = JSON.stringify({ type: 'user', message: { content: 'hello' } });
    const entry2 = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'world' }] } });
    const full = entry1 + '\n' + entry2;
    writeFileSync(jsonlPath, full);

    // byteOffset at end of first entry
    const session = makeSession({
      status: 'idle',
      jsonlPath,
      byteOffset: Buffer.byteLength(entry1 + '\n'),
    });

    const result = await transcripts.readMessages(session);
    // Has new messages — no reset needed
    expect(result.messages.length).toBe(1); // just the assistant message
  });
});
