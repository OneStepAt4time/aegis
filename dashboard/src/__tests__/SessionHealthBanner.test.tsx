import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionHealthBanner, SessionHealthDot } from '../components/shared/SessionHealthBanner';
import type { AnalyticsErrorRates } from '../../../src/api-contracts';

const mockHealthyRates: AnalyticsErrorRates = {
  totalSessions: 100,
  failedSessions: 2,
  failureRate: 0.02,
  infraFailures: 0,
  adjustedFailureRate: 0.02,
  permissionPrompts: 10,
  approvals: 10,
  autoApprovals: 8,
};

const mockWarningRates: AnalyticsErrorRates = {
  totalSessions: 100,
  failedSessions: 12,
  failureRate: 0.12,
  infraFailures: 3,
  adjustedFailureRate: 0.12,
  permissionPrompts: 20,
  approvals: 18,
  autoApprovals: 15,
};

const mockCriticalRates: AnalyticsErrorRates = {
  totalSessions: 127,
  failedSessions: 120,
  failureRate: 0.945,
  infraFailures: 118,
  adjustedFailureRate: 0.945,
  permissionPrompts: 5,
  approvals: 5,
  autoApprovals: 0,
};

describe('SessionHealthBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders nothing when healthy (<5% failure)', () => {
    const { container } = render(<SessionHealthBanner errorRates={mockHealthyRates} loading={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when loading', () => {
    const { container } = render(<SessionHealthBanner errorRates={mockCriticalRates} loading={true} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing with too few sessions (<5)', () => {
    const fewSessions = { ...mockWarningRates, totalSessions: 3, failedSessions: 2 };
    const { container } = render(<SessionHealthBanner errorRates={fewSessions} loading={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders warning banner at 12% failure rate', () => {
    render(<SessionHealthBanner errorRates={mockWarningRates} loading={false} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('Warning');
    expect(alert.textContent).toContain('12.0%');
    expect(alert.textContent).toContain('12 of 100 sessions failed');
    expect(alert.textContent).toContain('3 infrastructure failures');
  });

  it('renders critical banner at 94.5% failure rate', () => {
    render(<SessionHealthBanner errorRates={mockCriticalRates} loading={false} />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('Critical');
    expect(alert.textContent).toContain('94.5%');
    expect(alert.textContent).toContain('Check ACP child process');
  });

  it('dismisses the banner and re-shows when rate increases 5%+', () => {
    const { rerender } = render(<SessionHealthBanner errorRates={mockWarningRates} loading={false} />);
    expect(screen.getByRole('alert')).toBeTruthy();

    // Dismiss
    fireEvent.click(screen.getByLabelText('Dismiss health alert'));
    expect(screen.queryByRole('alert')).toBeNull();

    // Same rate — still dismissed
    rerender(<SessionHealthBanner errorRates={mockWarningRates} loading={false} />);
    expect(screen.queryByRole('alert')).toBeNull();

    // Rate increased by 5%+ — re-shows
    const higherRate = { ...mockWarningRates, failedSessions: 20, adjustedFailureRate: 0.20, failureRate: 0.20 };
    rerender(<SessionHealthBanner errorRates={higherRate} loading={false} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders nothing when errorRates is undefined', () => {
    const { container } = render(<SessionHealthBanner errorRates={undefined} loading={false} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('SessionHealthDot', () => {
  it('renders nothing when healthy', () => {
    const { container } = render(<SessionHealthDot errorRates={mockHealthyRates} loading={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders pulsing dot with failure rate text at 12%', () => {
    render(<SessionHealthDot errorRates={mockWarningRates} loading={false} />);
    expect(screen.getByText('12.0% failure rate')).toBeTruthy();
    const dot = document.querySelector('.animate-pulse');
    expect(dot).toBeTruthy();
    expect(dot?.className).toContain('bg-yellow-500');
  });

  it('renders pulsing dot with critical color at 94.5%', () => {
    render(<SessionHealthDot errorRates={mockCriticalRates} loading={false} />);
    expect(screen.getByText('94.5% failure rate')).toBeTruthy();
    const dot = document.querySelector('.animate-pulse');
    expect(dot?.className).toContain('bg-red-500');
  });
});
