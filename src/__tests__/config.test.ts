import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

      expect(config.port).toBe(9100);
      expect(config.host).toBe('127.0.0.1');
      expect(config.authToken).toBe('');
      expect(config.tmuxSession).toBe('aegis');
      expect(config.maxSessionAgeMs).toBe(2 * 60 * 60 * 1000);
      expect(config.reaperIntervalMs).toBe(5 * 60 * 1000);
      expect(config.webhooks).toEqual([]);
      expect(config.tgBotToken).toBe('');
      expect(config.tgGroupId).toBe('');
      expect(config.tgTopicTtlMs).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('AEGIS_* environment variable overrides (new)', () => {
    it('overrides port via AEGIS_PORT', () => {
      process.env.AEGIS_PORT = '3000';
      const config = getConfig();
      expect(config.port).toBe(3000);
    });

    it('overrides host via AEGIS_HOST', () => {
      process.env.AEGIS_HOST = '0.0.0.0';
      const config = getConfig();
      expect(config.host).toBe('0.0.0.0');
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
