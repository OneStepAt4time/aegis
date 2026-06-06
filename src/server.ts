/**
 * server.ts — Aegis server entry point.
 *
 * Per Issue #4227, the server bootstrap (HTTP server setup, service wiring, route
 * registration, main() function) has been extracted to ./server-bootstrap.ts. This file
 * is now a thin entry point that imports main() and invokes it when run as the main
 * module.
 *
 * Extraction acceptance criteria (per Ema's spec):
 *   - No behavior change
 *   - Existing test suite (224 files / 2252 tests baseline) passes unchanged
 *   - No edits in extracted files (src/routes/*.ts) beyond imports
 *   - One PR with diff stat showing extraction only
 */

// Type declaration for the cross-module pid-path handoff between
// server-bootstrap.ts (which calls acquirePidLock) and server.ts (which
// removes the pid file on startup failure).
declare global {
  // eslint-disable-next-line no-var
  var __startupPidPath__: string | undefined;
}

import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { logger } from './logger.js';
import { removePidFile } from './startup.js';
import { main } from './server-bootstrap.js';

// Re-exports — preserve the public API surface that tests and external imports
// depend on. The implementations now live in server-bootstrap.ts.
export { main } from './server-bootstrap.js';
// Preserve public export used by tests and external imports.
export { readParentPid as readPpid } from './process-utils.js';

const isMainModule = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main().catch((err: unknown) => {
    if (typeof globalThis.__startupPidPath__ === 'string' && globalThis.__startupPidPath__) {
      removePidFile(globalThis.__startupPidPath__);
    }
    logger.error({
      component: 'server',
      operation: 'startup_failed',
      errorCode: 'STARTUP_FAILED',
      attributes: { error: err instanceof Error ? err.message : String(err) },
    });
    process.exit(1);
  });
}
