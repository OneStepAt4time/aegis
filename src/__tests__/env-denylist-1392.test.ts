/**
 * env-denylist-1392.test.ts — Tests for Issue #1392 + #1908: Env var injection denylist.
 *
 * Validates that the live Zod schema (buildEnvSchema) rejects dangerous env vars
 * including AI provider keys, application secrets, credential-leaking vars,
 * platform-specific vars (Linux, macOS, Windows), and enforces value hardening.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEnvSchema,
  ENV_DENYLIST,
  ENV_DANGEROUS_PREFIXES,
  ENV_BYO_LLM_WHITELIST,
  stripCrLf,
  hasControlChars,
} from '../validation.js';
import { z } from 'zod';

/** Helper: parse env through the live Zod schema and expect failure. */
function expectRejection(env: Record<string, string>, messageFragment?: string) {
  const schema = buildEnvSchema();
  const result = schema.safeParse(env);
  expect(result.success).toBe(false);
  if (messageFragment && !result.success) {
    const messages = result.error.issues.map(i => i.message).join('; ');
    expect(messages).toContain(messageFragment);
  }
}

/** Helper: parse env through the live Zod schema and expect success. */
function expectSuccess(env: Record<string, string>) {
  const schema = buildEnvSchema();
  const result = schema.safeParse(env);
  expect(result.success).toBe(true);
}

describe('Env var denylist — live Zod schema (Issues #1392 + #1908)', () => {
  describe('AI provider API keys', () => {
    it('rejects ANTHROPIC_API_KEY', () => {
      expectRejection({ ANTHROPIC_API_KEY: 'sk-ant-...' }, 'denylisted');
    });

    it('rejects OPENAI_API_KEY', () => {
      expectRejection({ OPENAI_API_KEY: 'sk-...' }, 'denylisted');
    });

    it('rejects CLAUDE_API_KEY', () => {
      expectRejection({ CLAUDE_API_KEY: 'sk-ant-...' }, 'denylisted');
    });

    it('rejects GOOGLE_AI_API_KEY', () => {
      expectRejection({ GOOGLE_AI_API_KEY: 'AIza...' }, 'denylisted');
    });

    it('rejects MISTRAL_API_KEY', () => {
      expectRejection({ MISTRAL_API_KEY: 'mist-...' }, 'denylisted');
    });

    it('rejects DEEPSEEK_API_KEY', () => {
      expectRejection({ DEEPSEEK_API_KEY: 'dsk-...' }, 'denylisted');
    });
  });

  describe('Application secrets', () => {
    it('rejects AEGIS_SECRET', () => {
      expectRejection({ AEGIS_SECRET: 'super-secret' }, 'denylisted');
    });

    it('rejects DATABASE_URL', () => {
      expectRejection({ DATABASE_URL: 'postgres://...' }, 'denylisted');
    });

    it('rejects SECRET_KEY', () => {
      expectRejection({ SECRET_KEY: 'abc123' }, 'denylisted');
    });

    it('rejects JWT_SECRET', () => {
      expectRejection({ JWT_SECRET: 'jwt-secret' }, 'denylisted');
    });

    it('rejects SESSION_SECRET', () => {
      expectRejection({ SESSION_SECRET: 'sess-secret' }, 'denylisted');
    });

    it('rejects ENCRYPTION_KEY', () => {
      expectRejection({ ENCRYPTION_KEY: 'enc-key' }, 'denylisted');
    });
  });

  describe('Core dangerous vars (regression)', () => {
    it('rejects PATH injection', () => {
      expectRejection({ PATH: '/evil' }, 'denylisted');
    });

    it('rejects LD_PRELOAD injection', () => {
      expectRejection({ LD_PRELOAD: '/evil.so' }, 'denylisted');
    });

    it('rejects NODE_OPTIONS injection', () => {
      expectRejection({ NODE_OPTIONS: '--require /evil.js' }, 'denylisted');
    });

    it('rejects GITHUB_TOKEN', () => {
      expectRejection({ GITHUB_TOKEN: 'ghp_...' }, 'GITHUB_');
    });

    it('rejects HOME', () => {
      expectRejection({ HOME: '/evil' }, 'denylisted');
    });
  });

  describe('Dangerous prefixes', () => {
    it('rejects AWS_ prefix', () => {
      expectRejection({ AWS_CUSTOM_VAR: 'val' }, 'prefix "AWS_"');
    });

    it('rejects GITHUB_ prefix', () => {
      expectRejection({ GITHUB_CUSTOM_VAR: 'val' }, 'prefix "GITHUB_"');
    });

    it('rejects npm_config_ prefix', () => {
      expectRejection({ npm_config_registry: 'http://evil' }, 'prefix "npm_config_"');
    });

    it('rejects SSH_ prefix', () => {
      expectRejection({ SSH_PRIVATE_KEY: 'key' }, 'prefix "SSH_"');
    });

    it('rejects CI_ prefix', () => {
      expectRejection({ CI_JOB_TOKEN: 'tok' }, 'prefix "CI_"');
    });

    it('rejects DOCKER_ prefix', () => {
      expectRejection({ DOCKER_TOKEN: 'tok' }, 'prefix "DOCKER_"');
    });
  });

  describe('Linux-specific dangerous vars', () => {
    it('rejects LD_AUDIT', () => {
      expectRejection({ LD_AUDIT: 'audit.so' }, 'denylisted');
    });

    it('rejects LD_DEBUG', () => {
      expectRejection({ LD_DEBUG: 'all' }, 'denylisted');
    });

    it('rejects LD_BIND_NOW', () => {
      expectRejection({ LD_BIND_NOW: '1' }, 'denylisted');
    });
  });

  describe('macOS-specific dangerous vars', () => {
    it('rejects DYLD_LIBRARY_PATH', () => {
      expectRejection({ DYLD_LIBRARY_PATH: '/evil' }, 'denylisted');
    });

    it('rejects DYLD_FRAMEWORK_PATH', () => {
      expectRejection({ DYLD_FRAMEWORK_PATH: '/evil' }, 'denylisted');
    });

    it('rejects DYLD_ROOT_PATH', () => {
      expectRejection({ DYLD_ROOT_PATH: '/evil' }, 'denylisted');
    });
  });

  describe('Windows-specific dangerous vars', () => {
    it('rejects COMSPEC', () => {
      expectRejection({ COMSPEC: 'cmd.exe' }, 'denylisted');
    });

    it('rejects WINDIR', () => {
      expectRejection({ WINDIR: 'C:\\Windows' }, 'denylisted');
    });

    it('rejects SYSTEMROOT', () => {
      expectRejection({ SYSTEMROOT: 'C:\\Windows' }, 'denylisted');
    });

    it('rejects APPDATA', () => {
      expectRejection({ APPDATA: 'C:\\Users\\x\\AppData' }, 'denylisted');
    });

    it('rejects USERPROFILE', () => {
      expectRejection({ USERPROFILE: 'C:\\Users\\evil' }, 'denylisted');
    });
  });

  describe('BYO-LLM whitelist', () => {
    it('allows ANTHROPIC_BASE_URL', () => {
      expectSuccess({ ANTHROPIC_BASE_URL: 'https://api.openrouter.ai' });
    });

    it('allows ANTHROPIC_AUTH_TOKEN', () => {
      expectSuccess({ ANTHROPIC_AUTH_TOKEN: 'tok-123' });
    });

    it('allows ANTHROPIC_DEFAULT_FAST_MODEL', () => {
      expectSuccess({ ANTHROPIC_DEFAULT_FAST_MODEL: 'claude-haiku-4-5-20251001' });
    });

    it('allows ANTHROPIC_DEFAULT_MODEL', () => {
      expectSuccess({ ANTHROPIC_DEFAULT_MODEL: 'claude-sonnet-4-20250514' });
    });

    it('allows API_TIMEOUT_MS', () => {
      expectSuccess({ API_TIMEOUT_MS: '30000' });
    });
  });

  describe('Valid env vars pass', () => {
    it('allows MY_CUSTOM_VAR', () => {
      expectSuccess({ MY_CUSTOM_VAR: 'value' });
    });

    it('allows PROJECT_NAME', () => {
      expectSuccess({ PROJECT_NAME: 'aegis' });
    });

    it('allows multiple safe vars', () => {
      expectSuccess({ FOO: 'bar', BAZ: 'qux', MY_TOKEN: 'safe' });
    });

    it('allows _ prefixed vars', () => {
      expectSuccess({ _MY_VAR: 'val' });
    });
  });

  describe('Invalid env var names', () => {
    it('rejects lowercase names', () => {
      expectRejection({ my_var: 'val' }, 'Invalid env var name');
    });

    it('rejects names starting with digits', () => {
      expectRejection({ '1BAD': 'val' }, 'Invalid env var name');
    });
  });

  describe('Value hardening', () => {
    it('strips CR/LF from values', () => {
      const schema = buildEnvSchema();
      const result = schema.safeParse({ MY_VAR: 'hello\r\nworld' });
      expect(result.success).toBe(true);
      if (result.success) {
        const data = result.data as Record<string, string>;
        expect(data.MY_VAR).toBe('helloworld');
      }
    });

    it('rejects values with control characters', () => {
      expectRejection({ MY_VAR: 'hello\x00world' }, 'control characters');
    });

    it('rejects values with TAB以外的控制字符', () => {
      expectRejection({ MY_VAR: 'val\x1Fue' }, 'control characters');
    });

    it('allows TAB in values', () => {
      expectSuccess({ MY_VAR: 'hello\tworld' });
    });

    it('rejects values exceeding 8 KiB', () => {
      const longValue = 'A'.repeat(8193);
      expectRejection({ MY_VAR: longValue }, 'exceeds');
    });

    it('allows values at exactly 8 KiB', () => {
      const exactValue = 'A'.repeat(8192);
      expectSuccess({ MY_VAR: exactValue });
    });
  });

  describe('Config overrides', () => {
    it('additive denylist via extraDenylist', () => {
      const schema = buildEnvSchema(['MY_EXTRA_DENIED_VAR']);
      const result = schema.safeParse({ MY_EXTRA_DENIED_VAR: 'val' });
      expect(result.success).toBe(false);
    });

    it('admin allowlist exempts denylisted vars', () => {
      const schema = buildEnvSchema([], ['NODE_OPTIONS']);
      const result = schema.safeParse({ NODE_OPTIONS: '--max-old-space-size=4096' });
      expect(result.success).toBe(true);
    });

    it('admin allowlist exempts prefix-blocked vars', () => {
      const schema = buildEnvSchema([], ['GITHUB_MY_SAFE_VAR']);
      const result = schema.safeParse({ GITHUB_MY_SAFE_VAR: 'val' });
      expect(result.success).toBe(true);
    });
  });

  describe('Exported constants match live schema', () => {
    it('ENV_DENYLIST contains expected entries', () => {
      expect(ENV_DENYLIST).toContain('PATH');
      expect(ENV_DENYLIST).toContain('HOME');
      expect(ENV_DENYLIST).toContain('LD_PRELOAD');
      expect(ENV_DENYLIST).toContain('NODE_OPTIONS');
      expect(ENV_DENYLIST).toContain('DYLD_INSERT_LIBRARIES');
      expect(ENV_DENYLIST).toContain('LD_LIBRARY_PATH');
      expect(ENV_DENYLIST).toContain('ANTHROPIC_API_KEY');
      expect(ENV_DENYLIST).toContain('COMSPEC');
      expect(ENV_DENYLIST).toContain('DYLD_FRAMEWORK_PATH');
    });

    it('ENV_DANGEROUS_PREFIXES contains expected entries', () => {
      expect(ENV_DANGEROUS_PREFIXES).toContain('AWS_');
      expect(ENV_DANGEROUS_PREFIXES).toContain('SSH_');
      expect(ENV_DANGEROUS_PREFIXES).toContain('npm_config_');
    });

    it('ENV_BYO_LLM_WHITELIST contains expected entries', () => {
      expect(ENV_BYO_LLM_WHITELIST).toContain('ANTHROPIC_BASE_URL');
      expect(ENV_BYO_LLM_WHITELIST).toContain('ANTHROPIC_AUTH_TOKEN');
      expect(ENV_BYO_LLM_WHITELIST).toContain('API_TIMEOUT_MS');
    });
  });

  describe('stripCrLf and hasControlChars helpers', () => {
    it('stripCrLf removes carriage returns', () => {
      expect(stripCrLf('hello\rworld')).toBe('helloworld');
    });

    it('stripCrLf removes newlines', () => {
      expect(stripCrLf('hello\nworld')).toBe('helloworld');
    });

    it('stripCrLf removes CRLF', () => {
      expect(stripCrLf('hello\r\nworld')).toBe('helloworld');
    });

    it('hasControlChars detects null bytes', () => {
      expect(hasControlChars('hello\x00')).toBe(true);
    });

    it('hasControlChars allows plain strings', () => {
      expect(hasControlChars('hello world')).toBe(false);
    });

    it('hasControlChars allows TAB', () => {
      expect(hasControlChars('hello\tworld')).toBe(false);
    });
  });
});
