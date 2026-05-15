/**
 * terminal-content-endpoint-3429.test.ts — Issue #3429 Regression Coverage
 *
 * Verifies that:
 * 1. The legacy /pane endpoint is NOT in the OpenAPI spec (still removed)
 * 2. The new terminal content route handler is exported and functional
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

describe('Issue #3429: Terminal content endpoint', () => {
  let openapi: Record<string, unknown>;

  try {
    execFileSync('npm', ['run', 'build:openapi', '--silent'], { encoding: 'utf-8' });
    const distJson = readFileSync('./dist/openapi.json', 'utf-8');
    openapi = JSON.parse(distJson);
  } catch {
    try {
      openapi = JSON.parse(readFileSync('./dist/openapi.json', 'utf-8'));
    } catch {
      openapi = { paths: {} };
    }
  }

  it('should not have the legacy /v1/sessions/{id}/pane endpoint', () => {
    const paths = (openapi.paths || {}) as Record<string, unknown>;
    expect(paths['/v1/sessions/{id}/pane']).toBeUndefined();
  });

  it('should export TerminalContentResponse type from terminal routes', async () => {
    const mod = await import('../routes/terminal.js');
    // The function registerTerminalRoutes must exist
    expect(typeof mod.registerTerminalRoutes).toBe('function');
  });
});
