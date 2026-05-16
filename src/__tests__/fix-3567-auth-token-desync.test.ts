/**
 * Issue #3567: auth-token file desyncs from config.yaml authToken on restart.
 *
 * The server should auto-repair the auth-token file when it detects
 * the file token doesn't match any registered key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../utils/auth-token-path.js', () => ({
  getAuthTokenFilePath: vi.fn(() => '/home/test/.aegis/auth-token'),
  persistAuthTokenFile: vi.fn(),
  readAuthTokenFile: vi.fn(() => null),
}));

import { AuthManager } from '../services/auth/AuthManager.js';

describe('AuthManager #3567 — getMasterToken', () => {
  const tmpDir = `/tmp/test-auth-3567-${Date.now()}`;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty string when no master token is set', () => {
    const auth = new AuthManager(`${tmpDir}/keys.json`, '', '_system');
    expect(auth.getMasterToken()).toBe('');
  });

  it('returns the master token when set', () => {
    const auth = new AuthManager(`${tmpDir}/keys.json`, 'aegis_test_master_token', '_system');
    expect(auth.getMasterToken()).toBe('aegis_test_master_token');
  });
});
