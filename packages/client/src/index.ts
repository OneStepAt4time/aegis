/**
 * @onestepat4time/aegis-client — Official TypeScript client for Aegis.
 *
 * Generated from the OpenAPI 3.1 specification at openapi.yaml.
 * Covers all 53 REST endpoints with full TypeScript types.
 *
 * @example
 * // Class-based API (backward compatible)
 * import { AegisClient } from '@onestepat4time/aegis-client';
 * const client = new AegisClient('http://localhost:9100', 'your-token');
 * const sessions = await client.listSessions();
 *
 * @example
 * // Function-based API (recommended for new code)
 * import { setConfig, listSessions, createSession } from '@onestepat4time/aegis-client';
 * setConfig({ baseUrl: 'http://localhost:9100', auth: { bearer: 'your-token' } });
 * const { data } = await listSessions();
 */

// Backward-compatible class API
export { AegisClient, type AegisClientOptions } from './AegisClient.js';

// Generated SDK functions
export {
  answerSessionQuestion,
  approvePermission,
  batchCreateSessions,
  batchDeleteSessions,
  capturePane,
  createApiKey,
  createPipeline,
  createSession,
  createSseToken,
  createTemplate,
  deleteMemoryEntry,
  deleteTemplate,
  forkSession,
  getChannelHealth,
  getChildren,
  getDeadLetterQueue,
  getDiagnostics,
  getAlertStats,
  getAnalyticsCosts,
  getAnalyticsRateLimits,
  getAuditLog,
  getGlobalMetrics,
  getHealth,
  getHealthAlias,
  getMemoryEntry,
  getPermissionPolicy,
  getPermissionProfile,
  getPipeline,
  getSession,
  getSessionHealth,
  getSessionLatency,
  getSessionMemories,
  getSessionMetrics,
  getSessionsHealth,
  getSessionStats,
  getSessionSummary,
  getSessionTranscript,
  getSwarmStatus,
  getTemplate,
  getTranscriptCursor,
  getV2Status,
  handleSessionPermissionHook,
  handleSessionStopHook,
  interruptSession,
  killSession,
  listApiKeys,
  listMemories,
  listMemoryEntries,
  listModelTiers,
  listPipelines,
  listSessionHistory,
  listSessions,
  listSessionsAlias,
  listSessionTools,
  listTemplates,
  listTools,
  negotiateHandshake,
  readMessages,
  receiveHookEvent,
  rejectPermission,
  revokeApiKey,
  rotateApiKey,
  routeTask,
  sendBash,
  sendCommand,
  sendEscape,
  sendMessage,
  sendTestAlert,
  setMemoryEntry,
  setSessionMemory,
  spawnChild,
  subscribeGlobalEvents,
  subscribeSessionEvents,
  takeScreenshot,
  updatePermissionPolicy,
  updatePermissionProfile,
  updateTemplate,
  verifyApiToken,
  verifySession,
} from './generated/index.js';

// Key generated types
export type {
  SessionInfo,
  SessionHealth,
  SessionMetrics,
  HealthResponse,
  GlobalMetrics,
  CreateSessionRequest,
  CreatePipelineRequest,
  SessionStatusFilter,
  SessionId,
  ApiKey,
  ApiKeyRole,
  SessionTemplate,
  Options,
  ClientOptions,
} from './generated/index.js';
