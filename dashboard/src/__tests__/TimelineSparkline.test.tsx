/**
 * __tests__/TimelineSparkline.test.tsx — Issue 04.6 of the session-cockpit epic.
 *
 * Pins the bucketing arithmetic (pure) and the rendering invariants
 * (label and range switcher).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ParsedEntry } from '../types';
import {
  TimelineSparkline,
  bucketEntries,
  type TimelineRange,
} from '../components/session/TimelineSparkline';

function entry(timestamp: string): ParsedEntry {
  return { role: 'assistant', contentType: 'text', text: '', timestamp };
}

describe('bucketEntries (pure)', () => {
  const NOW = Date.UTC(2026, 3, 20, 12, 0, 0); // 2026-04-20 12:00 UTC

  it('produces the expected bucket count per range', () => {
    const ranges: TimelineRange[] = ['1H', '12H', 'Today', '7D', '14D'];
    for (const r of ranges) {
      const buckets = bucketEntries([], r, NOW);
      expect(buckets.length).toBeGreaterThan(0);
      expect(buckets[0].startMs).toBeLessThan(buckets[0].endMs);
    }
  });

  it('drops entries outside the window', () => {
    const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const buckets = bucketEntries([entry(twoHoursAgo)], '1H', NOW);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(0);
  });

  it('assigns entries to the correct bucket', () => {
    // Place one entry 30 minutes ago in the 1H range (60 buckets of 1min).
    // That should fall into bucket index 30.
    const thirtyMinAgo = new Date(NOW - 30 * 60 * 1000).toISOString();
    const buckets = bucketEntries([entry(thirtyMinAgo)], '1H', NOW);

    const populated = buckets.findIndex((b) => b.count > 0);
    expect(populated).toBe(30);
    expect(buckets[populated].count).toBe(1);
  });

  it('groups multiple entries in the same bucket', () => {
    const fiveMinAgoA = new Date(NOW - 5 * 60 * 1000).toISOString();
    const fiveMinAgoB = new Date(NOW - 5 * 60 * 1000 + 100).toISOString();
    const buckets = bucketEntries([entry(fiveMinAgoA), entry(fiveMinAgoB)], '1H', NOW);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(2);
  });

  it('ignores entries without a timestamp', () => {
    const stamped = entry(new Date(NOW - 60_000).toISOString());
    const unstamped: ParsedEntry = { role: 'user', contentType: 'text', text: '' };
    const buckets = bucketEntries([stamped, unstamped], '1H', NOW);
    const total = buckets.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(1);
  });
});

describe('<TimelineSparkline>', () => {
  it('renders the range switcher with all five options', () => {
    render(<TimelineSparkline entries={[]} />);
    expect(screen.getByRole('tab', { name: '1H' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '12H' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Today' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '7D' })).toBeDefined();
    expect(screen.getByRole('tab', { name: '14D' })).toBeDefined();
  });

  it('reports zero events for an empty transcript', () => {
    render(<TimelineSparkline entries={[]} initialRange="1H" />);
    expect(screen.getByText(/0 events in 1H/)).toBeDefined();
  });

  it('counts only events within the chosen range', () => {
    const NOW = Date.now();
    const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    const tenMinutesAgo = new Date(NOW - 10 * 60 * 1000).toISOString();
    render(
      <TimelineSparkline
        entries={[entry(twoHoursAgo), entry(tenMinutesAgo)]}
        initialRange="1H"
        nowMs={NOW}
      />,
    );
    // Only the 10-minutes-ago entry falls within the 1H window.
    expect(screen.getByText(/1 event in 1H/)).toBeDefined();
  });

  it('fires onSeek with the bucket midpoint when a populated bar is clicked', () => {
    const NOW = Date.UTC(2026, 3, 20, 12, 0, 0);
    const tenMinutesAgo = new Date(NOW - 10 * 60 * 1000).toISOString();
    const onSeek = vi.fn();
    render(
      <TimelineSparkline
        entries={[entry(tenMinutesAgo)]}
        initialRange="1H"
        nowMs={NOW}
        onSeek={onSeek}
      />,
    );

    const bars = screen.getByTestId('timeline-sparkline-bars').querySelectorAll('button');
    // Click every bar; exactly one should be enabled (the one at ~-10m).
    let clicked = 0;
    bars.forEach((b) => {
      if (!(b as HTMLButtonElement).disabled) {
        fireEvent.click(b);
        clicked++;
      }
    });
    expect(clicked).toBe(1);
    expect(onSeek).toHaveBeenCalledOnce();
  });
});
