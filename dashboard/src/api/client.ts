/**
 * api/client.ts — Aegis API client (re-export hub).
 * All implementations live in domain modules. This file re-exports everything
 * for backward compatibility — no existing imports need to change.
 */
export * from './base';
export * from './health';
export * from './updates';
export * from './metrics';
export * from './analytics';
export * from './sessions';
export * from './pipelines';
export * from './auth';
export * from './sse';
export * from './templates';
export * from './audit';
export * from './users';
export * from './session-history';
export * from './claude';
