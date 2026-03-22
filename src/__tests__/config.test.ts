import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../config.js';

describe('config', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = { ...process.env };

    // Clear any MANUS env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MANUS_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('MANUS_')) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (key.startsWith('MANUS_')) {
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
      expect(config.tmuxSession).toBe('manus');
      expect(config.maxSessionAgeMs).toBe(2 * 60 * 60 * 1000);
      expect(config.reaperIntervalMs).toBe(5 * 60 * 1000);
      expect(config.webhooks).toEqual([]);
      expect(config.tgBotToken).toBe('');
      expect(config.tgGroupId).toBe('');
    });
  });

  describe('environment variable overrides', () => {
    it('overrides port via MANUS_PORT', () => {
      process.env.MANUS_PORT = '3000';
      const config = getConfig();

      expect(config.port).toBe(3000);
    });

    it('overrides host via MANUS_HOST', () => {
      process.env.MANUS_HOST = '0.0.0.0';
      const config = getConfig();

      expect(config.host).toBe('0.0.0.0');
    });

    it('overrides authToken via MANUS_AUTH_TOKEN', () => {
      process.env.MANUS_AUTH_TOKEN = 'secret-token';
      const config = getConfig();

      expect(config.authToken).toBe('secret-token');
    });

    it('overrides tmuxSession via MANUS_TMUX_SESSION', () => {
      process.env.MANUS_TMUX_SESSION = 'my-session';
      const config = getConfig();

      expect(config.tmuxSession).toBe('my-session');
    });

    it('overrides stateDir via MANUS_STATE_DIR', () => {
      process.env.MANUS_STATE_DIR = '/custom/state';
      const config = getConfig();

      expect(config.stateDir).toBe('/custom/state');
    });

    it('overrides claudeProjectsDir via MANUS_CLAUDE_PROJECTS_DIR', () => {
      process.env.MANUS_CLAUDE_PROJECTS_DIR = '/custom/claude';
      const config = getConfig();

      expect(config.claudeProjectsDir).toBe('/custom/claude');
    });

    it('overrides maxSessionAgeMs via MANUS_MAX_SESSION_AGE_MS', () => {
      process.env.MANUS_MAX_SESSION_AGE_MS = '3600000';
      const config = getConfig();

      expect(config.maxSessionAgeMs).toBe(3600000);
    });

    it('overrides reaperIntervalMs via MANUS_REAPER_INTERVAL_MS', () => {
      process.env.MANUS_REAPER_INTERVAL_MS = '60000';
      const config = getConfig();

      expect(config.reaperIntervalMs).toBe(60000);
    });

    it('overrides tgBotToken via MANUS_TG_TOKEN', () => {
      process.env.MANUS_TG_TOKEN = 'bot123:abc';
      const config = getConfig();

      expect(config.tgBotToken).toBe('bot123:abc');
    });

    it('overrides tgGroupId via MANUS_TG_GROUP', () => {
      process.env.MANUS_TG_GROUP = '-12345';
      const config = getConfig();

      expect(config.tgGroupId).toBe('-12345');
    });

    it('parses single webhook from MANUS_WEBHOOKS', () => {
      process.env.MANUS_WEBHOOKS = 'https://example.com/hook';
      const config = getConfig();

      expect(config.webhooks).toEqual(['https://example.com/hook']);
    });

    it('parses comma-separated webhooks from MANUS_WEBHOOKS', () => {
      process.env.MANUS_WEBHOOKS = 'https://a.com/hook, https://b.com/hook';
      const config = getConfig();

      expect(config.webhooks).toEqual(['https://a.com/hook', 'https://b.com/hook']);
    });

    it('parses numeric values correctly', () => {
      process.env.MANUS_PORT = '8080';
      process.env.MANUS_MAX_SESSION_AGE_MS = '7200000';
      process.env.MANUS_REAPER_INTERVAL_MS = '120000';

      const config = getConfig();

      expect(typeof config.port).toBe('number');
      expect(typeof config.maxSessionAgeMs).toBe('number');
      expect(typeof config.reaperIntervalMs).toBe('number');
      expect(config.port).toBe(8080);
      expect(config.maxSessionAgeMs).toBe(7200000);
      expect(config.reaperIntervalMs).toBe(120000);
    });

    it('multiple env overrides work together', () => {
      process.env.MANUS_PORT = '3000';
      process.env.MANUS_HOST = '0.0.0.0';
      process.env.MANUS_AUTH_TOKEN = 'test-token';
      process.env.MANUS_WEBHOOKS = 'https://webhook.example.com';

      const config = getConfig();

      expect(config.port).toBe(3000);
      expect(config.host).toBe('0.0.0.0');
      expect(config.authToken).toBe('test-token');
      expect(config.webhooks).toEqual(['https://webhook.example.com']);
    });
  });
});
