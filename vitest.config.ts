import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      'dist',
      'dashboard/**',
      // Worktree directories contain duplicate source/test files. In CI only
      // the root source is tested, but local runs pick up worktree copies.
      // Exclude all wt-* directories to prevent:
      // 1. Dashboard tests running in Node env ("document is not defined")
      // 2. Temp file collisions in AuthManager tests under parallel execution
      'wt-*/**',
      '.worktrees/**',
      '.claude/worktrees/**',
      '.claude-internals/**',
    ],
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
