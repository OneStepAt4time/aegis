/**
 * device-flow-cli.test.ts — Unit tests for ag login / ag logout / ag whoami commands.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';

import { handleLogin } from '../commands/login.js';
import { handleLogout } from '../commands/logout.js';
import { handleWhoami } from '../commands/whoami.js';
import { setStoredAuth, deleteAuthStore, type StoredAuth } from '../services/auth/token-store.js';

// Helper to capture stdout/stderr output
function createMockIO() {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({ write: (chunk, _enc, cb) => { stdoutChunks.push(chunk.toString()); cb(); } });
  const stderr = new Writable({ write: (chunk, _enc, cb) => { stderrChunks.push(chunk.toString()); cb(); } });
  return {
    stdin: process.stdin,
    stdout,
    stderr,
    getStdout: () => stdoutChunks.join(''),
    getStderr: () => stderrChunks.join(''),
  };
}

// Create a valid base64url-encoded JWT-like id_token for testing
function createTestIdToken(sub: string, email: string, role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, email, name: 'Test User', aegis_role: role })).toString('base64url');
  const signature = Buffer.from('test-signature').toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const sampleAuth: StoredAuth = {
  idp: 'https://idp.example.com',
  identity: { sub: 'user-123', email: 'alice@example.com', name: 'Alice Engineer' },
  tokens: {
    access: 'access-token',
    refresh: 'refresh-token',
    id_token: createTestIdToken('user-123', 'alice@example.com', 'admin'),
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    scope: 'openid profile email',
  },
  role: 'admin',
  obtained_at: '2026-04-30T10:00:00Z',
};

let testDir: string;
const originalEnv = process.env;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'aegis-test-cli-'));
  process.env = { ...originalEnv };
  process.env.AEGIS_AUTH_DIR = testDir;
});

afterEach(() => {
  process.env = originalEnv;
  rmSync(testDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ag login', () => {
  it('exits with code 2 when OIDC is not configured', async () => {
    delete process.env.AEGIS_OIDC_ISSUER;
    delete process.env.AEGIS_OIDC_CLIENT_ID;

    const io = createMockIO();
    const code = await handleLogin([], io);
    expect(code).toBe(2);
    expect(io.getStderr()).toContain('OIDC is not configured');
  });

  it('exits with code 2 for invalid issuer URL', async () => {
    process.env.AEGIS_OIDC_ISSUER = 'not-a-url';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    const io = createMockIO();
    const code = await handleLogin([], io);
    expect(code).toBe(2);
    expect(io.getStderr()).toContain('not a valid URL');
  });

  it('exits with code 1 when IdP discovery fails', async () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    const io = createMockIO();
    const code = await handleLogin([], io, mockFetch as unknown as typeof fetch);
    expect(code).toBe(1);
    expect(io.getStderr()).toContain('discovery failed');
  });

  it('exits with code 1 when IdP does not support device flow', async () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issuer: 'https://idp.example.com',
        token_endpoint: 'https://idp.example.com/token',
        // no device_authorization_endpoint
      }),
    });

    const io = createMockIO();
    const code = await handleLogin([], io, mockFetch as unknown as typeof fetch);
    expect(code).toBe(1);
    expect(io.getStderr()).toContain('does not support');
  });

  it('completes full device flow successfully', async () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string, _opts?: RequestInit) => {
      callCount++;
      const urlStr = url.toString();

      // Discovery
      if (urlStr.includes('.well-known')) {
        return {
          ok: true,
          json: async () => ({
            issuer: 'https://idp.example.com',
            token_endpoint: 'https://idp.example.com/token',
            device_authorization_endpoint: 'https://idp.example.com/device/code',
          }),
        };
      }

      // Device authorization
      if (urlStr.includes('/device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'device-123',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://idp.example.com/device',
            expires_in: 900,
            interval: 1,
          }),
        };
      }

      // Token endpoint — success on first poll
      if (urlStr.includes('/token')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'access-abc',
            refresh_token: 'refresh-def',
            id_token: createTestIdToken('user-123', 'alice@example.com', 'admin'),
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        };
      }

      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    });

    const io = createMockIO();
    const code = await handleLogin([], io, mockFetch as unknown as typeof fetch);

    expect(code).toBe(0);
    expect(io.getStdout()).toContain('Logged in as alice@example.com (admin)');
    expect(callCount).toBeGreaterThanOrEqual(3); // discovery + device auth + token
  });

  it('supports --json output', async () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('.well-known')) {
        return { ok: true, json: async () => ({ issuer: 'https://idp.example.com', token_endpoint: 'https://idp.example.com/token', device_authorization_endpoint: 'https://idp.example.com/device/code' }) };
      }
      if (urlStr.includes('/device/code')) {
        return { ok: true, json: async () => ({ device_code: 'dc', user_code: 'UC', verification_uri: 'https://idp.example.com/device', expires_in: 900, interval: 1 }) };
      }
      if (urlStr.includes('/token')) {
        return { ok: true, json: async () => ({ access_token: 'at', refresh_token: 'rt', id_token: createTestIdToken('u1', 'a@b.com', 'viewer'), expires_in: 3600 }) };
      }
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({}) };
    });

    const io = createMockIO();
    const code = await handleLogin(['--json'], io, mockFetch as unknown as typeof fetch);
    expect(code).toBe(0);

    const output = JSON.parse(io.getStdout());
    expect(output.identity.email).toBe('a@b.com');
    expect(output.role).toBe('viewer');
  });
});

describe('ag logout', () => {
  it('shows not logged in when store is empty', async () => {
    await deleteAuthStore(testDir);

    const io = createMockIO();
    const code = await handleLogout([], io);
    expect(code).toBe(1);
    expect(io.getStdout()).toContain('Not logged in');
  });

  it('logs out from a single server', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const io = createMockIO();
    const code = await handleLogout([], io);
    expect(code).toBe(0);
    expect(io.getStdout()).toContain('Logged out');
    expect(io.getStdout()).toContain('alice@example.com');
  });

  it('--all deletes entire store', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);
    await setStoredAuth('http://staging:9100', { ...sampleAuth, identity: { sub: 'u2', email: 'bob@test.com' } }, testDir);

    const io = createMockIO();
    const code = await handleLogout(['--all'], io);
    expect(code).toBe(0);
    expect(io.getStdout()).toContain('all servers');
  });

  it('attempts token revocation at IdP', async () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    let revoked = false;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = url.toString();
      if (urlStr.includes('.well-known')) {
        return { ok: true, json: async () => ({ issuer: 'https://idp.example.com', token_endpoint: 'https://idp.example.com/token', revocation_endpoint: 'https://idp.example.com/revoke' }) };
      }
      if (urlStr.includes('/revoke')) {
        revoked = true;
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const io = createMockIO();
    const code = await handleLogout([], io, mockFetch as unknown as typeof fetch);
    expect(code).toBe(0);
    expect(revoked).toBe(true);
  });
});

describe('ag whoami', () => {
  it('shows not logged in when store is empty', async () => {
    await deleteAuthStore(testDir);

    const io = createMockIO();
    const code = await handleWhoami([], io);
    expect(code).toBe(1);
    expect(io.getStdout()).toContain('Not logged in');
  });

  it('shows identity for logged-in user', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const io = createMockIO();
    const code = await handleWhoami([], io);
    expect(code).toBe(0);
    expect(io.getStdout()).toContain('alice@example.com');
    expect(io.getStdout()).toContain('admin');
  });

  it('shows token expiry time', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const io = createMockIO();
    const code = await handleWhoami([], io);
    expect(code).toBe(0);
    expect(io.getStdout()).toContain('expires in');
  });

  it('supports --json output', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const io = createMockIO();
    const code = await handleWhoami(['--json'], io);
    expect(code).toBe(0);

    const output = JSON.parse(io.getStdout());
    expect(output.identity.email).toBe('alice@example.com');
    expect(output.role).toBe('admin');
    expect(output.server).toBe('http://localhost:9100');
  });

  it('shows all servers when multiple exist', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);
    await setStoredAuth('http://staging:9100', {
      ...sampleAuth,
      identity: { sub: 'user-456', email: 'bob@example.com' },
      role: 'viewer',
    }, testDir);

    const io = createMockIO();
    const code = await handleWhoami([], io);
    expect(code).toBe(0);
    expect(io.getStdout()).toContain('alice@example.com');
    expect(io.getStdout()).toContain('bob@example.com');
  });

  it('returns 1 for non-existent server with --server flag', async () => {
    await setStoredAuth('http://localhost:9100', sampleAuth, testDir);

    const io = createMockIO();
    const code = await handleWhoami(['--server', 'http://unknown:9100'], io);
    expect(code).toBe(1);
  });
});
