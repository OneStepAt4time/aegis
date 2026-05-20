/**
 * LastUpdatedIndicator.test.tsx — Tests for the last-updated timestamp indicator.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LastUpdatedIndicator } from '../LastUpdatedIndicator';
import { I18nProvider } from '../../../i18n/context';

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('LastUpdatedIndicator', () => {
  it('returns null when lastUpdated is null', () => {
    const { container } = renderWithI18n(<LastUpdatedIndicator lastUpdated={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('shows "Updated just now" for recent timestamps', () => {
    const now = Date.now();
    renderWithI18n(<LastUpdatedIndicator lastUpdated={now} />);
    expect(screen.getByText('Updated just now')).toBeTruthy();
  });

  it('shows seconds ago for slightly older timestamps', () => {
    const tenSecondsAgo = Date.now() - 10_000;
    renderWithI18n(<LastUpdatedIndicator lastUpdated={tenSecondsAgo} />);
    const el = screen.getByLabelText(/updated/i);
    expect(el).toBeTruthy();
    expect(el.textContent).toMatch(/ago/);
  });

  it('shows stale warning when data is older than threshold', () => {
    const twoMinutesAgo = Date.now() - 120_000;
    renderWithI18n(<LastUpdatedIndicator lastUpdated={twoMinutesAgo} staleThresholdMs={60_000} />);
    expect(screen.getByText('Data may be stale')).toBeTruthy();
  });

  it('has aria-live for accessibility', () => {
    const now = Date.now();
    renderWithI18n(<LastUpdatedIndicator lastUpdated={now} />);
    const el = screen.getByLabelText(/updated/i);
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('renders clock icon when fresh', () => {
    const now = Date.now();
    const { container } = renderWithI18n(<LastUpdatedIndicator lastUpdated={now} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(screen.queryByText('Data may be stale')).toBeNull();
  });
});
