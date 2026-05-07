/**
 * __tests__/PauseControlPanel.test.tsx — Tests for wired pause control panel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { PauseControlPanel } from '../components/session/PauseControlPanel';

const mockUseSessionIntervention = vi.fn();
vi.mock('../hooks/useSessionIntervention', () => ({
  useSessionIntervention: (...args: unknown[]) => mockUseSessionIntervention(...args),
}));

const defaultReturn = {
  intervention: null,
  isLoading: false,
  error: null,
  pause: vi.fn(),
  intervene: vi.fn(),
  completeIntervention: vi.fn(),
  resume: vi.fn(),
  clearError: vi.fn(),
  refresh: vi.fn(),
};

describe('PauseControlPanel', () => {
  beforeEach(() => {
    mockUseSessionIntervention.mockReturnValue(defaultReturn);
  });

  it('renders without crashing when no intervention', () => {
    const { container } = render(<PauseControlPanel sessionId="s1" />);
    expect(container).not.toBeNull();
  });

  it('calls hook with sessionId', () => {
    render(<PauseControlPanel sessionId="sess-123" />);
    expect(mockUseSessionIntervention).toHaveBeenCalledWith('sess-123');
  });

  it('renders with paused intervention', () => {
    mockUseSessionIntervention.mockReturnValue({
      ...defaultReturn,
      intervention: { status: 'paused', sessionId: 's1', reason: 'checking' },
    });

    const { container } = render(<PauseControlPanel sessionId="s1" />);
    expect(container).not.toBeNull();
  });
});
