import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'dist', 'dashboard/**', '.worktrees/**', '.claude/worktrees/**', '.claude-internals/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Coverage threshold floor — enforced by vitest on every CI run.
      // Prevents regression below current baseline (#2636).
      // ROADMAP target is 65% for all metrics; raise thresholds as coverage improves.
      thresholds: { lines: 65, branches: 60, functions: 65 },
    },
  },
});
