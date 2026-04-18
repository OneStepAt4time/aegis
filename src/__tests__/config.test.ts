import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../config.js';
import { testPath } from './helpers/platform.js';

describe('config', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };

    // Clear any AEGIS/MANUS env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AEGIS_') || key.startsWith('MANUS_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AEGIS_') || key.startsWith('MANUS_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith('AEGIS_') || key.startsWith('MANUS_')) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  describe('defaults', () => {
    it('returns default values when no env overrides', () => {
      const config = getConfig();

      expect(config.baseUrl).toBe('http://127.0.0.1:9100');
      expect(config.port).toBe(9100);
      expect(config.host).toBe('127.0.0.1');
      expect(config.authToken).toBe('');
      expect(config.clientAuthToken).toBe('');
      expect(config.dashboardEnabled).toBe(true);
      expect(config.tmuxSession).toBe('aegis');
      expect(config.maxSessionAgeMs).toBe(2 * 60 * 60 * 1000);
      expect(config.reaperIntervalMs).toBe(5 * 60 * 1000);
      expect(config.webhooks).toEqual([]);
      expect(config.tgBotToken).toBe('');
      expect(config.tgGroupId).toBe('');
      expect(config.tgTopicTtlMs).toBe(24 * 60 * 60 * 1000);
      expect(config.hookSecretHeaderOnly).toBe(false);
    });
  });

  describe('AEGIS_* environment variable overrides (new)', () => {
    it('overrides port via AEGIS_PORT', () => {
      process.env.AEGIS_PORT = '3000';
      const config = getConfig();
      expect(config.port).toBe(3000);
      expect(config.baseUrl).toBe('http://127.0.0.1:3000');
    });

    it('overrides host via AEGIS_HOST', () => {
      process.env.AEGIS_HOST = '0.0.0.0';
      const config = getConfig();
      expect(config.host).toBe('0.0.0.0');
      expect(config.baseUrl).toBe('http://127.0.0.1:9100');
    });

    it('overrides baseUrl via AEGIS_BASE_URL', () => {
      process.env.AEGIS_BASE_URL = 'https://aegis.example.com/';
      const config = getConfig();
      expect(config.baseUrl).toBe('https://aegis.example.com');
    });

    it('overrides authToken via AEGIS_AUTH_TOKEN', () => {
      process.env.AEGIS_AUTH_TOKEN = 'secret-token';
      const config = getConfig();
      expect(config.authToken).toBe('secret-token');
    });

    it('overrides tmuxSession via AEGIS_TMUX_SESSION', () => {
      process.env.AEGIS_TMUX_SESSION = 'my-session';
      const config = getConfig();
      expect(config.tmuxSession).toBe('my-session');
    });

    it('overrides stateDir via AEGIS_STATE_DIR', () => {
      process.env.AEGIS_STATE_DIR = testPath('/custom/state');
      const config = getConfig();
      expect(config.stateDir).toBe(testPath('/custom/state'));
    });

    it('overrides continuation pointer TTL via AEGIS_CONTINUATION_POINTER_TTL_MS', () => {
      process.env.AEGIS_CONTINUATION_POINTER_TTL_MS = '120000';
      const config = getConfig();
      expect(config.continuationPointerTtlMs).toBe(120000);
    });

    it('overrides webhooks via AEGIS_WEBHOOKS', () => {
      process.env.AEGIS_WEBHOOKS = 'https://example.com/hook';
      const config = getConfig();
      expect(config.webhooks).toEqual(['https://example.com/hook']);
    });

    it('parses comma-separated webhooks', () => {
      process.env.AEGIS_WEBHOOKS = 'https://a.com/hook, https://b.com/hook';
      const config = getConfig();
      expect(config.webhooks).toEqual(['https://a.com/hook', 'https://b.com/hook']);
    });

    it('overrides Telegram topic TTL via AEGIS_TG_TOPIC_TTL_MS', () => {
      process.env.AEGIS_TG_TOPIC_TTL_MS = '60000';
      const config = getConfig();
      expect(config.tgTopicTtlMs).toBe(60000);
    });

    it('overrides hook secret transport mode via AEGIS_HOOK_SECRET_HEADER_ONLY', () => {
      process.env.AEGIS_HOOK_SECRET_HEADER_ONLY = 'true';
      const config = getConfig();
      expect(config.hookSecretHeaderOnly).toBe(true);
    });

    it('overrides dashboard enablement via AEGIS_DASHBOARD_ENABLED', () => {
      process.env.AEGIS_DASHBOARD_ENABLED = 'false';
      const config = getConfig();
      expect(config.dashboardEnabled).toBe(false);
    });
  });

  describe('MANUS_* backward compatibility', () => {
    it('overrides port via MANUS_PORT (legacy)', () => {
      process.env.MANUS_PORT = '3000';
      const config = getConfig();
      expect(config.port).toBe(3000);
    });

    it('overrides host via MANUS_HOST (legacy)', () => {
      process.env.MANUS_HOST = '0.0.0.0';
      const config = getConfig();
      expect(config.host).toBe('0.0.0.0');
    });

    it('overrides authToken via MANUS_AUTH_TOKEN (legacy)', () => {
      process.env.MANUS_AUTH_TOKEN = 'secret-token';
      const config = getConfig();
      expect(config.authToken).toBe('secret-token');
    });

    it('overrides tmuxSession via MANUS_TMUX_SESSION (legacy)', () => {
      process.env.MANUS_TMUX_SESSION = 'my-session';
      const config = getConfig();
      expect(config.tmuxSession).toBe('my-session');
    });

    it('overrides stateDir via MANUS_STATE_DIR (legacy)', () => {
      process.env.MANUS_STATE_DIR = testPath('/custom/state');
      const config = getConfig();
      expect(config.stateDir).toBe(testPath('/custom/state'));
    });

    it('overrides claudeProjectsDir via MANUS_CLAUDE_PROJECTS_DIR (legacy)', () => {
      process.env.MANUS_CLAUDE_PROJECTS_DIR = testPath('/custom/claude');
      const config = getConfig();
      expect(config.claudeProjectsDir).toBe(testPath('/custom/claude'));
    });

    it('overrides maxSessionAgeMs via MANUS_MAX_SESSION_AGE_MS (legacy)', () => {
      process.env.MANUS_MAX_SESSION_AGE_MS = '3600000';
      const config = getConfig();
      expect(config.maxSessionAgeMs).toBe(3600000);
    });

    it('overrides reaperIntervalMs via MANUS_REAPER_INTERVAL_MS (legacy)', () => {
      process.env.MANUS_REAPER_INTERVAL_MS = '60000';
      const config = getConfig();
      expect(config.reaperIntervalMs).toBe(60000);
    });

    it('overrides tgBotToken via MANUS_TG_TOKEN (legacy)', () => {
      process.env.MANUS_TG_TOKEN = 'bot123:abc';
      const config = getConfig();
      expect(config.tgBotToken).toBe('bot123:abc');
    });

    it('overrides tgGroupId via MANUS_TG_GROUP (legacy)', () => {
      process.env.MANUS_TG_GROUP = '-12345';
      const config = getConfig();
      expect(config.tgGroupId).toBe('-12345');
    });

    it('parses single webhook from MANUS_WEBHOOKS (legacy)', () => {
      process.env.MANUS_WEBHOOKS = 'https://example.com/hook';
      const config = getConfig();
      expect(config.webhooks).toEqual(['https://example.com/hook']);
    });

    it('overrides hook secret transport mode via MANUS_HOOK_SECRET_HEADER_ONLY (legacy)', () => {
      process.env.MANUS_HOOK_SECRET_HEADER_ONLY = 'true';
      const config = getConfig();
      expect(config.hookSecretHeaderOnly).toBe(true);
    });
  });

  describe('AEGIS_* takes priority over MANUS_*', () => {
    it('AEGIS_PORT wins over MANUS_PORT', () => {
      process.env.MANUS_PORT = '3000';
      process.env.AEGIS_PORT = '4000';
      const config = getConfig();
      expect(config.port).toBe(4000);
    });

    it('AEGIS_AUTH_TOKEN wins over MANUS_AUTH_TOKEN', () => {
      process.env.MANUS_AUTH_TOKEN = 'old-token';
      process.env.AEGIS_AUTH_TOKEN = 'new-token';
      const config = getConfig();
      expect(config.authToken).toBe('new-token');
    });

    it('AEGIS_TMUX_SESSION wins over MANUS_TMUX_SESSION', () => {
      process.env.MANUS_TMUX_SESSION = 'manus';
      process.env.AEGIS_TMUX_SESSION = 'aegis';
      const config = getConfig();
      expect(config.tmuxSession).toBe('aegis');
    });

    it('AEGIS_HOOK_SECRET_HEADER_ONLY wins over MANUS_HOOK_SECRET_HEADER_ONLY', () => {
      process.env.MANUS_HOOK_SECRET_HEADER_ONLY = 'false';
      process.env.AEGIS_HOOK_SECRET_HEADER_ONLY = 'true';
      const config = getConfig();
      expect(config.hookSecretHeaderOnly).toBe(true);
    });
  });

  describe('numeric parsing', () => {
    it('parses numeric values correctly', () => {
      process.env.AEGIS_PORT = '8080';
      process.env.AEGIS_MAX_SESSION_AGE_MS = '7200000';
      process.env.AEGIS_REAPER_INTERVAL_MS = '120000';

      const config = getConfig();

      expect(typeof config.port).toBe('number');
      expect(typeof config.maxSessionAgeMs).toBe('number');
      expect(typeof config.reaperIntervalMs).toBe('number');
      expect(config.port).toBe(8080);
      expect(config.maxSessionAgeMs).toBe(7200000);
      expect(config.reaperIntervalMs).toBe(120000);
    });

    it('falls back and warns when AEGIS_PORT is out of range', () => {
      process.env.AEGIS_PORT = '70000';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = getConfig();
      const warnings = warnSpy.mock.calls.map(call => String(call[0])).join('\n');

      expect(config.port).toBe(9100);
      expect(warnings).toContain("AEGIS_PORT='70000'");
      expect(warnings).toContain('<= 65535');
    });

    it('falls back and warns when numeric env value is not a strict integer', () => {
      process.env.AEGIS_MAX_SESSION_AGE_MS = '3600000ms';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = getConfig();
      const warnings = warnSpy.mock.calls.map(call => String(call[0])).join('\n');

      expect(config.maxSessionAgeMs).toBe(2 * 60 * 60 * 1000);
      expect(warnings).toContain("AEGIS_MAX_SESSION_AGE_MS='3600000ms'");
      expect(warnings).toContain('expected an integer');
    });

    it('accepts 0 for AEGIS_PIPELINE_STAGE_TIMEOUT_MS and rejects negative values', () => {
      process.env.AEGIS_PIPELINE_STAGE_TIMEOUT_MS = '0';
      const zeroConfig = getConfig();
      expect(zeroConfig.pipelineStageTimeoutMs).toBe(0);

      process.env.AEGIS_PIPELINE_STAGE_TIMEOUT_MS = '-1';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const negativeConfig = getConfig();
      const warnings = warnSpy.mock.calls.map(call => String(call[0])).join('\n');

      expect(negativeConfig.pipelineStageTimeoutMs).toBe(0);
      expect(warnings).toContain("AEGIS_PIPELINE_STAGE_TIMEOUT_MS='-1'");
      expect(warnings).toContain('>= 0');
    });
  });

  describe('invalid env warnings', () => {
    it('warns and keeps default when AEGIS_HOOK_SECRET_HEADER_ONLY is invalid', () => {
      process.env.AEGIS_HOOK_SECRET_HEADER_ONLY = 'yes';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = getConfig();
      const warnings = warnSpy.mock.calls.map(call => String(call[0])).join('\n');

      expect(config.hookSecretHeaderOnly).toBe(false);
      expect(warnings).toContain("AEGIS_HOOK_SECRET_HEADER_ONLY='yes'");
      expect(warnings).toContain('expected "true" or "false"');
    });

    it('warns for invalid Telegram allowlist entries while keeping valid IDs', () => {
      process.env.AEGIS_TG_ALLOWED_USERS = '111,abc,-5,222';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = getConfig();
      const warnings = warnSpy.mock.calls.map(call => String(call[0])).join('\n');

      expect(config.tgAllowedUsers).toEqual([111, 222]);
      expect(warnings).toContain('AEGIS_TG_ALLOWED_USERS');
      expect(warnings).toContain('abc, -5');
    });
  });

  describe('multiple overrides', () => {
    it('multiple env overrides work together', () => {
      process.env.AEGIS_PORT = '3000';
      process.env.AEGIS_HOST = '0.0.0.0';
      process.env.AEGIS_AUTH_TOKEN = 'test-token';
      process.env.AEGIS_WEBHOOKS = 'https://webhook.example.com';

      const config = getConfig();

      expect(config.port).toBe(3000);
      expect(config.host).toBe('0.0.0.0');
      expect(config.authToken).toBe('test-token');
      expect(config.webhooks).toEqual(['https://webhook.example.com']);
    });
  });
});
