/**
 * device-auth-routes.test.ts — Unit tests for OAuth2 device auth endpoints.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { registerDeviceAuthRoutes } from '../routes/device-auth.js';

describe('Device Auth Routes', () => {
  let app: ReturnType<typeof Fastify>;
  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    app = Fastify();
    registerDeviceAuthRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('POST /v1/auth/device/authorize', () => {
    it('returns 503 when OIDC is not configured', async () => {
      delete process.env.AEGIS_OIDC_ISSUER;
      delete process.env.AEGIS_OIDC_CLIENT_ID;

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/authorize',
        payload: { client_id: 'test-client', scope: 'openid' },
      });

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.error).toBe('server_error');
      expect(body.error_description).toContain('OIDC not configured');
    });

    it('proxies device authorization request to IdP', async () => {
      process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
      process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

      const idpResponse = {
        device_code: 'device-abc',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://idp.example.com/device',
        expires_in: 900,
        interval: 5,
      };

      // Mock the global fetch for discovery + device auth
      const originalFetch = globalThis.fetch;
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        if (url.toString().includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({
              issuer: 'https://idp.example.com',
              token_endpoint: 'https://idp.example.com/token',
              device_authorization_endpoint: 'https://idp.example.com/device/code',
            }),
          } as Response;
        }
        // Device auth request
        return {
          ok: true,
          json: async () => idpResponse,
        } as Response;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/authorize',
        payload: { client_id: 'test-client', scope: 'openid profile email' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.device_code).toBe('device-abc');
      expect(body.user_code).toBe('ABCD-EFGH');
      expect(body.verification_uri).toBe('https://idp.example.com/device');
      expect(callCount).toBe(2); // discovery + device auth

      globalThis.fetch = originalFetch;
    });

    it('returns IdP error when device authorization fails', async () => {
      process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
      process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.toString().includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({
              issuer: 'https://idp.example.com',
              token_endpoint: 'https://idp.example.com/token',
              device_authorization_endpoint: 'https://idp.example.com/device/code',
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'invalid_scope', error_description: 'Unknown scope' }),
        } as Response;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/authorize',
        payload: { client_id: 'test-client', scope: 'bad-scope' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('invalid_scope');

      globalThis.fetch = originalFetch;
    });
  });

  describe('POST /v1/auth/device/token', () => {
    it('returns 503 when OIDC is not configured', async () => {
      delete process.env.AEGIS_OIDC_ISSUER;
      delete process.env.AEGIS_OIDC_CLIENT_ID;

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/token',
        payload: {
          grant_type: 'urn:ietf:params:oauth2:grant-type:device_code',
          device_code: 'abc',
          client_id: 'test-client',
        },
      });

      expect(response.statusCode).toBe(503);
    });

    it('proxies token request to IdP and returns success', async () => {
      process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
      process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

      const tokenResponse = {
        access_token: 'access-123',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-456',
        id_token: 'id-token-789',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.toString().includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({
              issuer: 'https://idp.example.com',
              token_endpoint: 'https://idp.example.com/token',
            }),
          } as Response;
        }
        return {
          ok: true,
          json: async () => tokenResponse,
        } as Response;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/token',
        payload: {
          grant_type: 'urn:ietf:params:oauth2:grant-type:device_code',
          device_code: 'device-abc',
          client_id: 'test-client',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.access_token).toBe('access-123');

      globalThis.fetch = originalFetch;
    });

    it('proxies authorization_pending error from IdP', async () => {
      process.env.AEGIS_OIDC_ISSUER = 'https://idp.example.com';
      process.env.AEGIS_OIDC_CLIENT_ID = 'test-client';

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.toString().includes('.well-known')) {
          return {
            ok: true,
            json: async () => ({
              issuer: 'https://idp.example.com',
              token_endpoint: 'https://idp.example.com/token',
            }),
          } as Response;
        }
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'authorization_pending', error_description: 'Authorization is pending' }),
        } as Response;
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/token',
        payload: {
          grant_type: 'urn:ietf:params:oauth2:grant-type:device_code',
          device_code: 'pending-code',
          client_id: 'test-client',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toBe('authorization_pending');

      globalThis.fetch = originalFetch;
    });

    it('rejects invalid grant_type', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/device/token',
        payload: {
          grant_type: 'authorization_code',
          device_code: 'abc',
          client_id: 'test-client',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
