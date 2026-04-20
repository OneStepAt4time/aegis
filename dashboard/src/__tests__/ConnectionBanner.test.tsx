/**
 * __tests__/ConnectionBanner.test.tsx — Unit tests for the ConnectionBanner component.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { useStore } from '../store/useStore';

// Helper to set store state
function setStoreState(patch: { sseConnected?: boolean; sseError?: string | null }) {
  act(() => {
    const store = useStore.getState();
    if (patch.sseConnected !== undefined) store.setSseConnected(patch.sseConnected);
    if (patch.sseError !== undefined) store.setSseError(patch.sseError);
  });
}

describe('ConnectionBanner', () => {
  beforeEach(() => {
    // Reset store to connected state
    act(() => {
      useStore.getState().setSseConnected(true);
      useStore.getState().setSseError(null);
    });
  });

  it('does not render when SSE is connected', () => {
    render(<ConnectionBanner />);
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });

  it('renders when SSE is disconnected with an error', () => {
    setStoreState({ sseConnected: false, sseError: 'Reconnecting…' });
    render(<ConnectionBanner />);
    expect(screen.getByTestId('connection-banner')).toBeDefined();
  });

  it('has aria-live="polite"', () => {
    setStoreState({ sseConnected: false, sseError: 'Reconnecting…' });
    render(<ConnectionBanner />);
    const banner = screen.getByTestId('connection-banner');
    expect(banner.getAttribute('aria-live')).toBe('polite');
  });

  it('has role="status"', () => {
    setStoreState({ sseConnected: false, sseError: 'Reconnecting…' });
    render(<ConnectionBanner />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('shows reconnecting countdown text', () => {
    setStoreState({ sseConnected: false, sseError: 'Reconnecting…' });
    render(<ConnectionBanner />);
    expect(screen.getByText(/Reconnecting in \d+s/)).toBeDefined();
  });

  it('does not render when disconnected but no error', () => {
    setStoreState({ sseConnected: false, sseError: null });
    render(<ConnectionBanner />);
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });
});
