/**
 * routes/index.ts — Barrel export for all route modules.
 */

export { registerHealthRoutes } from './health.js';
export { registerAuthRoutes } from './auth.js';
export { registerAuditRoutes } from './audit.js';
export { registerSessionRoutes } from './sessions.js';
export { registerSessionActionRoutes } from './session-actions.js';
export { registerSessionDataRoutes } from './session-data.js';
export { registerEventRoutes } from './events.js';
export { registerTemplateRoutes } from './templates.js';
export { registerPipelineRoutes } from './pipelines.js';
export { registerAnalyticsRoutes } from './analytics.js';
export { registerOidcAuthRoutes } from './oidc-auth.js';
export { registerOpenApiSpec, registerOpenApiRoute } from './openapi.js';
export { registerUsageRoutes } from './usage.js';
export type { RouteContext } from './context.js';
