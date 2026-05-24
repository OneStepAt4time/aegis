/**
 * detect-running.ts — Check if an Aegis server is already running.
 *
 * Used by `ag init` to handle the re-run case:
 * - If a server is running, print the dashboard URL and exit with code 2.
 */

import { execFileSync } from 'node:child_process';
import { getErrorMessage } from '../validation.js';

/**
 * Check if Aegis is already running by hitting the health endpoint.
 * Returns the dashboard URL if running, null otherwise.
 */
export function detectRunningInstance(port: number): string | null {
  try {
    const result = execFileSync('curl', ['-sS', '--max-time', '2', `http://127.0.0.1:${port}/health`], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const parsed = JSON.parse(result);
    if (parsed.status === 'ok') {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // Not running or health check failed
  }
  return null;
}
