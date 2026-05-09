import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../cli.js';

class CaptureStream extends Writable {
  private chunks: string[] = [];

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf-8'));
    callback();
  }

  text(): string {
    return this.chunks.join('');
  }
}

function createMockFetch(): typeof fetch {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (!init?.headers || !(init.headers as Record<string, string>).Authorization) {
      throw new Error(`missing auth header for ${url}`);
    }

    if (url.endsWith('/v1/sessions')) {
      return new Response(JSON.stringify({ id: 'abc123', displayName: 'cc-test-brief' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.endsWith('/v1/sessions/abc123/send')) {
      return new Response(JSON.stringify({ delivered: true, attempts: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`unexpected url: ${url}`);
  }) as unknown as typeof fetch;
}

describe('ag create output', () => {
  let originalCwd: string;
  let originalEnv: NodeJS.ProcessEnv;
  let workDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalEnv = { ...process.env };
    workDir = mkdtempSync(join(tmpdir(), 'aegis-cli-create-'));
    process.chdir(workDir);
    process.env = {
      ...process.env,
      AEGIS_AUTH_TOKEN: 'test-token',
      AEGIS_BASE_URL: 'http://127.0.0.1:9100',
      AEGIS_STATE_DIR: join(workDir, 'state'),
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    rmSync(workDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('includes auth headers in the next-step curl commands when auth is configured', async () => {
    vi.stubGlobal('fetch', createMockFetch());

    const stdin = new PassThrough();
    const stdout = new CaptureStream();
    const stderr = new CaptureStream();
    const runPromise = runCli(['create', 'test brief', '--cwd', workDir], { stdin, stdout, stderr });
    setImmediate(() => stdin.end());

    const code = await runPromise;

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('Next steps:');
    expect(stdout.text()).toContain('Authorization: Bearer $TOKEN');
    expect(stdout.text()).toContain('curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9100/v1/sessions/abc123/health');
    expect(stdout.text()).toContain('curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:9100/v1/sessions/abc123/read');
    expect(stdout.text()).toContain('curl -H "Authorization: Bearer $TOKEN" -X DELETE http://127.0.0.1:9100/v1/sessions/abc123');
  });
});
