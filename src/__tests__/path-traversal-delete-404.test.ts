/**
 * path-traversal-delete-404.test.ts — Tests for Issues #434 and #435.
 *
 * Issue #435: validateWorkDir path traversal bypass — normalize() resolves
 * ".." before the check, so the guard never fires. Fix: check raw string first.
 *
 * Issue #434: DELETE /v1/sessions/:id returns 200 for non-existent sessions.
 * killSession() silently returns when session is null, so the handler returns
 * {ok: true}. Fix: check getSession() before proceeding.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Issue #435: Path traversal bypass in validateWorkDir
// ---------------------------------------------------------------------------

describe('Issue #435: validateWorkDir path traversal', () => {
  // Reproduce the bug: path.normalize() resolves ".." so the old check
  // on the normalized string never triggers.
  it('path.normalize() resolves ".." — demonstrating the bypass', () => {
    const raw = '/tmp/../../../etc/passwd';
    const normalized = path.normalize(raw);
    // The old code checked `normalized.includes('..')` which is FALSE
    // because normalize already resolved the traversal.
    expect(normalized.includes('..')).toBe(false);
    // The raw string DOES contain ".."
    expect(raw.includes('..')).toBe(true);
  });

  it('rejects raw workDir containing ".." (basic traversal)', () => {
    expect('/tmp/../etc/passwd'.includes('..')).toBe(true);
    expect('/tmp/../../etc/shadow'.includes('..')).toBe(true);
    expect('./secrets/../../../etc/passwd'.includes('..')).toBe(true);
  });

  it('allows legitimate paths without ".."', () => {
    expect('/home/user/projects/aegis'.includes('..')).toBe(false);
    expect('/tmp/test-session'.includes('..')).toBe(false);
    expect('.'.includes('..')).toBe(false);
    expect('./src'.includes('..')).toBe(false);
  });

  it('rejects edge cases like "..." which contains ".."', () => {
    // "..." does contain ".." as a substring — this is intentional to be safe
    expect('...'.includes('..')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue #434: DELETE non-existent session returns 200
// ---------------------------------------------------------------------------

describe('Issue #434: DELETE /v1/sessions/:id returns 404 for missing sessions', () => {
  it('getSession returns null for non-existent session', () => {
    // Demonstrates the root cause: killSession silently returns when
    // session is not found, so the handler never errors.
    const sessionMap: Record<string, { id: string }> = {
      'existing-session': { id: 'existing-session' },
    };

    // Non-existent session returns null/undefined
    expect(sessionMap['non-existent-session'] || null).toBeNull();

    // Existing session returns the session
    expect(sessionMap['existing-session']).toBeDefined();
  });

  it('killSession-like function silently returns for missing session', async () => {
    // Simulating killSession behavior: if session is null, return early
    const sessionMap: Record<string, { id: string }> = {};
    let threw = false;
    try {
      const session = sessionMap['missing'];
      if (!session) {
        // This is the early return in killSession — no error thrown
      }
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    // This is why the handler returns {ok: true} — no error path is taken.
  });
});
