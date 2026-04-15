import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

import { createMockTmuxManager } from './helpers/mock-tmux';
// Module-level mock for TmuxManager to avoid prototype spy issues and ensure
// the test imports the mocked class before server initialization.
vi.mock('../tmux.js', () => {
  return {
    TmuxManager: class {
      constructor() {
        const m = createMockTmuxManager(); return { ...m, ensureSession: async () => {} };
      }
    }
  };
});

const sandboxRoot = join(process.cwd(), '.test-scratch', `content-length-static-${crypto.randomUUID()}`);
const stateDir = join(sandboxRoot, 'state');
const projectsDir = join(sandboxRoot, 'projects');

let capturedApp: FastifyInstance | null = null;
const dashboardDir = join(process.cwd(), 'src', 'dashboard');

vi.mock('../startup.js', () => ({
  listenWithRetry: vi.fn(async (app: FastifyInstance) => {
    capturedApp = app;
    await app.ready();
  }),
  writePidFile: vi.fn(async () => join(stateDir, 'aegis.pid')),
  removePidFile: vi.fn(),
}));

beforeAll(async () => {
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(dashboardDir, { recursive: true });

  // Create deterministic static assets for the test (do NOT commit these files)
  writeFileSync(join(dashboardDir, 'index.html'), '<html><body>index</body></html>', 'utf8');
  writeFileSync(join(dashboardDir, 'asset.txt'), 'hello world\n', 'utf8');

  process.env.AEGIS_STATE_DIR = stateDir;
  process.env.AEGIS_CLAUDE_PROJECTS_DIR = projectsDir;
  process.env.AEGIS_PORT = '19102';
  process.env.AEGIS_HOST = '127.0.0.1';

  // TmuxManager is mocked at module level above; no per-test spy required.

  await import('../server.js');

  for (let i = 0; i < 200 && !capturedApp; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!capturedApp) throw new Error('server app not captured');
});

afterAll(async () => {
  await capturedApp?.close();
  // cleanup files
  try { unlinkSync(join(dashboardDir, 'index.html')); } catch {}
  try { unlinkSync(join(dashboardDir, 'asset.txt')); } catch {}
  rmSync(sandboxRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('Content-Length correctness (static assets)', () => {
  it('returns correct Content-Length for index.html and asset.txt', async () => {
    const app = capturedApp as FastifyInstance;

    const resIndex = await app.inject({ method: 'GET', url: '/dashboard/index.html' });
    expect(resIndex.statusCode).toBe(200);
    expect(Number(resIndex.headers['content-length'])).toBe(Buffer.byteLength(resIndex.body, 'utf8'));

    const resAsset = await app.inject({ method: 'GET', url: '/dashboard/asset.txt' });
    expect(resAsset.statusCode).toBe(200);
    expect(Number(resAsset.headers['content-length'])).toBe(Buffer.byteLength(resAsset.body, 'utf8'));
  });
});