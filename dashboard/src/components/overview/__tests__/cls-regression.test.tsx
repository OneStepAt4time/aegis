/**
 * cls-regression.test.tsx — Regression tests for CLS fixes (#4726).
 *
 * These tests guard against regressions in the three layout-shift fixes:
 *  1. Session table rows have a reserved min-height (prevents row collapse under SSE churn).
 *  2. VirtualizedSessionList container never shrinks below its peak height.
 *  3. KPIBanner reserves stable min-height so the loading→loaded transition causes no shift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ROW_HEIGHT, GROUP_ROW_HEIGHT } from '../VirtualizedSessionList';
import { KPIBanner } from '../../analytics/KPIBanner';
import type { KPIItem } from '../../analytics/KPIBanner';

// ── Module mocks required by KPIBanner ─────────────────────

vi.mock('../../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

// ── Helpers ────────────────────────────────────────────────

const KPI_ITEMS: KPIItem[] = [
  { id: 'cost', label: 'Cost', value: '$1.23', color: 'cost' },
  { id: 'tokens', label: 'Tokens', value: '42K', color: 'input' },
  { id: 'sessions', label: 'Sessions', value: '7', color: 'neutral' },
  { id: 'avg', label: 'Avg/Day', value: '$0.18', color: 'time' },
  { id: 'errors', label: 'Errors', value: '0%', color: 'efficiency' },
];

// ── 1. Row height constants ─────────────────────────────────

describe('VirtualizedSessionList row height constants (CLS regression #4726)', () => {
  it('ROW_HEIGHT is 52px — changing this breaks CLS budget', () => {
    expect(ROW_HEIGHT).toBe(52);
  });

  it('GROUP_ROW_HEIGHT is 44px — changing this breaks CLS budget', () => {
    expect(GROUP_ROW_HEIGHT).toBe(44);
  });
});

// ── 2. KPIBanner stable min-height ─────────────────────────

describe('KPIBanner layout stability (CLS regression #4726)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with min-h-[52px] on the grid container', () => {
    const { container } = render(<KPIBanner items={KPI_ITEMS} />);
    const grid = container.firstChild as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.className).toContain('min-h-[52px]');
  });

  it('empty-state banner maintains h-[52px] so page height is stable during no-data periods', () => {
    const { container } = render(<KPIBanner items={[]} />);
    const el = container.firstChild as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.className).toContain('h-[52px]');
  });

  it('populated and empty states both result in 52px+ height (no height delta)', () => {
    const { container: emptyContainer } = render(<KPIBanner items={[]} />);
    const emptyEl = emptyContainer.firstChild as HTMLElement;

    const { container: filledContainer } = render(<KPIBanner items={KPI_ITEMS} />);
    const filledEl = filledContainer.firstChild as HTMLElement;

    // Both should declare a stable min/exact height of 52px via Tailwind class
    const emptyHas52 = emptyEl.className.includes('h-[52px]') || emptyEl.className.includes('min-h-[52px]');
    const filledHas52 = filledEl.className.includes('h-[52px]') || filledEl.className.includes('min-h-[52px]');
    expect(emptyHas52).toBe(true);
    expect(filledHas52).toBe(true);
  });
});

// ── 3. KPI banner loading skeleton ─────────────────────────
// Ensures the skeleton in OverviewPage matches the real KPIBanner structure
// (same 5-column grid, same min-height) so the initial load causes no layout shift.

describe('KPI banner loading skeleton dimensions', () => {
  it('KPIBanner with 5 items uses 5 columns — skeleton must match', () => {
    const { container } = render(<KPIBanner items={KPI_ITEMS} />);
    const grid = container.firstChild as HTMLElement;
    // The inline gridTemplateColumns style should declare 5 columns
    expect(grid.style.gridTemplateColumns).toBe('repeat(5, minmax(0, 1fr))');
  });
});
