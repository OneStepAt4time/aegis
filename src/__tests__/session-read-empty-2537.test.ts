/**
 * session-read-empty-2537.test.ts — Regression test for Issue #2537.
 *
 * Bug: /v1/sessions/:id/read returns empty messages array even when the
 * JSONL transcript file has content. Root cause: discoverFromFilesystemFallback
 * preserved stale byteOffset instead of resetting to 0 when discovering a new
 * JSONL path.
 *
 * Fix: Reset both byteOffset and monitorOffset to 0 in the filesystem fallback
 * discovery, matching the behavior of the primary discovery paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionTranscripts } from '../session-transcripts.js';
import { computeProjectHash } from '../path-utils.js';
import type { SessionInfo } from '../session.js';

function makeJsonlContent(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: `Message ${i + 1}`,
      },
      timestamp: new Date().toISOString(),
    }));
  }
  return lines.join('\n');
}

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  // Use a createdAt in the past so the filesystem fallback's mtime check passes
  // (JSONL files created in the test will have mtime > createdAt)
  const pastTimestamp = Date.now() - 60_000; // 1 minute ago
  return {
    id: 'test-session-2537',
    windowId: '@2537',
    windowName: 'cc-2537-test',
    workDir: '/tmp/test-2537',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'unknown',
    createdAt: pastTimestamp,
    lastActivity: pastTimestamp,
    stallThresholdMs: 300_000,
    permissionStallMs: 300_000,
    permissionMode: 'default',
    ...overrides,
  } as SessionInfo;
}

describe('Issue #2537: /read returns empty messages despite JSONL content', () => {
  let tmpDir: string;
  let projectDir: string;
  let transcripts: SessionTranscripts;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-2537-'));
    // computeProjectHash('/tmp/test-2537') = '-tmp-test-2537'
    const projectHash = computeProjectHash('/tmp/test-2537');
    projectDir = join(tmpDir, 'projects', projectHash);
    mkdirSync(projectDir, { recursive: true });

    const tmuxStub = {
      capturePane: vi.fn(async () => 'some pane text'),
      capturePaneDirect: vi.fn(async () => 'some pane text'),
    } as any;

    const configStub = {
      claudeProjectsDir: join(tmpDir, 'projects'),
      worktreeAwareContinuation: false,
      worktreeSiblingDirs: [],
    } as any;

    transcripts = new SessionTranscripts(tmuxStub, configStub);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true }); } catch { /* best effort */ }
  });

  it('resets byteOffset to 0 when discovering JSONL via filesystem fallback', async () => {
    // Create a JSONL file in the project directory
    const claudeSessionId = 'aaaaaaaa-2537-2537-2537-aaaaaaaaaaaa';
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`);
    writeFileSync(jsonlPath, makeJsonlContent(5));

    // Session has stale byteOffset (simulating state loaded from disk after restart)
    const session = makeSession({
      workDir: '/tmp/test-2537',  // matches project hash
      byteOffset: 2288,           // Stale offset from prior session
      monitorOffset: 2288,
      claudeSessionId: undefined, // Never discovered via hooks
      jsonlPath: undefined,       // Lost after restart
    });

    const result = await transcripts.readMessages(session);

    // Should have discovered the JSONL and reset offsets to 0
    expect(session.jsonlPath).toBe(jsonlPath);
    expect(session.claudeSessionId).toBe(claudeSessionId);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('returns messages on first read when JSONL has content', async () => {
    const claudeSessionId = 'bbbbbbbb-2537-2537-2537-bbbbbbbbbbbb';
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`);
    writeFileSync(jsonlPath, makeJsonlContent(5));

    const session = makeSession({
      workDir: '/tmp/test-2537',
      byteOffset: 0,
      claudeSessionId: undefined,
      jsonlPath: undefined,
    });

    const result = await transcripts.readMessages(session);
    expect(result.messages.length).toBe(5);
  });

  it('resets both byteOffset and monitorOffset on filesystem fallback discovery', async () => {
    const claudeSessionId = 'cccccccc-2537-2537-2537-cccccccccccc';
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`);
    writeFileSync(jsonlPath, makeJsonlContent(3));

    const session = makeSession({
      workDir: '/tmp/test-2537',
      byteOffset: 9999,   // Stale
      monitorOffset: 9999, // Stale
      claudeSessionId: undefined,
      jsonlPath: undefined,
    });

    const result = await transcripts.readMessages(session);

    // Both offsets should be reset and then advanced past the content
    expect(session.byteOffset).toBeGreaterThan(0);
    expect(session.byteOffset).toBeLessThan(9999);
    expect(result.messages.length).toBe(3);
  });

  it('handles JSONL discovery after jsonlPath invalidation', async () => {
    const claudeSessionId = 'dddddddd-2537-2537-2537-dddddddddddd';
    const jsonlPath = join(projectDir, `${claudeSessionId}.jsonl`);
    writeFileSync(jsonlPath, makeJsonlContent(5));

    // Simulate: session had a jsonlPath that was set, read happened (offset advanced),
    // then the file was moved/deleted, and a new file appeared.
    const staleJsonlPath = join(projectDir, 'stale-session.jsonl');

    const session = makeSession({
      workDir: '/tmp/test-2537',
      byteOffset: 2288,
      monitorOffset: 2288,
      claudeSessionId: undefined, // No claudeSessionId — fallback discovery required
      jsonlPath: staleJsonlPath,  // Points to a file that doesn't exist
    });

    const result = await transcripts.readMessages(session);

    // Should have invalidated the stale path, discovered the new one, reset offsets
    expect(session.jsonlPath).toBe(jsonlPath);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
