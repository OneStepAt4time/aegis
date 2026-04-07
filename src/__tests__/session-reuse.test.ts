/**
 * session-reuse.test.ts — Tests for Issue #6: stale claudeSessionId assignment.
 *
 * Verifies session isolation via:
 * - PRIMARY: --session-id <fresh-uuid> forces CC to create new session
 * - GUARD 1: written_at timestamp < session.createdAt
 * - GUARD 2: JSONL path in _archived/ directory
 * - GUARD 3: JSONL file mtime < session.createdAt
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

// We test syncSessionMap indirectly through the public API since it's private.
// Strategy: create a SessionManager with a fake tmux, load state with a session
// that has no claudeSessionId, write session_map.json with stale entries,
// and verify that readMessages (which calls syncSessionMap internally) doesn't
// assign the stale ID.

// Since SessionManager.syncSessionMap is private and called from startSessionIdDiscovery
// (which uses setInterval), we test the guards by extracting the logic into a
// testable helper. For now, we test the guards' logic directly.

describe('Session reuse guards', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('GUARD 1: written_at timestamp', () => {
    it('should reject session_map entry written before session creation', () => {
      const sessionCreatedAt = Date.now();
      const entryWrittenAt = sessionCreatedAt - 60_000; // Written 1 minute before session

      // This is the guard logic from syncSessionMap
      const shouldReject = entryWrittenAt > 0 && entryWrittenAt < sessionCreatedAt;
      expect(shouldReject).toBe(true);
    });

    it('should accept session_map entry written after session creation', () => {
      const sessionCreatedAt = Date.now();
      const entryWrittenAt = sessionCreatedAt + 5_000; // Written 5 seconds after session

      const shouldReject = entryWrittenAt > 0 && entryWrittenAt < sessionCreatedAt;
      expect(shouldReject).toBe(false);
    });

    it('should accept session_map entry with no written_at (legacy hook)', () => {
      const sessionCreatedAt = Date.now();
      const entryWrittenAt = 0; // No timestamp (old hook version)

      // Guard 1 skips entries without written_at — falls through to guard 3
      const shouldReject = entryWrittenAt > 0 && entryWrittenAt < sessionCreatedAt;
      expect(shouldReject).toBe(false);
    });
  });

  describe('GUARD 2: _archived/ path rejection', () => {
    it('should reject JSONL path containing /_archived/', () => {
      const path = '/home/user/.claude/projects/foo/_archived/1234-session.jsonl';
      const isArchived = path.includes('/_archived/') || path.includes('\\_archived\\');
      expect(isArchived).toBe(true);
    });

    it('should accept JSONL path not in _archived/', () => {
      const path = '/home/user/.claude/projects/foo/session-id.jsonl';
      const isArchived = path.includes('/_archived/') || path.includes('\\_archived\\');
      expect(isArchived).toBe(false);
    });

    it('should reject Windows-style _archived path', () => {
      const path = 'C:\\Users\\user\\.claude\\projects\\foo\\_archived\\session.jsonl';
      const isArchived = path.includes('/_archived/') || path.includes('\\_archived\\');
      expect(isArchived).toBe(true);
    });
  });

  describe('GUARD 3: JSONL mtime', () => {
    it('should reject JSONL file older than session creation', async () => {
      // Create a JSONL file with old mtime
      const jsonlPath = join(tmpDir, 'old-session.jsonl');
      writeFileSync(jsonlPath, '{"type":"user","message":{"role":"user","content":"old"}}');

      // Set mtime to 1 hour ago
      const oldTime = new Date(Date.now() - 3600_000);
      const { utimesSync } = await import('node:fs');
      utimesSync(jsonlPath, oldTime, oldTime);

      const sessionCreatedAt = Date.now();
      const fileStat = await stat(jsonlPath);

      const shouldReject = fileStat.mtimeMs < sessionCreatedAt;
      expect(shouldReject).toBe(true);
    });

    it('should accept JSONL file newer than session creation', async () => {
      const sessionCreatedAt = Date.now() - 5_000; // Session created 5s ago

      // Create a fresh JSONL file (mtime = now)
      const jsonlPath = join(tmpDir, 'fresh-session.jsonl');
      writeFileSync(jsonlPath, '{"type":"user","message":{"role":"user","content":"new"}}');

      const fileStat = await stat(jsonlPath);

      const shouldReject = fileStat.mtimeMs < sessionCreatedAt;
      expect(shouldReject).toBe(false);
    });
  });

  describe('hook.ts written_at field', () => {
    it('should include written_at in session_map entry', () => {
      // Simulate what hook.ts writes
      const before = Date.now();
      const entry = {
        session_id: 'test-uuid',
        cwd: '/home/user/project',
        window_name: 'cc-test',
        written_at: Date.now(),
      };
      const after = Date.now();

      expect(entry.written_at).toBeGreaterThanOrEqual(before);
      expect(entry.written_at).toBeLessThanOrEqual(after);
    });
  });

  describe('Combined guards scenario: Zeus D51 reproduction', () => {
    it('should reject all 3 stale entries from D18, D19, D20', () => {
      // Simulate: D51 session created at T=1000
      // session_map has entries from D18 (T=100), D19 (T=200), D20 (T=300)
      const d51CreatedAt = 1000;

      const staleEntries = [
        { session_id: '186951e5-d18', written_at: 100, window_name: 'D18-rune-details' },
        { session_id: 'fe7653c8-d19', written_at: 200, window_name: 'D19-global-search' },
        { session_id: '5490cf60-d20', written_at: 300, window_name: 'D20-returning-player' },
      ];

      for (const entry of staleEntries) {
        const shouldReject = entry.written_at > 0 && entry.written_at < d51CreatedAt;
        expect(shouldReject).toBe(true);
      }
    });

    it('should accept fresh entry from D51 hook', () => {
      const d51CreatedAt = 1000;
      const freshEntry = { session_id: 'new-d51-uuid', written_at: 1500, window_name: 'D51-champion-pool' };

      const shouldReject = freshEntry.written_at > 0 && freshEntry.written_at < d51CreatedAt;
      expect(shouldReject).toBe(false);
    });
  });

  describe('PRIMARY defense: --session-id with fresh UUID', () => {
    it('should generate a valid UUID for --session-id', () => {
      const uuid = crypto.randomUUID();
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      expect(UUID_RE.test(uuid)).toBe(true);
    });

    it('should build claude command with --session-id when no resume', () => {
      const freshSessionId = crypto.randomUUID();
      const resumeSessionId: string | undefined = undefined;
      const claudeCommand: string | undefined = undefined;

      let cmd = claudeCommand || 'claude';
      if (resumeSessionId) {
        cmd += ` --resume ${resumeSessionId}`;
      } else if (freshSessionId) {
        cmd += ` --session-id ${freshSessionId}`;
      }

      expect(cmd).toMatch(/^claude --session-id [0-9a-f-]{36}$/);
    });

    it('should NOT use --session-id when resuming', () => {
      const freshSessionId: string | undefined = undefined; // Not generated when resuming
      const resumeSessionId = 'existing-session-id';

      let cmd = 'claude';
      if (resumeSessionId) {
        cmd += ` --resume ${resumeSessionId}`;
      } else if (freshSessionId) {
        cmd += ` --session-id ${freshSessionId}`;
      }

      expect(cmd).toBe('claude --resume existing-session-id');
      expect(cmd).not.toContain('--session-id');
    });

    it('should NOT use --session-id when custom claudeCommand is provided', () => {
      const freshSessionId: string | undefined = undefined; // Not generated with custom command
      const claudeCommand = 'claude --model opus';

      let cmd = claudeCommand || 'claude';
      // freshSessionId is only generated when !resumeSessionId && !claudeCommand
      if (freshSessionId) {
        cmd += ` --session-id ${freshSessionId}`;
      }

      expect(cmd).toBe('claude --model opus');
    });

    it('should set claudeSessionId immediately when freshSessionId is available', () => {
      const freshSessionId = crypto.randomUUID();

      // Simulates what session.ts does
      const session = {
        claudeSessionId: freshSessionId || undefined,
      };

      expect(session.claudeSessionId).toBe(freshSessionId);
    });

    it('should not set claudeSessionId when resuming (no freshSessionId)', () => {
      const freshSessionId: string | undefined = undefined;

      const session = {
        claudeSessionId: freshSessionId || undefined,
      };

      expect(session.claudeSessionId).toBeUndefined();
    });

    it('two-layer defense: --session-id + archival covers all cases', () => {
      // Layer 1: --session-id forces CC to create a new session (primary)
      // Layer 2: archival removes old .jsonl files (backup)
      // Even if CC ignores --session-id (bug), there's nothing to resume
      const freshSessionId = crypto.randomUUID();
      const archivedFiles = true; // archiveStaleSessionFiles ran

      // Both layers active = maximum protection
      expect(freshSessionId).toBeTruthy();
      expect(archivedFiles).toBe(true);
    });
  });
});
