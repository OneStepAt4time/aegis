/**
 * ServerHealthIndicator.test.tsx — Tests for the health indicator components.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ServerHealthDot, ServerHealthBanner } from '../ServerHealthIndicator';

// Mock the hook
vi.mock('../../../hooks/useServerHealth', () => ({
  useServerHealth: vi.fn(),
}));

import { useServerHealth } from '../../../hooks/useServerHealth';

const mockUseServerHealth = vi.mocked(useServerHealth);

describe('ServerHealthDot', () => {
  it('shows green Connected when status is connected', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'connected',
      lastCheck: new Date(),
      downSince: null,
      errorMessage: null,
    } as ReturnType<typeof useServerHealth>);

    render(<ServerHealthDot />);
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('shows amber Reconnecting when status is reconnecting', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'reconnecting',
      lastCheck: new Date(),
      downSince: new Date(),
      errorMessage: 'Connection to Aegis server lost. Reconnecting…',
    } as ReturnType<typeof useServerHealth>);

    render(<ServerHealthDot />);
    expect(screen.getByText('Reconnecting…')).toBeDefined();
  });

  it('shows red Server unreachable when status is disconnected', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'disconnected',
      lastCheck: new Date(),
      downSince: new Date(),
      errorMessage: 'Aegis server is unreachable. Check if the server is running.',
    } as ReturnType<typeof useServerHealth>);

    render(<ServerHealthDot />);
    expect(screen.getByText('Server unreachable')).toBeDefined();
  });

  it('shows Checking when status is checking', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'checking',
      lastCheck: null,
      downSince: null,
      errorMessage: null,
    } as ReturnType<typeof useServerHealth>);

    render(<ServerHealthDot />);
    expect(screen.getByText('Checking…')).toBeDefined();
  });

  it('has role=status for accessibility', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'connected',
      lastCheck: new Date(),
      downSince: null,
      errorMessage: null,
    } as ReturnType<typeof useServerHealth>);

    const { container } = render(<ServerHealthDot />);
    const statusEl = container.querySelector('[role="status"]');
    expect(statusEl).toBeDefined();
  });
});

describe('ServerHealthBanner', () => {
  it('renders banner when disconnected', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'disconnected',
      lastCheck: new Date(),
      downSince: new Date(),
      errorMessage: 'Aegis server is unreachable. Check if the server is running.',
    } as ReturnType<typeof useServerHealth>);

    render(<ServerHealthBanner />);
    expect(screen.getByText('Aegis server is unreachable. Check if the server is running.')).toBeDefined();
  });

  it('does not render when connected', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'connected',
      lastCheck: new Date(),
      downSince: null,
      errorMessage: null,
    } as ReturnType<typeof useServerHealth>);

    const { container } = render(<ServerHealthBanner />);
    expect(container.querySelector('[data-testid="server-health-banner"]')).toBeNull();
  });

  it('does not render when reconnecting', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'reconnecting',
      lastCheck: new Date(),
      downSince: new Date(),
      errorMessage: 'Connection to Aegis server lost. Reconnecting…',
    } as ReturnType<typeof useServerHealth>);

    const { container } = render(<ServerHealthBanner />);
    expect(container.querySelector('[data-testid="server-health-banner"]')).toBeNull();
  });

  it('has role=alert for accessibility', () => {
    mockUseServerHealth.mockReturnValue({
      status: 'disconnected',
      lastCheck: new Date(),
      downSince: new Date(),
      errorMessage: 'Aegis server is unreachable.',
    } as ReturnType<typeof useServerHealth>);

    const { container } = render(<ServerHealthBanner />);
    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).toBeDefined();
  });
});
