import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { usePerfPageLoad } from '../usePerfPageLoad';
import { perfRecorder } from '../../utils/perfRecorder';

/**
 * This test verifies the page-load recording hook captures a small,
 * positive time value on the first sample.  Bug #3 (Argus review) was
 * that the first sample was a huge ~1.7e12 ms because the start time
 * was captured at app mount (via useRef) rather than inside the
 * effect.  This regression test catches that exact failure mode.
 */
describe('usePerfPageLoad', () => {
  beforeEach(() => {
    perfRecorder.reset();
  });

  afterEach(() => {
    perfRecorder.reset();
  });

  it('records a small positive page-load time on first mount', async () => {
    const TestApp = ({ path }: { path: string }) => {
      usePerfPageLoad(path);
      return <div data-testid="page">{path}</div>;
    };

    render(<TestApp path="/sessions" />);

    // Wait up to 500 ms for the double-rAF to fire.
    await waitFor(
      () => {
        const snap = perfRecorder.snapshot();
        const pl = snap.pageLoadByRoute['/sessions'];
        expect(pl).toBeTruthy();
        // The first sample must be small and positive (< 1 s).  A
        // buggy useRef-based implementation would yield ~1.7e12 ms.
        expect(pl!.lastMs).toBeGreaterThan(0);
        expect(pl!.lastMs).toBeLessThan(1000);
      },
      { timeout: 500 },
    );

    const snap = perfRecorder.snapshot();
    expect(snap.pageLoadByRoute['/sessions']!.count).toBe(1);
  });

  it('records per route change, not just first mount', async () => {
    const TestApp = ({ path }: { path: string }) => {
      usePerfPageLoad(path);
      return <div data-testid="page">{path}</div>;
    };

    const { rerender } = render(<TestApp path="/overview" />);
    await waitFor(
      () => {
        const snap = perfRecorder.snapshot();
        expect(snap.pageLoadByRoute['/overview']?.count ?? 0).toBe(1);
      },
      { timeout: 500 },
    );

    rerender(<TestApp path="/pipelines" />);
    await waitFor(
      () => {
        const snap = perfRecorder.snapshot();
        expect(snap.pageLoadByRoute['/pipelines']?.count ?? 0).toBe(1);
      },
      { timeout: 500 },
    );

    const snap = perfRecorder.snapshot();
    expect(snap.pageLoadByRoute['/overview']!.count).toBe(1);
    expect(snap.pageLoadByRoute['/pipelines']!.count).toBe(1);
  });
});
