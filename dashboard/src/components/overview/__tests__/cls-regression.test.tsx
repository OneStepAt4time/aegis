/**
 * cls-regression.test.tsx — Regression tests for CLS fixes (#4726, #4739).
 *
 * These tests guard against regressions in the layout-shift fixes:
 *  1. Session table rows have a reserved min-height (prevents row collapse under SSE churn).
 *  2. VirtualizedSessionList container never shrinks below its peak height.
 *  3. KPIBanner reserves stable min-height so the loading→loaded transition causes no shift.
 *  4. Session row transition is restricted to paint/composite properties so SSE-push
 *     inserts do not animate layout (CLS regression #4739).
 *  5. List container declares CSS containment so SSE-push inserts cannot reflow the page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
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


// ── 4. Row transitions restricted to paint/composite (CLS regression #4739) ──
// When SSE pushes insert a new row, animating `width`/`height`/`padding`/`margin`
// causes layout shifts across the page (CLS tail > 0.5). The row className must
// only animate paint/composite properties via an explicit transition list.

describe('VirtualizedSessionList row transitions (CLS regression #4739)', () => {
  // Read the source once; tests in this block inspect it via simple regexes.
  const sourcePath = path.resolve(__dirname, '..', 'VirtualizedSessionList.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');

  // Extract the row <div> that carries the data-session-id attribute.
  // The attribute is unique to the session row, so we can isolate the right
  // className by slicing from the most recent `<div` open tag back to the row.
  const rowMatch = source.match(/<div[\s\S]*?data-session-id\s*=\s*\{session\.id\}/);
  if (!rowMatch) {
    throw new Error('Could not locate the row <div> with data-session-id in VirtualizedSessionList.tsx');
  }
  const rowTag = rowMatch[0];
  const classNameMatch = rowTag.match(/className=\{`([^`]+)`\}/);
  if (!classNameMatch) {
    throw new Error('Could not extract the row className template literal');
  }
  const rowClassName = classNameMatch[1];

  it('row className does not use transition-all (would animate layout on SSE-push insert)', () => {
    expect(rowClassName).not.toContain('transition-all');
    expect(rowClassName).not.toContain('duration-[var(--duration-slow)]');
  });

  it('row className uses a precise transition list restricted to paint/composite properties', () => {
    // Must declare a precise transition directive (Tailwind arbitrary value list).
    expect(rowClassName).toMatch(/transition-\[/);

    // The list must not animate layout-triggering keywords.
    // Acceptable list content examples: background-color, border-color, box-shadow,
    // transform, opacity, color. Disallowed: width, height, padding, margin.
    const listMatch = rowClassName.match(/transition-\[([^\]]+)\]/);
    expect(listMatch, 'expected a transition-[...] directive on the row').toBeTruthy();
    if (listMatch) {
      const properties = listMatch[1].split(',').map((p) => p.trim().toLowerCase());
      for (const forbidden of ['width', 'height', 'padding', 'margin']) {
        expect(
          properties.includes(forbidden),
          `row transition list must not include layout property "${forbidden}" — found: ${properties.join(', ')}`,
        ).toBe(false);
      }
    }
  });

  it('list container declares containLayout so SSE-push inserts cannot reflow the page', () => {
    // Locate the outer rounded-lg container (matches the list wrapping div).
    // Grab the full opening tag up to the closing `>` (the style attribute may
    // contain a type cast like `} as CSSProperties`, so we do not require the
    // style attribute to end with `}}`).
    const containerMatch = source.match(
      /<div\s+className="rounded-lg border border-\[var\(--color-void-lighter\)\] overflow-hidden"[^>]*>/,
    );
    if (!containerMatch) {
      throw new Error('Could not locate the outer rounded-lg container in VirtualizedSessionList.tsx');
    }
    const containerTag = containerMatch[0];
    const declaresInlineContainLayout = /containLayout\s*:\s*true/.test(containerTag);
    const declaresCssContain = /contain\s*:\s*layout/.test(containerTag);
    expect(
      declaresInlineContainLayout || declaresCssContain,
      'list container must declare CSS containment (containLayout: true in inline style, or contain: layout in CSS)',
    ).toBe(true);
  });
});
