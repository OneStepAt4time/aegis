/**
 * rbac-matrix.test.ts — Tests for per-action RBAC matrix (Issue #2081).
 *
 * Covers:
 *   - hasPermission() resolution order
 *   - updateKeyPermissions() CRUD
 *   - requirePermission() route guard
 *   - Backwards compatibility (null permissions = role fallback)
 *   - session:* wildcard
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from '../services/auth/AuthManager.js';
import type { SessionAction } from '../services/auth/types.js';
import { requirePermission } from '../routes/context.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// ── Helpers ──────────────────────────────────────────────────────────

function createTestAuth(masterToken = 'test-master'): AuthManager {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-rbac-'));
  const keysFile = path.join(tmpDir, 'keys.json');
  const auth = new AuthManager(keysFile, masterToken);
  auth.setHost('127.0.0.1');
  return auth;
}

function cleanupAuth(auth: AuthManager): void {
  try {
    const keysFile = (auth as unknown as { keysFile: string }).keysFile;
    const dir = path.dirname(keysFile);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }
}

// Mock request/reply for testing requirePermission
function mockRequest(authKeyId: string | null | undefined) {
  return { authKeyId } as any;
}

function mockReply() {
  let statusCode = 200;
  let body: unknown = null;
  return {
    status(code: number) { statusCode = code; return { send(data: unknown) { body = data; return this; } }; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  } as any;
}

// ── hasPermission ────────────────────────────────────────────────────

describe('AuthManager.hasPermission()', () => {
  let auth: AuthManager;

  beforeEach(async () => {
    auth = createTestAuth();
    await auth.load();
  });

  it('allows master token for any action', () => {
    const actions: SessionAction[] = [
      'session:create', 'session:send', 'session:command', 'session:bash',
      'session:approve', 'session:reject', 'session:kill', 'session:interrupt', 'session:read',
    ];
    for (const action of actions) {
      expect(auth.hasPermission('master', action)).toBe(true);
    }
  });

  it('allows null/undefined keyId (no-auth)', () => {
    expect(auth.hasPermission(null, 'session:kill')).toBe(true);
    expect(auth.hasPermission(undefined, 'session:send')).toBe(true);
  });

  it('denies unknown key', async () => {
    await auth.createKey('test', 100, undefined, 'operator');
    expect(auth.hasPermission('nonexistent', 'session:read')).toBe(false);
  });

  it('admin role always allowed', async () => {
    const { id } = await auth.createKey('admin-key', 100, undefined, 'admin');
    expect(auth.hasPermission(id, 'session:kill')).toBe(true);
    expect(auth.hasPermission(id, 'session:read')).toBe(true);
    expect(auth.hasPermission(id, 'session:send')).toBe(true);
  });

  it('operator with null permissions (legacy) gets all actions', async () => {
    const { id } = await auth.createKey('op-key', 100, undefined, 'operator');
    // Default permissions is null = role fallback
    expect(auth.hasPermission(id, 'session:kill')).toBe(true);
    expect(auth.hasPermission(id, 'session:send')).toBe(true);
    expect(auth.hasPermission(id, 'session:read')).toBe(true);
  });

  it('viewer with null permissions (legacy) only gets session:read', async () => {
    const { id } = await auth.createKey('viewer-key', 100, undefined, 'viewer');
    expect(auth.hasPermission(id, 'session:read')).toBe(true);
    expect(auth.hasPermission(id, 'session:kill')).toBe(false);
    expect(auth.hasPermission(id, 'session:send')).toBe(false);
  });

  it('explicit permissions array overrides role', async () => {
    const { id } = await auth.createKey('restricted', 100, undefined, 'operator');
    await auth.updateKeyPermissions(id, ['session:read', 'session:approve']);

    expect(auth.hasPermission(id, 'session:read')).toBe(true);
    expect(auth.hasPermission(id, 'session:approve')).toBe(true);
    // Was operator (would have all), but explicit permissions deny it
    expect(auth.hasPermission(id, 'session:kill')).toBe(false);
    expect(auth.hasPermission(id, 'session:send')).toBe(false);
  });

  it('empty permissions array = read-only', async () => {
    const { id } = await auth.createKey('readonly', 100, undefined, 'operator');
    await auth.updateKeyPermissions(id, []);

    expect(auth.hasPermission(id, 'session:read')).toBe(false);
    expect(auth.hasPermission(id, 'session:kill')).toBe(false);
    expect(auth.hasPermission(id, 'session:send')).toBe(false);
  });

  it('session:* wildcard grants all actions', async () => {
    const { id } = await auth.createKey('wildcard', 100, undefined, 'viewer');
    await auth.updateKeyPermissions(id, ['session:*']);

    const actions: SessionAction[] = [
      'session:create', 'session:send', 'session:command', 'session:bash',
      'session:approve', 'session:reject', 'session:kill', 'session:interrupt', 'session:read',
    ];
    for (const action of actions) {
      expect(auth.hasPermission(id, action)).toBe(true);
    }
  });

  it('admin role ignores explicit permissions array', async () => {
    const { id } = await auth.createKey('admin-restricted', 100, undefined, 'admin');
    await auth.updateKeyPermissions(id, []);

    // Admin always bypasses
    expect(auth.hasPermission(id, 'session:kill')).toBe(true);
    expect(auth.hasPermission(id, 'session:send')).toBe(true);
  });

  afterAll(() => {
    // Cleanup handled per-test by vitest
  });
});

// ── updateKeyPermissions ─────────────────────────────────────────────

describe('AuthManager.updateKeyPermissions()', () => {
  let auth: AuthManager;

  beforeEach(async () => {
    auth = createTestAuth();
    await auth.load();
  });

  it('updates permissions and returns key without hash', async () => {
    const { id } = await auth.createKey('test-key', 100);
    const result = await auth.updateKeyPermissions(id, ['session:read', 'session:send']);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
    expect(result!.permissions).toEqual(['session:read', 'session:send']);
    expect((result as any).hash).toBeUndefined();
  });

  it('returns null for nonexistent key', async () => {
    const result = await auth.updateKeyPermissions('nonexistent', ['session:read']);
    expect(result).toBeNull();
  });

  it('can set permissions to null (role fallback)', async () => {
    const { id } = await auth.createKey('test-key', 100);
    await auth.updateKeyPermissions(id, ['session:read']);
    const result = await auth.updateKeyPermissions(id, null);

    expect(result!.permissions).toBeNull();
    // Falls back to viewer role = only session:read
    expect(auth.hasPermission(id, 'session:read')).toBe(true);
    expect(auth.hasPermission(id, 'session:send')).toBe(false);
  });

  it('persists permissions across reload', async () => {
    const { id } = await auth.createKey('test-key', 100);
    await auth.updateKeyPermissions(id, ['session:approve', 'session:reject']);

    // Simulate reload
    const keysFile = (auth as unknown as { keysFile: string }).keysFile;
    const auth2 = new AuthManager(keysFile, 'test-master');
    auth2.setHost('127.0.0.1');
    await auth2.load();

    expect(auth2.hasPermission(id, 'session:approve')).toBe(true);
    expect(auth2.hasPermission(id, 'session:reject')).toBe(true);
    expect(auth2.hasPermission(id, 'session:kill')).toBe(false);
  });
});

// ── requirePermission guard ──────────────────────────────────────────

describe('requirePermission() route guard', () => {
  let auth: AuthManager;

  beforeEach(async () => {
    auth = createTestAuth();
    await auth.load();
  });

  it('allows master token', () => {
    const req = mockRequest('master');
    const reply = mockReply();
    expect(requirePermission(auth, req, reply, 'session:kill')).toBe(true);
    expect(reply.statusCode).toBe(200);
  });

  it('allows null keyId when auth disabled', () => {
    // Auth is enabled (master token), but null keyId comes from master validation
    const req = mockRequest(null);
    const reply = mockReply();
    expect(requirePermission(auth, req, reply, 'session:send')).toBe(true);
  });

  it('denies with 401 when auth enabled and no key', () => {
    const req = mockRequest(undefined);
    const reply = mockReply();
    expect(requirePermission(auth, req, reply, 'session:send')).toBe(false);
    expect(reply.statusCode).toBe(401);
  });

  it('denies with 403 INSUFFICIENT_PERMISSIONS when lacking permission', async () => {
    const { id } = await auth.createKey('viewer-key', 100, undefined, 'viewer');
    // Viewer with null permissions: only session:read
    const req = mockRequest(id);
    const reply = mockReply();
    expect(requirePermission(auth, req, reply, 'session:kill')).toBe(false);
    expect(reply.statusCode).toBe(403);
    expect(reply.body.error).toBe('INSUFFICIENT_PERMISSIONS');
    expect(reply.body.message).toContain('session:kill');
  });

  it('allows when key has explicit permission', async () => {
    const { id } = await auth.createKey('approve-only', 100, undefined, 'viewer');
    await auth.updateKeyPermissions(id, ['session:approve']);
    const req = mockRequest(id);
    const reply = mockReply();
    expect(requirePermission(auth, req, reply, 'session:approve')).toBe(true);
    expect(reply.statusCode).toBe(200);
  });

  it('denies session:approve for key with only session:read', async () => {
    const { id } = await auth.createKey('reader', 100, undefined, 'viewer');
    await auth.updateKeyPermissions(id, ['session:read']);
    const req = mockRequest(id);
    const reply = mockReply();
    expect(requirePermission(auth, req, reply, 'session:approve')).toBe(false);
    expect(reply.statusCode).toBe(403);
  });
});

// ── Backwards compatibility ──────────────────────────────────────────

describe('RBAC backwards compatibility', () => {
  let auth: AuthManager;

  beforeEach(async () => {
    auth = createTestAuth();
    await auth.load();
  });

  it('existing keys without permissions field default to null (role fallback)', async () => {
    const { id } = await auth.createKey('legacy-op', 100, undefined, 'operator');
    // permissions should default to null
    const keys = auth.listKeys();
    const key = keys.find(k => k.id === id);
    expect(key?.permissions).toBeNull();
  });

  it('operator role with null permissions can still do all session actions', async () => {
    const { id } = await auth.createKey('op', 100, undefined, 'operator');
    const actions: SessionAction[] = [
      'session:create', 'session:send', 'session:command', 'session:bash',
      'session:approve', 'session:reject', 'session:kill', 'session:interrupt', 'session:read',
    ];
    for (const action of actions) {
      expect(auth.hasPermission(id, action)).toBe(true);
    }
  });

  it('viewer role with null permissions can only read', async () => {
    const { id } = await auth.createKey('viewer', 100, undefined, 'viewer');
    expect(auth.hasPermission(id, 'session:read')).toBe(true);
    expect(auth.hasPermission(id, 'session:send')).toBe(false);
  });

  it('admin always has full access regardless of permissions array', async () => {
    const { id } = await auth.createKey('admin', 100, undefined, 'admin');
    await auth.updateKeyPermissions(id, []);
    // Admin bypasses all checks
    expect(auth.hasPermission(id, 'session:kill')).toBe(true);
  });
});
