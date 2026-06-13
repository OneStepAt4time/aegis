/**
 * feat-3544-passthrough.test.ts
 *
 * Issue #3544: --passthrough CLI flag should pass permissionMode='bypassPermissions'
 * to POST /v1/sessions in both `ag run` and `ag create`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';

// ── Helpers ──

function createMockIO() {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  return {
    io: {
      stdin: { on: vi.fn(), resume: vi.fn() } as unknown as NodeJS.ReadableStream,
      stdout: { write: (t: string) => { stdoutChunks.push(t); } } as unknown as NodeJS.WritableStream,
      stderr: { write: (t: string) => { stderrChunks.push(t); } } as unknown as NodeJS.WritableStream,
    },
    getStdout: () => stdoutChunks.join(''),
    getStderr: () => stderrChunks.join(''),
  };
}

// ── Unit tests for flag parsing ──

describe('Issue #3544: --passthrough flag', () => {
  describe('run.ts flag parsing', () => {
    it('--passthrough should be recognized in acceptPerms check', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const source = fs.readFileSync(
        path.join(import.meta.dirname ?? __dirname, '..', 'commands', 'run.ts'),
        'utf-8',
      );
      // Verify the line that sets acceptPerms includes --passthrough
      expect(source).toMatch(/args\.includes\(['"]--passthrough['"]\)/);
      // Verify permissionMode: 'bypassPermissions' is used when acceptPerms is true
      expect(source).toMatch(/permissionMode:\s*['"]bypassPermissions['"]/);
    });

    it('run.ts help text mentions --passthrough', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const source = fs.readFileSync(
        path.join(import.meta.dirname ?? __dirname, '..', 'commands', 'run.ts'),
        'utf-8',
      );
      expect(source).toMatch(/--passthrough/);
    });
  });

  describe('cli.ts handleCreate flag parsing', () => {
    it('--passthrough should be recognized in acceptPerms check in handleCreate', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const source = fs.readFileSync(
        path.join(import.meta.dirname ?? __dirname, '..', 'commands', 'create.ts'),
        'utf-8',
      );
      expect(source).toMatch(/args\.includes\(['"]--passthrough['"]\)/);
    });

    it('cli.ts help text mentions --passthrough', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const source = fs.readFileSync(
        path.join(import.meta.dirname ?? __dirname, '..', 'cli.ts'),
        'utf-8',
      );
      // Help text should document --passthrough
      const helpSection = source.match(/Create:[\s\S]*?Doctor:/)?.[0] ?? '';
      expect(helpSection).toContain('--passthrough');
    });
  });

  describe('cli.ts handleCreate --passthrough behavior via mocked fetch', () => {
    let originalFetch: typeof globalThis.fetch;
    let fetchCalls: Array<{ url: string; options?: RequestInit }>;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchCalls = [];
      globalThis.fetch = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        fetchCalls.push({ url: urlStr, options });

        if (urlStr.includes('/v1/sessions/stats')) {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (urlStr.includes('/v1/sessions') && options?.method === 'POST') {
          return new Response(JSON.stringify({
            id: 'test-session-id',
            displayName: 'test-session',
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (urlStr.includes('/send')) {
          return new Response(JSON.stringify({ delivered: true, attempts: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('handleCreate sends permissionMode=bypassPermissions when --passthrough is set', async () => {
      const { runCli } = await import('../cli.js');
      const { io } = createMockIO();
      await runCli(['create', 'test brief', '--passthrough'], io);

      const postCall = fetchCalls.find(c => c.url.includes('/v1/sessions') && c.options?.method === 'POST');
      expect(postCall).toBeDefined();

      const body = JSON.parse(postCall!.options!.body as string);
      expect(body.permissionMode).toBe('bypassPermissions');
    });

    it('handleCreate does NOT send permissionMode when --passthrough is absent', async () => {
      const { runCli } = await import('../cli.js');
      const { io } = createMockIO();
      await runCli(['create', 'test brief'], io);

      const postCall = fetchCalls.find(c => c.url.includes('/v1/sessions') && c.options?.method === 'POST');
      expect(postCall).toBeDefined();

      const body = JSON.parse(postCall!.options!.body as string);
      expect(body.permissionMode).toBeUndefined();
    });
  });
});
