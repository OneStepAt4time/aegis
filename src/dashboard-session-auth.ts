import type { FastifyRequest } from 'fastify';
import type { ApiKeyPermission, ApiKeyRole } from './services/auth/index.js';
import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardSessionAuthContext,
  type DashboardOIDCManager,
  type DashboardRequestAuthContext,
} from './services/auth/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    authRole?: ApiKeyRole | null;
    authPermissions?: ApiKeyPermission[] | null;
    authActor?: string | null;
  }
}

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
  }
  return cookies;
}

export function resolveDashboardSessionAuthContext(
  cookieHeader: string | undefined,
  manager: Pick<DashboardOIDCManager, 'getSession'> | null | undefined,
): DashboardRequestAuthContext | null {
  if (!manager) return null;
  const sessionId = parseCookies(cookieHeader).get(DASHBOARD_SESSION_COOKIE);
  const session = manager.getSession(sessionId);
  return session ? getDashboardSessionAuthContext(session) : null;
}

export function applyDashboardSessionAuthContext(
  req: FastifyRequest,
  context: DashboardRequestAuthContext,
): void {
  req.authKeyId = context.keyId;
  req.authRole = context.role;
  req.authPermissions = [...context.permissions];
  req.authActor = context.actor;
  req.tenantId = context.tenantId;
}

export function authenticateDashboardSessionCookie(
  req: FastifyRequest,
  manager: Pick<DashboardOIDCManager, 'getSession'> | null | undefined,
): DashboardRequestAuthContext | null {
  const context = resolveDashboardSessionAuthContext(req.headers.cookie, manager);
  if (!context) return null;
  applyDashboardSessionAuthContext(req, context);
  return context;
}