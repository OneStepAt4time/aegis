import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules', 'dist', 'dashboard/**', '.worktrees/**', '.claude-internals/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 70, branches: 60, functions: 70, statements: 70 },
      exclude: [
        'src/startup.ts',
        'src/verification.ts',
        'src/screenshot.ts',
        'src/channels/email.ts',
        'src/channels/telegram.ts',
        'src/channels/slack.ts',
        'src/channels/index.ts',
        'src/__tests__/**',
      ],
    },
  },
});
