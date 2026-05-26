import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-unused-vars': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',

      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: "Avoid using 'shell: true' (command-injection risk). Use execFile/spawn with arg arrays instead.",
        },
      ],
    },
  },
  // no-console: error for production src/ — existing violators are excluded so CI stays green.
  // Goal: shrink this list over time by migrating to StructuredLogger.
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/__tests__/**',
      // Core infra — logger, CLI, startup bootstrap
      'src/cli.ts',
      'src/logger.ts',
      'src/startup.ts',
      'src/suppress.ts',
      'src/tracing.ts',
      // Hooks & permissions
      'src/hooks.ts',
      'src/hook.ts',
      'src/permission-guard.ts',
      'src/permission-request-manager.ts',
      // Sessions
      'src/session.ts',
      'src/session-discovery.ts',
      'src/session-transcripts.ts',
      // ACP
      'src/services/acp/backend.ts',
      'src/services/auth/AuthManager.ts',
      'src/services/state/JsonFileStore.ts',
      // Channels
      'src/channels/email.ts',
      'src/channels/manager.ts',
      'src/channels/slack.ts',
      'src/channels/telegram.ts',
      'src/channels/webhook.ts',
      // Server & config
      'src/server.ts',
      'src/config.ts',
      'src/events.ts',
      // Memory & learnings
      'src/memory-bridge-learning.ts',
      'src/memory-bridge.ts',
      'src/structured-learnings.ts',
      // Misc
      'src/file-utils.ts',
      'src/jsonl-watcher.ts',
      'src/mcp/server.ts',
      'src/question-manager.ts',
      'src/signal-cleanup-helper.ts',
      'src/template-store.ts',
      'src/transcript.ts',
      'src/webhook/verify.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['src/__tests__/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'prefer-const': 'off',
    },
  },
  eslintConfigPrettier,
];
