import { vi } from 'vitest';

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
    constructor() {}
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


// Safe useT mock: resolves i18n keys using the English catalog.
// Returns a stable function reference to avoid re-render loops.
vi.mock('../i18n/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../i18n/context')>();
  let enObj: any = {};
  try {
    const mod = await vi.importActual<typeof import('../i18n/en')>('../i18n/en');
    enObj = (mod as any).en || (mod as any).default || mod;
  } catch {
    // Fallback: empty catalog
  }

  const catalog: Record<string, string> = {};
  const flatten = (obj: any, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? prefix + '.' + k : k;
      if (typeof v === 'string') catalog[key] = v;
      else if (typeof v === 'object' && v !== null) flatten(v, key);
    }
  };
  flatten(enObj, '');

  const stableT = (key: string, params?: Record<string, string | number>): string => {
    let val = catalog[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return val;
  };

  return {
    ...actual,
    useT: () => stableT,
    I18nProvider: actual.I18nProvider,
  };
});
