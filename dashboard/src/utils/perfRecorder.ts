/**
 * perfRecorder.ts — In-memory performance recorder for the Aegis Dashboard.
 *
 * Purpose: capture the numbers the Endurance Test #4683 needs to verify the
 * "Dashboard <2s page load" / "WebSocket reconnects" / "session list
 * responsiveness" acceptance criteria. Everything is held in bounded
 * ring-buffers so a 4h+ run does not leak memory, and a JSON snapshot is
 * exposed for scraping via `window.__aegisPerf__`.
 *
 * The recorder is intentionally dependency-free and side-effect-free at
 * import time. Wire it in by calling the `recordX` methods from existing
 * call sites; the snapshot can be requested on demand.
 *
 * NOT a Prometheus exporter. NOT a network sink. The runner that owns
 * the test pulls `window.__aegisPerf__.snapshot()` and persists it.
 */

const MAX_SAMPLES = 200;

interface LatencyStat {
  count: number;
  lastMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  samples: number[];
}

interface CounterState {
  count: number;
  lastAt: number | null;
  totalDelayMs: number;
}

interface EndpointState {
  opens: CounterState;
  reconnects: CounterState;
  closes: CounterState;
  giveUps: CounterState;
  lastReconnectDelayMs: number | null;
  lastReconnectResolvedMs: number | null;
}

export interface PageLoadSample {
  route: string;
  ms: number;
  interactive: boolean;
  at: number;
}

export interface PerfSnapshot {
  uptimeMs: number;
  startedAt: number;
  pageLoadByRoute: Record<string, LatencyStat>;
  recentPageLoads: PageLoadSample[];
  webVitals: {
    fcpMs: number | null;
    lcpMs: number | null;
    cls: number | null;
    inpMs: number | null;
  };
  websocket: Record<string, EndpointState>;
  sse: Record<string, EndpointState>;
  sessionList: {
    ssePushToRenderCount: number;
    ssePushToRenderLastMs: number | null;
    ssePushToRenderP50Ms: number | null;
    ssePushToRenderP95Ms: number | null;
    ssePushToRenderMaxMs: number | null;
    apiRefreshToRenderCount: number;
    apiRefreshToRenderLastMs: number | null;
    apiRefreshToRenderP50Ms: number | null;
    apiRefreshToRenderP95Ms: number | null;
    apiRefreshToRenderMaxMs: number | null;
  };
  memory: { usedJsHeapMb: number | null; totalJsHeapMb: number | null } | null;
}

class PerfRecorder {
  private startedAt = Date.now();
  private pageLoadByRoute: Record<string, LatencyStat> = {};
  private recentPageLoads: PageLoadSample[] = [];
  private webVitals = { fcpMs: null as number | null, lcpMs: null as number | null, cls: null as number | null, inpMs: null as number | null };
  private websocket: Record<string, EndpointState> = {};
  private sse: Record<string, EndpointState> = {};
  private ssePushCount = 0;
  private apiRefreshCount = 0;
  private ssePushSamples: number[] = [];
  private apiRefreshSamples: number[] = [];
  private ssePushLastMs: number | null = null;
  private apiRefreshLastMs: number | null = null;

  /** Reset the start time. */
  init(): void {
    this.startedAt = Date.now();
  }

  recordPageLoad(route: string, ms: number, interactive: boolean): void {
    const stat = (this.pageLoadByRoute[route] ??= this.emptyLatency());
    stat.count += 1;
    stat.lastMs = ms;
    stat.samples.push(ms);
    if (stat.samples.length > MAX_SAMPLES) stat.samples.shift();
    stat.p50Ms = percentile(stat.samples, 0.5);
    stat.p95Ms = percentile(stat.samples, 0.95);
    stat.maxMs = Math.max(stat.maxMs ?? 0, ms);

    this.recentPageLoads.push({ route, ms, interactive, at: Date.now() });
    if (this.recentPageLoads.length > MAX_SAMPLES) this.recentPageLoads.shift();
  }

  recordWebVitals(partial: Partial<{ fcpMs: number; lcpMs: number; cls: number; inpMs: number }>): void {
    if (partial.fcpMs !== undefined) this.webVitals.fcpMs = partial.fcpMs;
    if (partial.lcpMs !== undefined) this.webVitals.lcpMs = partial.lcpMs;
    if (partial.cls !== undefined) this.webVitals.cls = partial.cls;
    if (partial.inpMs !== undefined) this.webVitals.inpMs = partial.inpMs;
  }

  recordWsOpen(endpoint: string): void {
    const ep = this.ensureEndpoint(this.websocket, endpoint);
    ep.opens.count += 1;
    ep.opens.lastAt = Date.now();
    if (ep.lastReconnectDelayMs !== null) {
      ep.lastReconnectResolvedMs = ep.lastReconnectDelayMs;
      ep.lastReconnectDelayMs = null;
    }
  }

  recordWsReconnect(endpoint: string, delayMs: number): void {
    const ep = this.ensureEndpoint(this.websocket, endpoint);
    ep.reconnects.count += 1;
    ep.reconnects.lastAt = Date.now();
    ep.reconnects.totalDelayMs += delayMs;
    ep.lastReconnectDelayMs = delayMs;
  }

  recordWsClose(endpoint: string): void {
    const ep = this.ensureEndpoint(this.websocket, endpoint);
    ep.closes.count += 1;
    ep.closes.lastAt = Date.now();
  }

  recordWsGiveUp(endpoint: string): void {
    const ep = this.ensureEndpoint(this.websocket, endpoint);
    ep.giveUps.count += 1;
    ep.giveUps.lastAt = Date.now();
  }

  recordSseOpen(endpoint: string): void {
    const ep = this.ensureEndpoint(this.sse, endpoint);
    ep.opens.count += 1;
    ep.opens.lastAt = Date.now();
    if (ep.lastReconnectDelayMs !== null) {
      ep.lastReconnectResolvedMs = ep.lastReconnectDelayMs;
      ep.lastReconnectDelayMs = null;
    }
  }

  recordSseReconnect(endpoint: string, delayMs: number): void {
    const ep = this.ensureEndpoint(this.sse, endpoint);
    ep.reconnects.count += 1;
    ep.reconnects.lastAt = Date.now();
    ep.reconnects.totalDelayMs += delayMs;
    ep.lastReconnectDelayMs = delayMs;
  }

  recordSseClose(endpoint: string): void {
    const ep = this.ensureEndpoint(this.sse, endpoint);
    ep.closes.count += 1;
    ep.closes.lastAt = Date.now();
  }

  recordSseGiveUp(endpoint: string): void {
    const ep = this.ensureEndpoint(this.sse, endpoint);
    ep.giveUps.count += 1;
    ep.giveUps.lastAt = Date.now();
  }

  recordSsePushToRender(ms: number): void {
    this.ssePushCount += 1;
    this.ssePushLastMs = ms;
    this.ssePushSamples.push(ms);
    if (this.ssePushSamples.length > MAX_SAMPLES) this.ssePushSamples.shift();
  }

  recordApiRefreshToRender(ms: number): void {
    this.apiRefreshCount += 1;
    this.apiRefreshLastMs = ms;
    this.apiRefreshSamples.push(ms);
    if (this.apiRefreshSamples.length > MAX_SAMPLES) this.apiRefreshSamples.shift();
  }

  snapshot(): PerfSnapshot {
    return {
      uptimeMs: Date.now() - this.startedAt,
      startedAt: this.startedAt,
      pageLoadByRoute: this.pageLoadByRoute,
      recentPageLoads: this.recentPageLoads.slice(),
      webVitals: { ...this.webVitals },
      websocket: this.websocket,
      sse: this.sse,
      sessionList: {
        ssePushToRenderCount: this.ssePushCount,
        ssePushToRenderLastMs: this.ssePushLastMs,
        ssePushToRenderP50Ms: percentile(this.ssePushSamples, 0.5),
        ssePushToRenderP95Ms: percentile(this.ssePushSamples, 0.95),
        ssePushToRenderMaxMs: this.ssePushSamples.length ? Math.max(...this.ssePushSamples) : null,
        apiRefreshToRenderCount: this.apiRefreshCount,
        apiRefreshToRenderLastMs: this.apiRefreshLastMs,
        apiRefreshToRenderP50Ms: percentile(this.apiRefreshSamples, 0.5),
        apiRefreshToRenderP95Ms: percentile(this.apiRefreshSamples, 0.95),
        apiRefreshToRenderMaxMs: this.apiRefreshSamples.length ? Math.max(...this.apiRefreshSamples) : null,
      },
      memory: readMemory(),
    };
  }

  /** Reset everything. Useful for unit tests; never called in production. */
  reset(): void {
    this.startedAt = Date.now();
    this.pageLoadByRoute = {};
    this.recentPageLoads = [];
    this.webVitals = { fcpMs: null, lcpMs: null, cls: null, inpMs: null };
    this.websocket = {};
    this.sse = {};
    this.ssePushCount = 0;
    this.apiRefreshCount = 0;
    this.ssePushSamples = [];
    this.apiRefreshSamples = [];
    this.ssePushLastMs = null;
    this.apiRefreshLastMs = null;
  }

  // --- internals ----------------------------------------------------------

  private emptyLatency(): LatencyStat {
    return { count: 0, lastMs: null, p50Ms: null, p95Ms: null, maxMs: null, samples: [] };
  }

  private ensureEndpoint(bucket: Record<string, EndpointState>, endpoint: string): EndpointState {
    return (bucket[endpoint] ??= {
      opens: { count: 0, lastAt: null, totalDelayMs: 0 },
      reconnects: { count: 0, lastAt: null, totalDelayMs: 0 },
      closes: { count: 0, lastAt: null, totalDelayMs: 0 },
      giveUps: { count: 0, lastAt: null, totalDelayMs: 0 },
      lastReconnectDelayMs: null,
      lastReconnectResolvedMs: null,
    });
  }
}

function percentile(sortedOrUnsortedSamples: number[], p: number): number | null {
  if (sortedOrUnsortedSamples.length === 0) return null;
  const sorted = [...sortedOrUnsortedSamples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

function readMemory(): { usedJsHeapMb: number | null; totalJsHeapMb: number | null } | null {
  // `performance.memory` is a Chromium-only extension; treat absence as null
  // rather than a hard error so other browsers are tolerated.
  const perfAny = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } };
  if (!perfAny.memory) return null;
  return {
    usedJsHeapMb: Math.round((perfAny.memory.usedJSHeapSize / (1024 * 1024)) * 10) / 10,
    totalJsHeapMb: Math.round((perfAny.memory.totalJSHeapSize / (1024 * 1024)) * 10) / 10,
  };
}

/** Singleton — the rest of the app should import this directly. */
export const perfRecorder = new PerfRecorder();

// Expose for scraping by the test runner. Intentionally read-only.
if (typeof window !== 'undefined') {
  (window as unknown as { __aegisPerf__?: unknown }).__aegisPerf__ = {
    snapshot: () => perfRecorder.snapshot(),
    reset: () => perfRecorder.reset(),
  };
}
