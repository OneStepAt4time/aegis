/**
 * detect-free-port.ts — Find a free TCP port starting from a preferred port.
 *
 * Used by `ag init` to find an available port for the Aegis server.
 * Tries the preferred port first, then increments up to maxPort.
 */

import { createServer } from 'node:net';

const DEFAULT_PREFERRED = 9100;
const DEFAULT_MAX = 9200;

/**
 * Detect the first free TCP port starting from `preferred`.
 * Returns the port number, or throws if no port is available in range.
 */
export async function detectFreePort(
  preferred: number = DEFAULT_PREFERRED,
  maxPort: number = DEFAULT_MAX,
): Promise<number> {
  const effectiveMax = Math.max(maxPort, preferred + 100);
  for (let port = preferred; port <= effectiveMax; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No free port found in range ${preferred}-${effectiveMax}`);
}

/**
 * Check if a specific port is available on 127.0.0.1.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}
