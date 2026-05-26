/**
 * api/auth.ts — Authentication, OIDC session, auth keys, SSE tokens.
 */

import { z } from 'zod';

import type {
  ApiKeyRole,
  VerifyTokenResponse,
  OkResponse,
  AuthKeySummary,
  CreatedAuthKey,
} from '../types';
import {
  AuthKeySummarySchema,
  CreatedAuthKeySchema,
  OkResponseSchema,
} from './schemas';
import { request,
  BASE_URL, OIDC_LOGIN_PATH, isRecord } from './base';

// ── Auth Verify ────────────────────────────────────────────────

export function verifyToken(token: string): Promise<VerifyTokenResponse> {
  return request('/v1/auth/verify', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ token }),
  });
}

// ── Dashboard OIDC Session ─────────────────────────────────────

export interface DashboardSessionIdentity {
  authenticated: true;
  userId: string;
  email?: string;
  name?: string;
  tenantId: string;
  role: ApiKeyRole;
  createdAt: number;
  expiresAt: number;
}

export type DashboardAuthMethod = 'oidc' | 'token';

export type DashboardSessionResult =
  | { oidcAvailable: boolean; authenticated: false }
  | { oidcAvailable: boolean; authenticated: true; authMethod: DashboardAuthMethod; identity: DashboardSessionIdentity };

export type DashboardLogoutResult = 'logged-out' | 'unavailable';

function isApiKeyRole(value: unknown): value is ApiKeyRole {
  return value === 'admin' || value === 'operator' || value === 'viewer';
}

function isDashboardSessionIdentity(value: unknown): value is DashboardSessionIdentity {
  if (!isRecord(value)) return false;
  const email = value.email;
  const name = value.name;
  return value.authenticated === true
    && typeof value.userId === 'string'
    && (email === undefined || typeof email === 'string')
    && (name === undefined || typeof name === 'string')
    && typeof value.tenantId === 'string'
    && isApiKeyRole(value.role)
    && typeof value.createdAt === 'number'
    && typeof value.expiresAt === 'number';
}

async function readJsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function getOidcLoginUrl(): string {
  return `${BASE_URL}${OIDC_LOGIN_PATH}`;
}

export async function getDashboardSession(): Promise<DashboardSessionResult> {
  const response = await fetch(`${BASE_URL}/auth/session`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 404) {
    return { oidcAvailable: false, authenticated: false };
  }
  if (response.status === 401) {
    return { oidcAvailable: true, authenticated: false };
  }
  if (!response.ok) {
    const body = await readJsonOrNull(response);
    const message = isRecord(body) && typeof body.error === 'string'
      ? body.error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }

  const body = await readJsonOrNull(response);
  if (isRecord(body) && body.authenticated === false) {
    return { oidcAvailable: body.oidcAvailable === true, authenticated: false };
  }
  if (!isDashboardSessionIdentity(body)) {
    throw new Error('Invalid dashboard session response');
  }
  const rawAuthMethod = isRecord(body) ? body.authMethod : undefined;
  const authMethod: DashboardAuthMethod = rawAuthMethod === 'oidc' ? 'oidc' : 'token';
  const identity: DashboardSessionIdentity = {
    authenticated: true,
    userId: body.userId,
    ...(body.email ? { email: body.email } : {}),
    ...(body.name ? { name: body.name } : {}),
    tenantId: body.tenantId,
    role: body.role,
    createdAt: body.createdAt,
    expiresAt: body.expiresAt,
  };
  return { oidcAvailable: isRecord(body) ? body.oidcAvailable === true : false, authenticated: true, authMethod, identity };
}

export async function logoutDashboardSession(): Promise<DashboardLogoutResult> {
  const response = await fetch(`${BASE_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (response.status === 404) {
    return 'unavailable';
  }
  if (response.ok) {
    return 'logged-out';
  }

  const body = await readJsonOrNull(response);
  const message = isRecord(body) && typeof body.error === 'string'
    ? body.error
    : `HTTP ${response.status}`;
  throw new Error(message);
}

// ── SSE Token ──────────────────────────────────────────────────

// #297: Short-lived SSE token to avoid exposing long-lived bearer token in URL
export interface SSETokenResponse {
  token: string;
  expiresAt: number;
}

export function createSSEToken(signal?: AbortSignal): Promise<SSETokenResponse> {
  return request('/v1/auth/sse-token', { method: 'POST', signal });
}

// ── Auth Keys ──────────────────────────────────────────────────

export type AuthKey = AuthKeySummary;
export type { CreatedAuthKey };

export function createAuthKey(name: string): Promise<CreatedAuthKey> {
  return request('/v1/auth/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
    schema: CreatedAuthKeySchema,
    schemaContext: 'createAuthKey',
  });
}

export function getAuthKeys(): Promise<AuthKey[]> {
  return request('/v1/auth/keys', {
    schema: z.array(AuthKeySummarySchema),
    schemaContext: 'getAuthKeys',
  });
}

export function revokeAuthKey(id: string): Promise<OkResponse> {
  return request(`/v1/auth/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    schema: OkResponseSchema,
    schemaContext: 'revokeAuthKey',
  });
}
