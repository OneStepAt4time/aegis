/**
 * oidc-config.test.ts — Unit tests for OIDC configuration parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parseOidcConfig,
  parseDashboardOidcConfig,
  discoverOidcEndpoints,
  mergeDiscovery,
  type OidcDiscovery,
} from '../services/auth/oidc-config.js';

describe('parseOidcConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when OIDC is not configured', () => {
    delete process.env.AEGIS_OIDC_ISSUER;
    delete process.env.AEGIS_OIDC_CLIENT_ID;
    expect(parseOidcConfig()).toBeNull();
  });

  it('returns null when only issuer is set', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://accounts.google.com';
    delete process.env.AEGIS_OIDC_CLIENT_ID;
    expect(parseOidcConfig()).toBeNull();
  });

  it('returns null when only client_id is set', () => {
    delete process.env.AEGIS_OIDC_ISSUER;
    process.env.AEGIS_OIDC_CLIENT_ID = 'my-client-id';
    expect(parseOidcConfig()).toBeNull();
  });

  it('parses a valid OIDC config with defaults', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://login.microsoftonline.com/tenant/v2.0';
    process.env.AEGIS_OIDC_CLIENT_ID = 'my-client-id';

    const config = parseOidcConfig();
    expect(config).not.toBeNull();
    expect(config!.issuer).toBe('https://login.microsoftonline.com/tenant/v2.0');
    expect(config!.clientId).toBe('my-client-id');
    expect(config!.audience).toBe('my-client-id'); // defaults to clientId
    expect(config!.scopes).toBe('openid profile email');
    expect(config!.roleClaim).toBe('aegis_role');
  });

  it('uses custom overrides for optional fields', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://keycloak.example.com/realms/myrealm';
    process.env.AEGIS_OIDC_CLIENT_ID = 'aegis-cli';
    process.env.AEGIS_OIDC_AUDIENCE = 'aegis-api';
    process.env.AEGIS_OIDC_SCOPES = 'openid profile';
    process.env.AEGIS_OIDC_ROLE_CLAIM = 'realm_roles';
    process.env.AEGIS_AUTH_DIR = '/tmp/test-auth';

    const config = parseOidcConfig();
    expect(config!.audience).toBe('aegis-api');
    expect(config!.scopes).toBe('openid profile');
    expect(config!.roleClaim).toBe('realm_roles');
    expect(config!.authDir).toBe('/tmp/test-auth');
  });

  it('trims whitespace from env vars', () => {
    process.env.AEGIS_OIDC_ISSUER = '  https://accounts.google.com  ';
    process.env.AEGIS_OIDC_CLIENT_ID = '  client-id  ';

    const config = parseOidcConfig();
    expect(config!.issuer).toBe('https://accounts.google.com');
    expect(config!.clientId).toBe('client-id');
  });

  it('throws on invalid issuer URL', () => {
    process.env.AEGIS_OIDC_ISSUER = 'not-a-url';
    process.env.AEGIS_OIDC_CLIENT_ID = 'client-id';

    expect(() => parseOidcConfig()).toThrow('AEGIS_OIDC_ISSUER is not a valid URL');
  });

  it('accepts http:// issuer (dev/testing)', () => {
    process.env.AEGIS_OIDC_ISSUER = 'http://localhost:8080/realms/test';
    process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

    const config = parseOidcConfig();
    expect(config!.issuer).toBe('http://localhost:8080/realms/test');
  });
});

describe('parseDashboardOidcConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns null when no OIDC env vars are configured', () => {
    delete process.env.AEGIS_OIDC_ISSUER;
    delete process.env.AEGIS_OIDC_CLIENT_ID;
    delete process.env.AEGIS_OIDC_CLIENT_SECRET;
    delete process.env.AEGIS_OIDC_REDIRECT_PATH;
    expect(parseDashboardOidcConfig()).toBeNull();
  });

  it('returns null for shared device-flow OIDC config without dashboard client secret', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'aegis-dashboard';
    delete process.env.AEGIS_OIDC_CLIENT_SECRET;
    delete process.env.AEGIS_OIDC_REDIRECT_PATH;

    expect(parseDashboardOidcConfig()).toBeNull();
  });

  it('requires client secret when dashboard-specific OIDC config is present', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'aegis-dashboard';
    process.env.AEGIS_OIDC_REDIRECT_PATH = '/auth/callback';
    delete process.env.AEGIS_OIDC_CLIENT_SECRET;

    expect(() => parseDashboardOidcConfig()).toThrow('AEGIS_OIDC_CLIENT_SECRET is required');
  });

  it('fails closed when dashboard client secret is configured without shared issuer/client ID', () => {
    delete process.env.AEGIS_OIDC_ISSUER;
    delete process.env.AEGIS_OIDC_CLIENT_ID;
    process.env.AEGIS_OIDC_CLIENT_SECRET = 'secret';

    expect(() => parseDashboardOidcConfig()).toThrow('AEGIS_OIDC_ISSUER and AEGIS_OIDC_CLIENT_ID are required');
  });

  it('parses dashboard OIDC config without exposing the secret in errors', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'aegis-dashboard';
    process.env.AEGIS_OIDC_CLIENT_SECRET = 'super-sensitive-secret';
    process.env.AEGIS_OIDC_REDIRECT_PATH = '/auth/callback';

    const config = parseDashboardOidcConfig();
    expect(config?.clientSecret).toBe('super-sensitive-secret');
    expect(config?.redirectPath).toBe('/auth/callback');
  });

  it('rejects redirect paths that are not absolute paths', () => {
    process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
    process.env.AEGIS_OIDC_CLIENT_ID = 'aegis-dashboard';
    process.env.AEGIS_OIDC_CLIENT_SECRET = 'secret';
    process.env.AEGIS_OIDC_REDIRECT_PATH = 'auth/callback';

    expect(() => parseDashboardOidcConfig()).toThrow('AEGIS_OIDC_REDIRECT_PATH must start with /');
  });
});

describe('discoverOidcEndpoints', () => {
  it('fetches and parses discovery document', async () => {
    const mockDiscovery: OidcDiscovery = {
      issuer: 'https://accounts.google.com',
      token_endpoint: 'https://oauth2.googleapis.com/token',
      device_authorization_endpoint: 'https://oauth2.googleapis.com/device/code',
      revocation_endpoint: 'https://oauth2.googleapis.com/revoke',
      jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    };

    const mockFetch = async (url: string) => {
      expect(url).toContain('.well-known/openid-configuration');
      return {
        ok: true,
        json: async () => mockDiscovery,
      } as Response;
    };

    const result = await discoverOidcEndpoints('https://accounts.google.com', mockFetch as typeof fetch);
    expect(result.token_endpoint).toBe('https://oauth2.googleapis.com/token');
    expect(result.device_authorization_endpoint).toBe('https://oauth2.googleapis.com/device/code');
  });

  it('throws on non-OK response', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    }) as Response;

    await expect(discoverOidcEndpoints('https://bad-idp.example.com', mockFetch as typeof fetch))
      .rejects.toThrow('OIDC discovery failed: 404');
  });

  it('throws when token_endpoint is missing', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ issuer: 'https://test.com' }),
    }) as Response;

    await expect(discoverOidcEndpoints('https://test.com', mockFetch as typeof fetch))
      .rejects.toThrow('missing required field: token_endpoint');
  });

  it('strips trailing slash from issuer URL', async () => {
    let requestedUrl = '';
    const mockFetch = async (url: string) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({ issuer: 'https://test.com', token_endpoint: 'https://test.com/token' }),
      } as Response;
    };

    await discoverOidcEndpoints('https://test.com/', mockFetch as typeof fetch);
    expect(requestedUrl).toBe('https://test.com/.well-known/openid-configuration');
  });
});

describe('mergeDiscovery', () => {
  it('merges discovered endpoints into config', () => {
    const config = {
      issuer: 'https://test.com',
      clientId: 'test',
      audience: 'test',
      scopes: 'openid',
      roleClaim: 'role',
      authDir: '',
    };

    const discovery: OidcDiscovery = {
      issuer: 'https://test.com',
      token_endpoint: 'https://test.com/token',
      device_authorization_endpoint: 'https://test.com/device',
      revocation_endpoint: 'https://test.com/revoke',
      jwks_uri: 'https://test.com/jwks',
    };

    const merged = mergeDiscovery(config, discovery);
    expect(merged.tokenEndpoint).toBe('https://test.com/token');
    expect(merged.deviceAuthorizationEndpoint).toBe('https://test.com/device');
    expect(merged.revocationEndpoint).toBe('https://test.com/revoke');
    expect(merged.jwksUri).toBe('https://test.com/jwks');
  });
});
