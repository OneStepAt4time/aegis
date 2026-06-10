import { describe, it, expect } from 'vitest';
import { createStateStore } from '../services/state/store-factory.js';
import type { Config } from '../config.js';

describe('store-factory', () => {
  const baseConfig = {
    stateDir: '/tmp/test-state',
    stateStore: 'file',
    port: 3000,
    host: 'localhost',
    authToken: '',
    claudeProjectsDir: '/tmp/claude',
    maxSessionAgeMs: 3600000,
    reaperIntervalMs: 60000,
    continuationPointerTtlMs: 300000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [],
    tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgVerbose: false,
    tgTopicTTLHours: 0,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default',
    stallThresholdMs: 30000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    metricsToken: '',
    pipelineStageTimeoutMs: 30000,
    postgresUrl: '',
    alerting: { webhooks: [], failureThreshold: 3, cooldownMs: 60000 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: false,
    strictRBAC: false,
    sseIdleMs: 30000,
    sseClientTimeoutMs: 60000,
    hookTimeoutMs: 30000,
    shutdownGraceMs: 5000,
    keyRotationGraceSeconds: 3600,
    shutdownHardMs: 30000,
    defaultTenantId: 'default',
    tenantWorkdirs: {},
    rateLimit: { enabled: false, sessionsMax: 100, generalMax: 1000, timeWindowSec: 60 },
    acpEnabled: false,
    acpPromptTimeoutMs: 30000,
  } as Config;

  it('creates JsonFileStore for file backend', async () => {
    const store = await createStateStore({ ...baseConfig, stateStore: 'file' });
    expect(store.constructor.name).toBe('JsonFileStore');
  });

  it('creates JsonFileStore for empty backend (default)', async () => {
    const store = await createStateStore({ ...baseConfig, stateStore: '' });
    expect(store.constructor.name).toBe('JsonFileStore');
  });

  it('throws when postgres backend is missing postgresUrl', async () => {
    const config = { ...baseConfig, stateStore: 'postgres' as const, postgresUrl: '' };
    await expect(createStateStore(config as Config)).rejects.toThrow('PostgresStore requires AEGIS_POSTGRES_URL');
  });

  it('throws for unknown backend', async () => {
    await expect(
      createStateStore({ ...baseConfig, stateStore: 'unknown' as any })
    ).rejects.toThrow("Unknown state store backend: 'unknown'");
  });
});

// Coverage follow-up tests for store-factory.ts
describe('store-factory coverage follow-up', () => {
  // Reuse baseConfig from the parent describe — redeclare for clarity
  const baseConfig = {
    stateDir: '/tmp/test-state',
    stateStore: 'file' as const,
    port: 3000,
    host: 'localhost',
    authToken: '',
    claudeProjectsDir: '/tmp/claude',
    maxSessionAgeMs: 3600000,
    reaperIntervalMs: 60000,
    continuationPointerTtlMs: 300000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [] as number[],
    tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgVerbose: false,
    tgTopicTTLHours: 0,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default' as const,
    stallThresholdMs: 30000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    metricsToken: '',
    pipelineStageTimeoutMs: 30000,
    postgresUrl: '',
    alerting: { webhooks: [], failureThreshold: 3, cooldownMs: 60000 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: false,
    strictRBAC: false,
    sseIdleMs: 30000,
    sseClientTimeoutMs: 60000,
    hookTimeoutMs: 30000,
    shutdownGraceMs: 5000,
    keyRotationGraceSeconds: 3600,
    shutdownHardMs: 30000,
    defaultTenantId: 'default',
    tenantWorkdirs: {},
    rateLimit: { enabled: false, sessionsMax: 100, generalMax: 1000, timeWindowSec: 60 },
    acpEnabled: false,
    acpPromptTimeoutMs: 30000,
  } as Config;

  it('creates PostgresStore when postgresUrl is provided', async () => {
    const store = await createStateStore({
      ...baseConfig,
      stateStore: 'postgres',
      postgresUrl: 'postgres://user:pass@localhost:5432/testdb',
    });
    expect(store.constructor.name).toBe('PostgresStore');
  });

  it('creates PostgresStore with optional env vars', async () => {
    process.env['AEGIS_PG_TABLE'] = 'custom_table';
    process.env['AEGIS_PG_SCHEMA'] = 'custom_schema';
    process.env['AEGIS_PG_POOL_MAX'] = '20';
    try {
      const store = await createStateStore({
        ...baseConfig,
        stateStore: 'postgres',
        postgresUrl: 'postgres://localhost/testdb',
      });
      expect(store.constructor.name).toBe('PostgresStore');
    } finally {
      delete process.env['AEGIS_PG_TABLE'];
      delete process.env['AEGIS_PG_SCHEMA'];
      delete process.env['AEGIS_PG_POOL_MAX'];
    }
  });
});

// Coverage follow-up tests for store-factory.ts
describe('store-factory coverage follow-up', () => {
  const baseConfig = {
    stateDir: '/tmp/test-state',
    stateStore: 'file' as const,
    port: 3000,
    host: 'localhost',
    authToken: '',
    claudeProjectsDir: '/tmp/claude',
    maxSessionAgeMs: 3600000,
    reaperIntervalMs: 60000,
    continuationPointerTtlMs: 300000,
    tgBotToken: '',
    tgGroupId: '',
    tgAllowedUsers: [] as number[],
    tgTopicTtlMs: 0,
    tgTopicAutoDelete: true,
    tgVerbose: false,
    tgTopicTTLHours: 0,
    webhooks: [],
    defaultSessionEnv: {},
    defaultPermissionMode: 'default' as const,
    stallThresholdMs: 30000,
    sseMaxConnections: 100,
    sseMaxPerIp: 10,
    allowedWorkDirs: [],
    hookSecretHeaderOnly: false,
    memoryBridge: { enabled: false },
    worktreeAwareContinuation: false,
    worktreeSiblingDirs: [],
    verificationProtocol: { autoVerifyOnStop: false, criticalOnly: false },
    metricsToken: '',
    pipelineStageTimeoutMs: 30000,
    postgresUrl: '',
    alerting: { webhooks: [], failureThreshold: 3, cooldownMs: 60000 },
    envDenylist: [],
    envAdminAllowlist: [],
    enforceSessionOwnership: false,
    strictRBAC: false,
    sseIdleMs: 30000,
    sseClientTimeoutMs: 60000,
    hookTimeoutMs: 30000,
    shutdownGraceMs: 5000,
    keyRotationGraceSeconds: 3600,
    shutdownHardMs: 30000,
    defaultTenantId: 'default',
    tenantWorkdirs: {},
    rateLimit: { enabled: false, sessionsMax: 100, generalMax: 1000, timeWindowSec: 60 },
    acpEnabled: false,
    acpPromptTimeoutMs: 30000,
  } as Config;

  it('creates PostgresStore when postgresUrl is provided', async () => {
    const store = await createStateStore({
      ...baseConfig,
      stateStore: 'postgres',
      postgresUrl: 'postgres://user:pass@localhost:5432/testdb',
    });
    expect(store.constructor.name).toBe('PostgresStore');
  });

  it('creates PostgresStore with optional env vars', async () => {
    process.env['AEGIS_PG_TABLE'] = 'custom_table';
    process.env['AEGIS_PG_SCHEMA'] = 'custom_schema';
    process.env['AEGIS_PG_POOL_MAX'] = '20';
    try {
      const store = await createStateStore({
        ...baseConfig,
        stateStore: 'postgres',
        postgresUrl: 'postgres://localhost/testdb',
      });
      expect(store.constructor.name).toBe('PostgresStore');
    } finally {
      delete process.env['AEGIS_PG_TABLE'];
      delete process.env['AEGIS_PG_SCHEMA'];
      delete process.env['AEGIS_PG_POOL_MAX'];
    }
  });
});
