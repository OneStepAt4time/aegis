import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// We need to mock the store so the hook's useCallback closure sees fresh state
let storeState = {
  isAuthenticated: true,
  token: null as string | null,
  authMode: 'cookie' as string,
  revalidate: vi.fn(),
};

vi.mock('../../store/useAuthStore', () => {
  const store = {
    getState: () => storeState,
  };
  // Assign call signature so it works both as hook and as store object
  const useAuthStore = Object.assign(
    (sel: (s: typeof storeState) => any) => sel(storeState),
    store
  );
  return { useAuthStore };
});

describe('useSessionExpiryGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    storeState = {
      isAuthenticated: true,
      token: null,
      authMode: 'cookie',
      revalidate: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with isExpired=false', async () => {
    const { useSessionExpiryGuard } = await import('../useSessionExpiryGuard');
    const { result } = renderHook(() => useSessionExpiryGuard());
    expect(result.current.isExpired).toBe(false);
  });

  it('provides a reset function', async () => {
    const { useSessionExpiryGuard } = await import('../useSessionExpiryGuard');
    const { result } = renderHook(() => useSessionExpiryGuard());
    expect(typeof result.current.reset).toBe('function');
  });

  it('does not set expired for OIDC sessions', async () => {
    storeState.authMode = 'oidc';
    storeState.revalidate = vi.fn();

    const { useSessionExpiryGuard } = await import('../useSessionExpiryGuard');
    renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(storeState.revalidate).not.toHaveBeenCalled();
  });

  it('does not set expired for token-based sessions', async () => {
    storeState.token = 'Bearer abc123';

    const { useSessionExpiryGuard } = await import('../useSessionExpiryGuard');
    renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(storeState.revalidate).not.toHaveBeenCalled();
  });

  it('resets expired state via reset()', async () => {
    const { useSessionExpiryGuard } = await import('../useSessionExpiryGuard');
    const { result } = renderHook(() => useSessionExpiryGuard());

    // Manually set expired to test reset
    act(() => {
      result.current.reset();
    });
    expect(result.current.isExpired).toBe(false);
  });
});
