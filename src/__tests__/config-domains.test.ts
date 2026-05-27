/**
 * config-domains.test.ts — Unit tests for domain config schemas and defaults.
 *
 * Issue #4232: Verify that split domain schemas validate correctly,
 * produce correct defaults, and merge into the full Config shape.
 */

import { describe, it, expect } from 'vitest';
import {
  authConfigSchema,
  channelConfigSchema,
  serverConfigSchema,
  sessionConfigSchema,
  budgetConfigSchema,
  fullConfigSchema,
  computeStallThreshold,
  SYSTEM_TENANT,
} from '../config/index.js';

describe('authConfigSchema', () => {
  it('applies defaults for empty input', () => {
    const result = authConfigSchema.parse({});
    expect(result.authToken).toBe('');
    expect(result.defaultPermissionMode).toBe('default');
    expect(result.hookSecretHeaderOnly).toBe(false);
    expect(result.metricsToken).toBe('');
    expect(result.enforceSessionOwnership).toBe(true);
    expect(result.strictRBAC).toBe(false);
    expect(result.requireSessionApproval).toBe(false);
    expect(result.sessionApprovalTimeoutMs).toBe(300_000);
    expect(result.keyRotationGraceSeconds).toBe(3600);
  });

  it('accepts valid auth config', () => {
    const result = authConfigSchema.parse({
      authToken: 'secret-token',
      defaultPermissionMode: 'bypassPermissions',
      enforceSessionOwnership: false,
      strictRBAC: true,
    });
    expect(result.authToken).toBe('secret-token');
    expect(result.defaultPermissionMode).toBe('bypassPermissions');
    expect(result.enforceSessionOwnership).toBe(false);
    expect(result.strictRBAC).toBe(true);
  });

  it('accepts all valid permission modes', () => {
    const modes = ['default', 'plan', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'auto'];
    for (const mode of modes) {
      const result = authConfigSchema.parse({ defaultPermissionMode: mode });
      expect(result.defaultPermissionMode).toBe(mode);
    }
  });
});

describe('channelConfigSchema', () => {
  it('applies defaults for empty input', () => {
    const result = channelConfigSchema.parse({});
    expect(result.tgBotToken).toBe('');
    expect(result.tgGroupId).toBe('');
    expect(result.tgAllowedUsers).toEqual([]);
    expect(result.tgTopicTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(result.tgTopicAutoDelete).toBe(true);
    expect(result.tgVerbose).toBe(false);
    expect(result.tgTopicTTLHours).toBe(0);
    expect(result.webhooks).toEqual([]);
  });

  it('accepts valid channel config', () => {
    const result = channelConfigSchema.parse({
      tgBotToken: '123:abc',
      tgGroupId: '-1001234',
      tgAllowedUsers: [1, 2, 3],
      webhooks: ['https://example.com/hook'],
    });
    expect(result.tgBotToken).toBe('123:abc');
    expect(result.tgAllowedUsers).toEqual([1, 2, 3]);
    expect(result.webhooks).toEqual(['https://example.com/hook']);
  });
});

describe('serverConfigSchema', () => {
  it('applies defaults for empty input', () => {
    const result = serverConfigSchema.parse({});
    expect(result.baseUrl).toBe('');
    expect(result.port).toBe(9100);
    expect(result.host).toBe('127.0.0.1');
    expect(result.sseMaxConnections).toBe(100);
    expect(result.sseMaxPerIp).toBe(10);
    expect(result.sseIdleMs).toBe(60_000);
    expect(result.sseClientTimeoutMs).toBe(300_000);
    expect(result.shutdownGraceMs).toBe(15_000);
    expect(result.shutdownHardMs).toBe(20_000);
    expect(result.dashboardEnabled).toBe(true);
  });

  it('accepts valid server config', () => {
    const result = serverConfigSchema.parse({
      port: 8080,
      host: '0.0.0.0',
      baseUrl: 'https://my-aegis.example.com',
    });
    expect(result.port).toBe(8080);
    expect(result.host).toBe('0.0.0.0');
    expect(result.baseUrl).toBe('https://my-aegis.example.com');
  });
});

describe('sessionConfigSchema', () => {
  it('applies defaults for empty input', () => {
    const result = sessionConfigSchema.parse({});
    expect(result.maxSessionAgeMs).toBe(2 * 60 * 60 * 1000);
    expect(result.reaperIntervalMs).toBe(5 * 60 * 1000);
    expect(result.continuationPointerTtlMs).toBe(24 * 60 * 60 * 1000);
    expect(result.stallThresholdMs).toBe(120_000);
    expect(result.sessionCleanupIntervalMs).toBe(3_600_000);
    expect(result.sessionCleanupAgeMs).toBe(86_400_000);
    expect(result.stateStore).toBe('file');
    expect(result.acpEnabled).toBe(true);
    expect(result.acpPromptTimeoutMs).toBe(120_000);
    expect(result.acpStrictValidation).toBe(false);
    expect(result.isolationPolicy).toBe('respect-cc');
    expect(result.allowedWorkDirs).toEqual([]);
    expect(result.defaultSessionEnv).toEqual({});
  });

  it('accepts valid session config', () => {
    const result = sessionConfigSchema.parse({
      stateStore: 'postgres',
      postgresUrl: 'postgres://localhost/aegis',
      acpEnabled: false,
      isolationPolicy: 'enforce-worktree',
    });
    expect(result.stateStore).toBe('postgres');
    expect(result.acpEnabled).toBe(false);
    expect(result.isolationPolicy).toBe('enforce-worktree');
  });
});

describe('budgetConfigSchema', () => {
  it('applies defaults for empty input', () => {
    const result = budgetConfigSchema.parse({});
    expect(result.pipelineStageTimeoutMs).toBe(0);
    expect(result.hookTimeoutMs).toBe(10_000);
    expect(result.alerting.webhooks).toEqual([]);
    expect(result.alerting.failureThreshold).toBe(5);
    expect(result.alerting.cooldownMs).toBe(10 * 60 * 1000);
    expect(result.verificationProtocol.autoVerifyOnStop).toBe(false);
    expect(result.verificationProtocol.criticalOnly).toBe(false);
    expect(result.memoryBridge.enabled).toBe(true);
    expect(result.envDenylist).toEqual([]);
    expect(result.envAdminAllowlist).toEqual([]);
    expect(result.defaultTenantId).toBe('default');
    expect(result.tenantWorkdirs).toEqual({});
    expect(result.rateLimit.enabled).toBe(true);
    expect(result.rateLimit.sessionsMax).toBe(100);
    expect(result.rateLimit.generalMax).toBe(30);
    expect(result.rateLimit.timeWindowSec).toBe(60);
  });

  it('accepts valid budget config', () => {
    const result = budgetConfigSchema.parse({
      alerting: {
        webhooks: ['https://alerts.example.com'],
        failureThreshold: 3,
        cooldownMs: 300_000,
      },
      rateLimit: { enabled: false },
    });
    expect(result.alerting.webhooks).toEqual(['https://alerts.example.com']);
    expect(result.rateLimit.enabled).toBe(false);
  });
});

describe('fullConfigSchema (merged)', () => {
  it('merges all domains and applies defaults', () => {
    const result = fullConfigSchema.parse({});
    // Spot-check across domains
    expect(result.authToken).toBe('');          // auth
    expect(result.tgBotToken).toBe('');         // channels
    expect(result.port).toBe(9100);             // server
    expect(result.maxSessionAgeMs).toBe(2 * 60 * 60 * 1000); // sessions
    expect(result.pipelineStageTimeoutMs).toBe(0);            // budgets
  });

  it('accepts partial config from each domain', () => {
    const result = fullConfigSchema.parse({
      authToken: 'tok',
      tgBotToken: '456:def',
      port: 8080,
      maxSessionAgeMs: 3600000,
      alerting: { failureThreshold: 10 },
    });
    expect(result.authToken).toBe('tok');
    expect(result.tgBotToken).toBe('456:def');
    expect(result.port).toBe(8080);
    expect(result.maxSessionAgeMs).toBe(3600000);
    expect(result.alerting.failureThreshold).toBe(10);
  });
});

describe('exports', () => {
  it('exports SYSTEM_TENANT', () => {
    expect(SYSTEM_TENANT).toBe('_system');
  });

  it('computeStallThreshold returns default when no env', () => {
    const result = computeStallThreshold();
    expect(result).toBe(120_000);
  });
});
