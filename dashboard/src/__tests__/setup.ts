import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Warn if dashboard build artifacts are missing — CI may silently skip tests
// when dist/ doesn't exist and the test command exits 0 with no files found.
const distDir = resolve(import.meta.dirname, '../../dist');
if (!existsSync(distDir)) {
  console.warn(
    '\x1b[33m%s\x1b[0m',
    `[aegis-dashboard] No dist/ directory found. Run "npm run build" first if tests depend on built artifacts.\n`,
  );
}
