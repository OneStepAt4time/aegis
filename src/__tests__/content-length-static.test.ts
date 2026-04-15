import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

// Module-level mock for TmuxManager to avoid prototype spy issues and ensure
// the test imports the mocked class before server initialization.
vi.mock('../tmux.js', () => {
  // Lightweight, type-safe Mock TmuxManager that uses closure state
  // to avoid touching real private properties on the real TmuxManager.
  const stateFor = new WeakMap();
  function initState(self, sessionName = 'aegis') {
    const state = {
      sessionName,
      ready: false,
      nextId: 1,
      windows: new Map(),
    };
    // placeholder bridge window
    state.windows.set('_bridge_main', {
      windowId: '@0',
      windowName: '_bridge_main',
      cwd: process.cwd(),
      paneCommand: 'bash',
      paneText: '',
      paneDead: false,
      panePid: 9000,
    });
    stateFor.set(self, state);
  }
  function st(self) { return stateFor.get(self); }

  return {
    TmuxManager: class {
      constructor(sessionName = 'aegis') {
        // store instance-local state in closure, not as public/private fields
        initState(this, sessionName);
      }

      async ensureSession() {
        const s = st(this);
        if (s.ready) return;
        s.ready = true;
        if (!s.windows.has('_bridge_main')) {
          s.windows.set('_bridge_main', {
            windowId: '@0', windowName: '_bridge_main', cwd: process.cwd(), paneCommand: 'bash', paneText: '', paneDead: false, panePid: 9000,
          });
        }
      }

      async listWindows() {
        const s = st(this);
        if (!s.ready) throw new Error('no server running');
        return [...s.windows.values()].map(w => ({ windowId: w.windowId, windowName: w.windowName, cwd: w.cwd, paneCommand: w.paneCommand, paneDead: w.paneDead }));
      }

      async createWindow(opts) {
        const s = st(this);
        const base = opts.windowName || `win-${s.nextId}`;
        let name = base;
        let counter = 2;
        while (s.windows.has(name)) name = `${base}-${counter++}`;
        const id = `@${s.nextId++}`;
        s.windows.set(name, { windowId: id, windowName: name, cwd: opts.workDir || process.cwd(), paneCommand: 'bash', paneText: '', paneDead: false, panePid: 9000 + s.nextId });
        return { windowId: id, windowName: name };
      }

      async capturePane(windowId) {
        const s = st(this);
        const win = [...s.windows.values()].find(w => w.windowId === windowId || w.windowName === windowId);
        return win?.paneText ?? '';
      }
      async capturePaneDirect(windowId) { return this.capturePane(windowId); }

      async listPanePid(windowId) {
        const s = st(this);
        const win = [...s.windows.values()].find(w => w.windowId === windowId || w.windowName === windowId);
        return win ? Number(win.panePid) : null;
      }

      isPidAlive(pid) { return Number.isFinite(pid) && pid > 0; }

      async sendKeys(windowId, text, enter = true) {
        const s = st(this);
        const win = [...s.windows.values()].find(w => w.windowId === windowId || w.windowName === windowId);
        if (!win) throw new Error(`can't find window: ${windowId}`);
        const sendText = text.replace(/^!/, '');
        win.paneText = `${win.paneText}${sendText}`;
        if (sendText.includes('claude') || sendText.includes('--session-id') || sendText.includes('--resume')) {
          win.paneCommand = 'claude';
          win.paneText = '✻ Working…';
        }
        if (enter) {
          win.paneCommand = 'claude';
          win.paneText = '✻ Working…';
        }
      }

      async sendKeysVerified(windowId, text) { await this.sendKeys(windowId, text, true); return { delivered: true, attempts: 1 }; }

      async listPanes(target) { const s = st(this); const win = [...s.windows.values()].find(w => w.windowId === target || w.windowName === target); return win ? String(win.panePid) : ''; }

      async killWindow(windowId) { const s = st(this); const entry = [...s.windows.entries()].find(([k,v]) => v.windowId === windowId || v.windowName === windowId); if (entry) s.windows.delete(entry[0]); }

      async killSession() { const s = st(this); s.ready = false; s.windows.clear(); }

      async getWindowHealth(windowId) {
        const s = st(this);
        const win = [...s.windows.values()].find(w => w.windowId === windowId || w.windowName === windowId);
        if (!win) return { windowExists: false, paneCommand: null, claudeRunning: false, paneDead: false };
        const paneCmd = (win.paneCommand || '').toLowerCase();
        const claudeRunning = paneCmd === 'claude' || paneCmd === 'node';
        return { windowExists: true, paneCommand: win.paneCommand, claudeRunning, paneDead: !!win.paneDead };
      }

      async isServerHealthy() { return { healthy: true, error: null }; }
      isTmuxServerError(error) { return false; }

      async sendSpecialKey(windowId, key) {
        const s = st(this);
        const win = [...s.windows.values()].find(w => w.windowId === windowId || w.windowName === windowId);
        if (!win) throw new Error(`can't find window: ${windowId}`);
        if (key === 'C-c') { win.paneText = `sent:${key}`; win.paneCommand = 'bash'; }
        if (key === 'Escape') { win.paneText = `sent:${key}`; }
        return { success: true };
      }
    }
  }));

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
