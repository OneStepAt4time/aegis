/**
 * acp-remove-tmux-rest-endpoints-2605.test.ts — ACP-062 Regression Coverage
 *
 * Verifies that tmux-specific REST endpoints (pane, bash, discover-commands)
 * have been permanently removed from the public API contract.
 * These endpoints are no longer available after the M5 runtime cutover.
 *
 * Related issue: ACP-062 (#2605)
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

describe('ACP-062: Remove tmux-specific REST endpoints', () => {
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

  it('should not have /v1/sessions/{id}/pane endpoint in OpenAPI spec', () => {
    const paths = (openapi.paths || {}) as Record<string, unknown>;
    expect(paths['/v1/sessions/{id}/pane']).toBeUndefined();
  });

  it('should not have /v1/sessions/{id}/bash endpoint in OpenAPI spec', () => {
    const paths = (openapi.paths || {}) as Record<string, unknown>;
    expect(paths['/v1/sessions/{id}/bash']).toBeUndefined();
  });

  it('should not have discover-commands endpoint in OpenAPI spec', () => {
    const paths = (openapi.paths || {}) as Record<string, unknown>;
    expect(paths['/v1/sessions/{id}/discover-commands']).toBeUndefined();
  });

  it('should still have /command endpoint (slash command, not tmux-specific)', () => {
    const paths = (openapi.paths || {}) as Record<string, unknown>;
    expect(paths['/v1/sessions/{id}/command']).toBeDefined();
  });

  it('should still have /summary endpoint (session summary, not tmux-specific)', () => {
    const paths = (openapi.paths || {}) as Record<string, unknown>;
    expect(paths['/v1/sessions/{id}/summary']).toBeDefined();
  });
});
