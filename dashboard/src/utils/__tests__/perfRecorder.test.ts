/**
 * perfRecorder.test.ts — Unit tests for the perf recorder singleton.
 *
 * These tests use a fresh instance via dynamic import + module reset
 * pattern, since the recorder is a module-level singleton that
 * installs on `window`. We don't pollute the global state between
 * tests; each test resets the singleton before asserting.
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('perfRecorder', () => {
  beforeEach(() => {
    // Each test starts with a clean recorder.
    // Importing twice would re-use the same module — the recorder
    // itself is a singleton, so we just reset it.
    return import('../perfRecorder').then((mod) => {
      mod.perfRecorder.reset();
    });
  });

  it('captures page-load samples per route with p50/p95/max', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    perfRecorder.recordPageLoad('/overview', 100, true);
    perfRecorder.recordPageLoad('/overview', 200, true);
    perfRecorder.recordPageLoad('/overview', 400, true);
    perfRecorder.recordPageLoad('/sessions', 50, false);

    const snap = perfRecorder.snapshot();
    expect(snap.pageLoadByRoute['/overview']?.count).toBe(3);
    // p50/p95 use nearest-rank floor on the sorted samples:
    //   p=0.5 of N=3 sorted [100,200,400] -> index floor(0.5*3)=1 -> 200
    //   p=0.95 of N=3 sorted [100,200,400] -> index floor(0.95*3)=2 -> 400
    expect(snap.pageLoadByRoute['/overview']?.p50Ms).toBe(200);
    expect(snap.pageLoadByRoute['/overview']?.p95Ms).toBe(400);
    expect(snap.pageLoadByRoute['/overview']?.maxMs).toBe(400);
    expect(snap.pageLoadByRoute['/sessions']?.count).toBe(1);
  });

  it('captures Web Vitals partial updates', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    perfRecorder.recordWebVitals({ fcpMs: 800 });
    perfRecorder.recordWebVitals({ lcpMs: 1200 });
    perfRecorder.recordWebVitals({ cls: 0.05 });
    expect(perfRecorder.snapshot().webVitals).toEqual({
      fcpMs: 800,
      lcpMs: 1200,
      cls: 0.05,
      longestEventDurationMs: null,
    });
  });

  it('tracks WebSocket open/close/reconnect counters per endpoint', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    perfRecorder.recordWsOpen('/v1/sessions/a/terminal');
    perfRecorder.recordWsReconnect('/v1/sessions/a/terminal', 1000);
    perfRecorder.recordWsClose('/v1/sessions/a/terminal');
    // The next open resolves the most recent pending reconnect delay.
    perfRecorder.recordWsReconnect('/v1/sessions/a/terminal', 2000);
    perfRecorder.recordWsOpen('/v1/sessions/a/terminal');

    const snap = perfRecorder.snapshot();
    const ep = snap.websocket['/v1/sessions/a/terminal'];
    expect(ep.opens.count).toBe(2);
    expect(ep.reconnects.count).toBe(2);
    expect(ep.closes.count).toBe(1);
    expect(ep.reconnects.totalDelayMs).toBe(3000);
    // lastReconnectResolvedMs tracks the delay that was just resolved by
    // the most recent open, so it is the 2000ms one.
    expect(ep.lastReconnectResolvedMs).toBe(2000);
  });

  it('tracks SSE open/reconnect/giveUp counters per endpoint', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    perfRecorder.recordSseOpen('/v1/events');
    perfRecorder.recordSseReconnect('/v1/events', 500);
    perfRecorder.recordSseClose('/v1/events');
    perfRecorder.recordSseReconnect('/v1/events', 1000);
    perfRecorder.recordSseGiveUp('/v1/events');

    const snap = perfRecorder.snapshot();
    const ep = snap.sse['/v1/events'];
    expect(ep.opens.count).toBe(1);
    expect(ep.reconnects.count).toBe(2);
    expect(ep.closes.count).toBe(1);
    expect(ep.giveUps.count).toBe(1);
  });

  it('computes sessionList p50/p95/max for SSE push and API refresh latencies', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    // Sorted values 10..100. Nearest-rank floor with N=10:
    //   p=0.5 -> index floor(0.5*10)=5 -> value 60
    //   p=0.95 -> index floor(0.95*10)=9 -> value 100
    [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].forEach((ms) => {
      perfRecorder.recordSsePushToRender(ms);
      perfRecorder.recordApiRefreshToRender(ms * 2);
    });
    const snap = perfRecorder.snapshot();
    expect(snap.sessionList.ssePushToRenderCount).toBe(10);
    expect(snap.sessionList.ssePushToRenderP50Ms).toBe(60);
    expect(snap.sessionList.ssePushToRenderP95Ms).toBe(100);
    expect(snap.sessionList.ssePushToRenderMaxMs).toBe(100);
    expect(snap.sessionList.apiRefreshToRenderP50Ms).toBe(120);
  });

  it('caps samples at 200 entries (ring buffer)', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    for (let i = 0; i < 250; i += 1) {
      perfRecorder.recordPageLoad('/x', i, true);
    }
    const snap = perfRecorder.snapshot();
    expect(snap.pageLoadByRoute['/x']?.count).toBe(250);
    // recentPageLoads is the public ring — 200 entries.
    expect(snap.recentPageLoads.length).toBe(200);
    expect(snap.recentPageLoads[0]?.ms).toBe(50); // first 50 dropped
  });

  it('exposes a snapshot via window.__aegisPerf__', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    perfRecorder.recordPageLoad('/test', 123, true);
    const w = window as unknown as { __aegisPerf__?: { snapshot(): unknown } };
    expect(w.__aegisPerf__).toBeDefined();
    const snap = (w.__aegisPerf__!.snapshot() as ReturnType<typeof perfRecorder.snapshot>);
    expect(snap.pageLoadByRoute['/test']?.count).toBe(1);
  });

  it('reset clears all state', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    perfRecorder.recordPageLoad('/x', 100, true);
    perfRecorder.recordSseOpen('/v1/events');
    perfRecorder.recordSsePushToRender(50);
    perfRecorder.reset();
    const snap = perfRecorder.snapshot();
    expect(Object.keys(snap.pageLoadByRoute)).toHaveLength(0);
    expect(Object.keys(snap.sse)).toHaveLength(0);
    expect(snap.sessionList.ssePushToRenderCount).toBe(0);
  });

  it('exposes _testInjectSsePush on window.__aegisPerf__ for the mock SSE producer rig (#4740)', async () => {
    const { perfRecorder } = await import('../perfRecorder');
    const w = window as unknown as { __aegisPerf__?: { _testInjectSsePush?(ms: number): void } };
    expect(w.__aegisPerf__?._testInjectSsePush).toBeDefined();
    w.__aegisPerf__!._testInjectSsePush!(75);
    w.__aegisPerf__!._testInjectSsePush!(125);
    w.__aegisPerf__!._testInjectSsePush!(200);
    const snap = perfRecorder.snapshot();
    expect(snap.sessionList.ssePushToRenderCount).toBe(3);
    expect(snap.sessionList.ssePushToRenderLastMs).toBe(200);
    expect(snap.sessionList.ssePushToRenderMaxMs).toBe(200);
  });
});
