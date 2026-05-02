export { AuthManager, classifyBearerTokenForRoute } from './AuthManager.js';
export { QuotaManager } from './QuotaManager.js';
export type { QuotaCheckResult, QuotaUsage } from './QuotaManager.js';
export { RateLimiter } from './RateLimiter.js';
export {
  DASHBOARD_SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  DashboardOIDCManager,
  DashboardSessionStore,
  OpenidClientProvider,
  OidcAuthError,
  createDashboardOidcManagerFromEnv,
  generatePkcePair,
  getDashboardSessionAuthContext,
  mapOidcClaimsToIdentity,
  validateOidcClaims,
} from './OIDCManager.js';
export type { DashboardRequestAuthContext, DashboardSession } from './OIDCManager.js';
export {
  API_KEY_PERMISSION_VALUES,
  isApiKeyPermission,
  normalizePermissions,
  permissionsForRole,
} from './permissions.js';
export type { ApiKeyPermission } from './permissions.js';
export type { ApiKey, ApiKeyRole, ApiKeyStore, AuthRejectReason, QuotaConfig, GraceKeyEntry } from './types.js';
