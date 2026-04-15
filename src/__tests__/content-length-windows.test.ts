import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { TmuxManager } from '../tmux.js';

const sandboxRoot = join(process.cwd(), '.test-scratch', `content-length-${crypto.randomUUID()}`);
const stateDir = join(sandboxRoot, 'state');
const projectsDir = join(sandboxRoot, 'projects');
const workDir = join(sandboxRoot, 'workdir');

let capturedApp: FastifyInstance | null = null;

vi.mock('../startup.js', () => ({
  listenWithRetry: vi.fn(async (app: FastifyInstance) => {
    capturedApp = app;
    await app.ready();
  }),
  writePidFile: vi.fn(async () => join(stateDir, 'aegis.pid')),
  removePidFile: vi.fn(),
}));

beforeAll(async () => {
  mkdirSync(workDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });

  process.env.AEGIS_STATE_DIR = stateDir;
  process.env.AEGIS_CLAUDE_PROJECTS_DIR = projectsDir;
  process.env.AEGIS_PORT = '19101';
  process.env.AEGIS_HOST = '127.0.0.1';

  // Minimal tmux stubs so server can initialize without real tmux
  vi.spyOn(TmuxManager.prototype as any, 'tmuxInternal').mockImplementation(async () => '');
  vi.spyOn(TmuxManager.prototype as any, 'tmuxShellBatch').mockImplementation(async () => undefined);

  await import('../server.js');

  for (let i = 0; i < 200 && !capturedApp; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!capturedApp) throw new Error('server app not captured');
});

afterAll(async () => {
  await capturedApp?.close();
  vi.restoreAllMocks();
  rmSync(sandboxRoot, { recursive: true, force: true });
});

describe('Content-Length correctness', () => {
  it('responds with Content-Length equal to actual byte length for dashboard index.html', async () => {
    const app = capturedApp as FastifyInstance;
    const res = await app.inject({ method: 'GET', url: '/dashboard/index.html' });
    expect(res.statusCode).toBe(200);
    const header = res.headers['content-length'];
    const body = res.body;
    // header may be string; compute actual byte length
    const actual = Buffer.byteLength(body, 'utf8');
    expect(Number(header)).toBe(actual);
  });
});
