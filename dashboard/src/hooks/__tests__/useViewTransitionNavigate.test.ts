import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewTransitionNavigate } from '../useViewTransitionNavigate';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock viewTransitions utility
const mockWithViewTransition = vi.fn((cb: () => void) => cb());
vi.mock('../../utils/viewTransitions', () => ({
  withViewTransition: (cb: () => void) => mockWithViewTransition(cb),
}));

describe('useViewTransitionNavigate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wraps string path navigation in view transition', () => {
    const { result } = renderHook(() => useViewTransitionNavigate());
    result.current('/overview');
    expect(mockWithViewTransition).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/overview', undefined);
  });

  it('passes navigate options', () => {
    const { result } = renderHook(() => useViewTransitionNavigate());
    result.current('/sessions', { replace: true });
    expect(mockNavigate).toHaveBeenCalledWith('/sessions', { replace: true });
  });

  it('wraps numeric navigation in view transition', () => {
    const { result } = renderHook(() => useViewTransitionNavigate());
    result.current(-1);
    expect(mockWithViewTransition).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('calls withViewTransition for every navigation', () => {
    const { result } = renderHook(() => useViewTransitionNavigate());
    result.current('/a');
    result.current('/b');
    result.current(-1);
    expect(mockWithViewTransition).toHaveBeenCalledTimes(3);
  });
});
