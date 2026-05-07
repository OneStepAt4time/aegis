/**
 * __tests__/DriverControlPanel.test.tsx — Tests for wired driver control panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DriverControlPanel } from '../components/session/DriverControlPanel';

const mockUseSessionParticipants = vi.fn();
vi.mock('../hooks/useSessionParticipants', () => ({
  useSessionParticipants: (...args: unknown[]) => mockUseSessionParticipants(...args),
}));

const defaultReturn = {
  participants: null,
  isLoading: false,
  error: null,
  claim: vi.fn(),
  release: vi.fn(),
  transfer: vi.fn(),
  clearError: vi.fn(),
  refresh: vi.fn(),
};

describe('DriverControlPanel', () => {
  beforeEach(() => {
    mockUseSessionParticipants.mockReturnValue(defaultReturn);
  });

  it('renders without crashing when no participants', () => {
    const { container } = render(<DriverControlPanel sessionId="s1" />);
    expect(container).not.toBeNull();
  });

  it('calls hook with sessionId', () => {
    render(<DriverControlPanel sessionId="sess-456" />);
    expect(mockUseSessionParticipants).toHaveBeenCalledWith('sess-456');
  });

  it('renders with driver present', () => {
    mockUseSessionParticipants.mockReturnValue({
      ...defaultReturn,
      participants: {
        driver: { subscriberId: 'user-1', displayName: 'Test Driver' },
        observers: [],
      },
    });

    const { container } = render(<DriverControlPanel sessionId="s1" currentUserId="user-1" />);
    expect(container).not.toBeNull();
  });
});
