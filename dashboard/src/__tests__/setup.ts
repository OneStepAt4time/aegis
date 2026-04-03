import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mock EventSource for SSE tests (not available in jsdom)
if (typeof EventSource === 'undefined') {
  (global as any).EventSource = class EventSource {
    url: string;
    onmessage: ((event: any) => void) | null = null;
    onerror: ((event: any) => void) | null = null;
    onopen: ((event: any) => void) | null = null;

    constructor(url: string) {
      this.url = url;
    }

    addEventListener() {}
    removeEventListener() {}
    close() {}
  };
}

// Mock ResizeObserver (not available in jsdom)
if (typeof ResizeObserver === 'undefined') {
  (global as any).ResizeObserver = class ResizeObserver {
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Mock @xterm/xterm and @xterm/addon-fit for jsdom tests
// xterm.js requires canvas which jsdom doesn't support by default
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function(this: any) {
    Object.assign(this, {
      cols: 80,
      rows: 24,
      open: vi.fn(),
      write: vi.fn(),
      writeln: vi.fn(),
      reset: vi.fn(),
      dispose: vi.fn(),
      loadAddon: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
    });
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function(this: any) {
    Object.assign(this, {
      fit: vi.fn(),
    });
  }),
}));

// Mock ResilientWebSocket used by TerminalPassthrough
vi.mock('../../api/resilient-websocket', () => ({
  ResilientWebSocket: vi.fn(function(this: any) {
    Object.assign(this, {
      send: vi.fn(),
      close: vi.fn(),
    });
  }),
}));

// Warn if dashboard build artifacts are missing — CI may silently skip tests
// when dist/ doesn't exist and the test command exits 0 with no files found.
const distDir = resolve(__dirname, '../../dist');
if (!existsSync(distDir)) {
  console.warn(
    '\x1b[33m%s\x1b[0m',
    `[aegis-dashboard] No dist/ directory found. Run "npm run build" first if tests depend on built artifacts.\n`,
  );
}
