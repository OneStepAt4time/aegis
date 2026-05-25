/**
 * SessionExpiredModal.test.tsx — Tests for the session expiry re-auth modal.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionExpiredModal } from '../SessionExpiredModal';

// Mock the hooks
vi.mock('../../../hooks/useSessionExpiryGuard', () => ({
  useSessionExpiryGuard: vi.fn(),
}));

vi.mock('../../../store/useAuthStore', () => ({
  useAuthStore: vi.fn(() => vi.fn()),
}));

import { useSessionExpiryGuard } from '../../../hooks/useSessionExpiryGuard';

const mockUseExpiryGuard = vi.mocked(useSessionExpiryGuard);

describe('SessionExpiredModal', () => {
  it('does not render when session is not expired', () => {
    mockUseExpiryGuard.mockReturnValue({ isExpired: false, isWarning: false, dismiss: vi.fn() });
    const { container } = render(<SessionExpiredModal />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders when session is expired', () => {
    mockUseExpiryGuard.mockReturnValue({ isExpired: true, isWarning: false, dismiss: vi.fn() });
    render(<SessionExpiredModal />);
    expect(screen.getByText('Session Expired')).toBeDefined();
  });

  it('shows re-authenticate button', () => {
    mockUseExpiryGuard.mockReturnValue({ isExpired: true, isWarning: false, dismiss: vi.fn() });
    render(<SessionExpiredModal />);
    expect(screen.getByRole('button', { name: /re-authenticate/i })).toBeDefined();
  });

  it('has password input for API key', () => {
    mockUseExpiryGuard.mockReturnValue({ isExpired: true, isWarning: false, dismiss: vi.fn() });
    render(<SessionExpiredModal />);
    const input = screen.getByLabelText('API key');
    expect(input).toBeDefined();
    expect(input.getAttribute('type')).toBe('password');
  });

  it('has aria-modal on the dialog', () => {
    mockUseExpiryGuard.mockReturnValue({ isExpired: true, isWarning: false, dismiss: vi.fn() });
    render(<SessionExpiredModal />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('shows expiry message about 1 hour', () => {
    mockUseExpiryGuard.mockReturnValue({ isExpired: true, isWarning: false, dismiss: vi.fn() });
    render(<SessionExpiredModal />);
    expect(screen.getByText(/timed out after 1 hour/i)).toBeDefined();
  });
});
