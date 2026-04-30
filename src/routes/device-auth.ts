/**
 * routes/device-auth.ts — OAuth2 device authorization grant endpoints (RFC 8628).
 *
 * Server-side endpoints that act as a device code broker between the CLI and the IdP.
 * These endpoints allow the Aegis server to manage device code lifecycle:
 *
 *   POST /v1/auth/device/authorize — initiate device flow (proxy to IdP)
 *   POST /v1/auth/device/token     — poll for token (proxy to IdP)
 *
 * This is the server-side companion to the CLI's ag login command.
 * The CLI can also talk directly to the IdP (bypass mode) but these
 * endpoints are useful when the CLI cannot reach the IdP directly.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOidcConfig, discoverOidcEndpoints, mergeDiscovery, type OidcConfig } from '../services/auth/oidc-config.js';
import { registerWithLegacy, withValidation } from './context.js';

// ── Schemas ─────────────────────────────────────────────────────────

const deviceAuthorizeSchema = z.object({
  client_id: z.string().min(1),
  scope: z.string().optional(),
}).strict();

const deviceTokenSchema = z.object({
  grant_type: z.literal('urn:ietf:params:oauth2:grant-type:device_code'),
  device_code: z.string().min(1),
  client_id: z.string().min(1),
}).strict();

// ── Helper ──────────────────────────────────────────────────────────

function getOidcConfig(): OidcConfig {
  const config = parseOidcConfig();
  if (!config) {
    throw new Error('OIDC not configured. Set AEGIS_OIDC_ISSUER and AEGIS_OIDC_CLIENT_ID.');
  }
  return config;
}

// ── Route Registration ──────────────────────────────────────────────

export function registerDeviceAuthRoutes(app: FastifyInstance): void {
  /**
   * POST /v1/auth/device/authorize
   *
   * Proxies the device authorization request to the IdP's
   * device_authorization_endpoint. Returns the standard RFC 8628 response
   * (device_code, user_code, verification_uri, expires_in, interval).
   */
  registerWithLegacy(app, 'post', '/v1/auth/device/authorize', withValidation(deviceAuthorizeSchema, async (_req, reply, data) => {
    let config: OidcConfig;
    try {
      config = getOidcConfig();
    } catch (e: unknown) {
      return reply.status(503).send({
        error: 'server_error',
        error_description: e instanceof Error ? e.message : 'OIDC not configured',
      });
    }

    // S1: Validate client_id matches configured OIDC client (prevent open proxy)
    if (data.client_id !== config.clientId) {
      return reply.status(400).send({
        error: 'invalid_client',
        error_description: 'client_id does not match configured OIDC client',
      });
    }

    // Discovery — we need the device_authorization_endpoint
    if (!config.deviceAuthorizationEndpoint) {
      try {
        const discovery = await discoverOidcEndpoints(config.issuer);
        config = mergeDiscovery(config, discovery);
      } catch (e: unknown) {
        return reply.status(502).send({
          error: 'server_error',
          error_description: `OIDC discovery failed: ${e instanceof Error ? e.message : 'unknown error'}`,
        });
      }
    }

    if (!config.deviceAuthorizationEndpoint) {
      return reply.status(502).send({
        error: 'server_error',
        error_description: 'IdP does not advertise a device_authorization_endpoint',
      });
    }

    // Forward the device authorization request to the IdP
    const scope = data.scope || config.scopes;
    const body = new URLSearchParams({
      client_id: data.client_id,
      scope,
    });

    try {
      const idpResponse = await fetch(config.deviceAuthorizationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const idpData = await idpResponse.json() as Record<string, unknown>;

      if (!idpResponse.ok) {
        return reply.status(idpResponse.status).send(idpData);
      }

      return reply.status(200).send(idpData);
    } catch (e: unknown) {
      return reply.status(502).send({
        error: 'server_error',
        error_description: `IdP request failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      });
    }
  }));

  /**
   * POST /v1/auth/device/token
   *
   * Proxies the device token polling request to the IdP's token_endpoint.
   * Returns the standard RFC 8628 token response or error codes
   * (authorization_pending, slow_down, expired_token, access_denied).
   */
  registerWithLegacy(app, 'post', '/v1/auth/device/token', withValidation(deviceTokenSchema, async (_req, reply, data) => {
    let config: OidcConfig;
    try {
      config = getOidcConfig();
    } catch (e: unknown) {
      return reply.status(503).send({
        error: 'server_error',
        error_description: e instanceof Error ? e.message : 'OIDC not configured',
      });
    }

    // S1: Validate client_id matches configured OIDC client (prevent open proxy)
    if (data.client_id !== config.clientId) {
      return reply.status(400).send({
        error: 'invalid_client',
        error_description: 'client_id does not match configured OIDC client',
      });
    }

    // Discovery — we need the token_endpoint
    if (!config.tokenEndpoint) {
      try {
        const discovery = await discoverOidcEndpoints(config.issuer);
        config = mergeDiscovery(config, discovery);
      } catch (e: unknown) {
        return reply.status(502).send({
          error: 'server_error',
          error_description: `OIDC discovery failed: ${e instanceof Error ? e.message : 'unknown error'}`,
        });
      }
    }

    if (!config.tokenEndpoint) {
      return reply.status(502).send({
        error: 'server_error',
        error_description: 'IdP discovery document missing token_endpoint',
      });
    }

    // Forward the token request to the IdP
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant-type:device_code',
      device_code: data.device_code,
      client_id: data.client_id,
    });

    try {
      const idpResponse = await fetch(config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: AbortSignal.timeout(10_000),
      });

      const idpData = await idpResponse.json() as Record<string, unknown>;

      if (!idpResponse.ok) {
        // RFC 8628 §3.5: Return pending/slow_down errors with 400
        return reply.status(idpResponse.status).send(idpData);
      }

      return reply.status(200).send(idpData);
    } catch (e: unknown) {
      return reply.status(502).send({
        error: 'server_error',
        error_description: `IdP token request failed: ${e instanceof Error ? e.message : 'unknown error'}`,
      });
    }
  }));
}
