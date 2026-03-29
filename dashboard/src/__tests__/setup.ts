import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Warn if dashboard build artifacts are missing — CI may silently skip tests
// when dist/ doesn't exist and the test command exits 0 with no files found.
const distDir = resolve(__dirname, '../../dist');
if (!existsSync(distDir)) {
  console.warn(
    '\x1b[33m%s\x1b[0m',
    `[aegis-dashboard] No dist/ directory found. Run "npm run build" first if tests depend on built artifacts.\n`,
  );
}
