export { AuthManager, classifyBearerTokenForRoute } from './AuthManager.js';
export { QuotaManager } from './QuotaManager.js';
export type { QuotaCheckResult, QuotaUsage } from './QuotaManager.js';
export { RateLimiter } from './RateLimiter.js';
export {
  Permission,
  PERMISSION_VALUES,
  isPermission,
  normalizePermissions,
  permissionsForRole,
  // Legacy aliases
  API_KEY_PERMISSION_VALUES,
  isApiKeyPermission,
} from './permissions.js';
export type { Permission as ApiKeyPermission, ApiKeyRole } from './permissions.js';
export type { ApiKey, ApiKeyStore, AuthRejectReason, QuotaConfig, GraceKeyEntry } from './types.js';
