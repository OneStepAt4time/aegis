/**
 * __tests__/KPIBanner.test.tsx — Tests for CCMeter-inspired KPI banner.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KPIBanner } from '../components/analytics/KPIBanner';
import { I18nProvider } from '../i18n/context';
import type { KPIItem } from '../components/analytics/KPIBanner';

const mockItems: KPIItem[] = [
  { id: 'cost', label: 'Total Cost', value: '$1,932', color: 'cost', subtitle: '+12% yesterday', trend: 'up' },
  { id: 'streak', label: 'Day Streak', value: '30', color: 'efficiency' },
  { id: 'tokens', label: 'Avg Tokens/Day', value: '614.8K', color: 'input' },
  { id: 'output', label: 'Output Tokens', value: '15.5M', color: 'output' },
  { id: 'time', label: 'Time Spent', value: '49h 35m', color: 'time' },
];

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('KPIBanner', () => {
  it('renders all KPI items', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    expect(screen.getByText('$1,932')).not.toBeNull();
    expect(screen.getByText('30')).not.toBeNull();
    expect(screen.getByText('614.8K')).not.toBeNull();
    expect(screen.getByText('15.5M')).not.toBeNull();
    expect(screen.getByText('49h 35m')).not.toBeNull();
  });

  it('renders labels', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    expect(screen.getByText('Total Cost')).not.toBeNull();
    expect(screen.getByText('Day Streak')).not.toBeNull();
  });

  it('renders trend icon for items with trend', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    expect(screen.getByText('▲')).not.toBeNull();
  });

  it('renders subtitle when provided', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    expect(screen.getByText('+12% yesterday')).not.toBeNull();
  });

  it('renders empty state when no items', () => {
    renderWithI18n(<KPIBanner items={[]} />);
    expect(screen.getByRole('status')).not.toBeNull();
  });

  it('has correct ARIA role', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    expect(screen.getByRole('list', { name: 'Key performance indicators' })).not.toBeNull();
  });

  it('renders items as listitems', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(5);
  });

  it('applies color classes per category', () => {
    renderWithI18n(<KPIBanner items={mockItems} />);
    // Cost item should have warning color class
    const costValue = screen.getByText('$1,932');
    expect(costValue.className).toContain('text-[var(--color-warning)]');
  });
});
