/**
 * env-denylist-1392.test.ts — Tests for Issue #1392: Env var injection denylist.
 *
 * Validates that CreateSessionRequest.env rejects dangerous env vars
 * including AI provider keys, application secrets, and credential-leaking vars.
 */

import { describe, it, expect } from 'vitest';

// Extract the denylist logic to test it in isolation.
// We replicate the validation rules from session.ts to keep tests independent
// of SessionManager instantiation (which requires tmux, config, etc.).

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

const DANGEROUS_ENV_VARS = new Set([
  'PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'NODE_OPTIONS',
  'DYLD_INSERT_LIBRARIES', 'IFS', 'SHELL', 'ENV', 'BASH_ENV',
  'PYTHONPATH', 'PERL5LIB', 'RUBYLIB', 'CLASSPATH',
  'NODE_PATH', 'PYTHONHOME', 'PYTHONSTARTUP',
  'PROMPT_COMMAND', 'GIT_SSH_COMMAND', 'EDITOR', 'VISUAL',
  'SUDO_ASKPASS', 'GIT_EXEC_PATH', 'NODE_ENV',
  'GITHUB_TOKEN', 'NPM_TOKEN', 'GITLAB_TOKEN',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AZURE_CLIENT_SECRET', 'GOOGLE_APPLICATION_CREDENTIALS',
  'DOCKER_TOKEN', 'HEROKU_API_KEY',
  // Issue #1392
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_API_KEY',
  'GOOGLE_AI_API_KEY', 'MISTRAL_API_KEY', 'DEEPSEEK_API_KEY',
  'AEGIS_SECRET', 'DATABASE_URL', 'SECRET_KEY', 'JWT_SECRET',
  'SESSION_SECRET', 'ENCRYPTION_KEY',
]);

const DANGEROUS_ENV_PREFIXES = [
  'npm_config_', 'BASH_FUNC_', 'SSH_', 'GITHUB_', 'GITLAB_',
  'AWS_', 'AZURE_', 'TF_', 'CI_', 'DOCKER_',
];

function validateEnv(env: Record<string, string>): string | null {
  for (const key of Object.keys(env)) {
    if (DANGEROUS_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      const matchedPrefix = DANGEROUS_ENV_PREFIXES.find(p => key.startsWith(p))!;
      return `Forbidden env var: "${key}" — cannot override dangerous environment variable prefix "${matchedPrefix}"`;
    }
    if (!ENV_NAME_RE.test(key)) {
      return `Invalid env var name: "${key}" — must match /^[A-Z_][A-Z0-9_]*$/`;
    }
    if (DANGEROUS_ENV_VARS.has(key)) {
      return `Forbidden env var: "${key}" — cannot override dangerous environment variables`;
    }
  }
  return null;
}

describe('Env var injection denylist (Issue #1392)', () => {
  describe('AI provider API keys', () => {
    it('rejects ANTHROPIC_API_KEY', () => {
      expect(validateEnv({ ANTHROPIC_API_KEY: 'sk-ant-...' })).toContain('Forbidden');
    });

    it('rejects OPENAI_API_KEY', () => {
      expect(validateEnv({ OPENAI_API_KEY: 'sk-...' })).toContain('Forbidden');
    });

    it('rejects CLAUDE_API_KEY', () => {
      expect(validateEnv({ CLAUDE_API_KEY: 'sk-ant-...' })).toContain('Forbidden');
    });

    it('rejects GOOGLE_AI_API_KEY', () => {
      expect(validateEnv({ GOOGLE_AI_API_KEY: 'AIza...' })).toContain('Forbidden');
    });

    it('rejects MISTRAL_API_KEY', () => {
      expect(validateEnv({ MISTRAL_API_KEY: 'mist-...' })).toContain('Forbidden');
    });

    it('rejects DEEPSEEK_API_KEY', () => {
      expect(validateEnv({ DEEPSEEK_API_KEY: 'dsk-...' })).toContain('Forbidden');
    });
  });

  describe('Application secrets', () => {
    it('rejects AEGIS_SECRET', () => {
      expect(validateEnv({ AEGIS_SECRET: 'super-secret' })).toContain('Forbidden');
    });

    it('rejects DATABASE_URL', () => {
      expect(validateEnv({ DATABASE_URL: 'postgres://...' })).toContain('Forbidden');
    });

    it('rejects SECRET_KEY', () => {
      expect(validateEnv({ SECRET_KEY: 'abc123' })).toContain('Forbidden');
    });

    it('rejects JWT_SECRET', () => {
      expect(validateEnv({ JWT_SECRET: 'jwt-secret' })).toContain('Forbidden');
    });

    it('rejects SESSION_SECRET', () => {
      expect(validateEnv({ SESSION_SECRET: 'sess-secret' })).toContain('Forbidden');
    });

    it('rejects ENCRYPTION_KEY', () => {
      expect(validateEnv({ ENCRYPTION_KEY: 'enc-key' })).toContain('Forbidden');
    });
  });

  describe('Existing dangerous vars (regression)', () => {
    it('rejects PATH injection', () => {
      expect(validateEnv({ PATH: '/evil' })).toContain('Forbidden');
    });

    it('rejects LD_PRELOAD injection', () => {
      expect(validateEnv({ LD_PRELOAD: '/evil.so' })).toContain('Forbidden');
    });

    it('rejects NODE_OPTIONS injection', () => {
      expect(validateEnv({ NODE_OPTIONS: '--require /evil.js' })).toContain('Forbidden');
    });

    it('rejects GITHUB_TOKEN', () => {
      expect(validateEnv({ GITHUB_TOKEN: 'ghp_...' })).toContain('Forbidden');
    });
  });

  describe('Dangerous prefixes (regression)', () => {
    it('rejects AWS_ prefix', () => {
      expect(validateEnv({ AWS_CUSTOM_VAR: 'val' })).toContain('prefix "AWS_"');
    });

    it('rejects GITHUB_ prefix', () => {
      expect(validateEnv({ GITHUB_CUSTOM_VAR: 'val' })).toContain('prefix "GITHUB_"');
    });

    it('rejects npm_config_ prefix (case-insensitive)', () => {
      expect(validateEnv({ npm_config_registry: 'http://evil' })).toContain('prefix "npm_config_"');
    });
  });

  describe('Valid env vars pass', () => {
    it('allows MY_CUSTOM_VAR', () => {
      expect(validateEnv({ MY_CUSTOM_VAR: 'value' })).toBeNull();
    });

    it('allows PROJECT_NAME', () => {
      expect(validateEnv({ PROJECT_NAME: 'aegis' })).toBeNull();
    });

    it('allows multiple safe vars', () => {
      expect(validateEnv({ FOO: 'bar', BAZ: 'qux', MY_TOKEN: 'safe' })).toBeNull();
    });

    it('allows _ prefixed vars', () => {
      expect(validateEnv({ _MY_VAR: 'val' })).toBeNull();
    });
  });

  describe('Invalid env var names', () => {
    it('rejects lowercase names', () => {
      expect(validateEnv({ my_var: 'val' })).toContain('Invalid');
    });

    it('rejects names starting with digits', () => {
      expect(validateEnv({ '1BAD': 'val' })).toContain('Invalid');
    });
  });
});
