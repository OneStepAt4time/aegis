
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


// Mock window.matchMedia (not available in jsdom / Node 20)
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Mock HTMLElement.offsetParent — jsdom throws on detached elements.
// Override to always return body for focus-trap tests.
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  get() { return document.body; },
  configurable: true,
});
// Mock ResizeObserver (not available in jsdom)
if (typeof ResizeObserver === 'undefined') {
  (global as any).ResizeObserver = class ResizeObserver {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

