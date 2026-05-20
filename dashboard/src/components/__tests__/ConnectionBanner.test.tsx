import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionBanner } from '../ConnectionBanner';
import { useStore } from '../../store/useStore';

vi.mock('../../store/useStore');

describe('ConnectionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is hidden when SSE is connected', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: true, sseError: null }),
    );
    const { container } = render(<ConnectionBanner />);
    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
  });

  it('is hidden when disconnected but no error', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: null }),
    );
    const { container } = render(<ConnectionBanner />);
    expect(container.querySelector('[data-testid="connection-banner"]')).toBeNull();
  });

  it('shows banner when disconnected with error', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: 'timeout' }),
    );
    render(<ConnectionBanner />);
    expect(screen.getByTestId('connection-banner')).not.toBeNull();
    expect(screen.getByText(/Reconnecting in 5s/)).not.toBeNull();
  });

  it('counts down over time', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: 'timeout' }),
    );
    render(<ConnectionBanner />);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/Reconnecting in 4s/)).not.toBeNull();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/Reconnecting in 3s/)).not.toBeNull();
  });

  it('resets countdown after reaching 1', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: 'timeout' }),
    );
    render(<ConnectionBanner />);

    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText(/Reconnecting in 1s/)).not.toBeNull();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/Reconnecting in 5s/)).not.toBeNull();
  });

  it('has role="status" and aria-live="polite"', () => {
    vi.mocked(useStore).mockImplementation((selector: any) =>
      selector({ sseConnected: false, sseError: 'err' }),
    );
    render(<ConnectionBanner />);
    const banner = screen.getByTestId('connection-banner');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });
});
