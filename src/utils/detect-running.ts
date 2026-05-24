/**
 * detect-running.ts — Check if an Aegis server is already running.
 *
 * Used by `ag init` to handle the re-run case:
 * - If a server is running, print the dashboard URL and exit with code 2.
 *
 * Uses Node.js http module — no external dependency on curl (Windows/Alpine safe).
 */

import http from 'node:http';

/**
 * Check if Aegis is already running by hitting the health endpoint.
 * Returns the dashboard URL if running, null otherwise.
 */
export function detectRunningInstance(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/health`,
      { timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.status === 'ok') {
              resolve(`http://127.0.0.1:${port}`);
              return;
            }
          } catch {
            // Not valid JSON
          }
          resolve(null);
        });
      },
    );

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}
