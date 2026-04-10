/**
 * Compatibility re-export for legacy imports.
 * Auth implementation now lives under src/services/auth/.
 */

export { AuthManager, classifyBearerTokenForRoute } from './services/auth/index.js';
export type { ApiKey, ApiKeyRole, ApiKeyStore, AuthRejectReason } from './services/auth/index.js';
