import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const store = {
  current: {
    isAuthenticated: true as boolean,
    token: null as string | null,
    authMode: 'cookie' as string,
    revalidate: vi.fn<() => Promise<boolean>>(),
  },
};

vi.mock('../../store/useAuthStore', () => ({
  useAuthStore: Object.assign(
    (sel: (s: typeof store.current) => unknown) => sel(store.current),
    { getState: () => store.current },
  ),
}));

import { useSessionExpiryGuard } from '../useSessionExpiryGuard';

describe('useSessionExpiryGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    store.current = {
      isAuthenticated: true,
      token: null,
      authMode: 'cookie',
      revalidate: vi.fn().mockResolvedValue(true),
    };
  });

  it('starts with isExpired=false', () => {
    const { result } = renderHook(() => useSessionExpiryGuard());
    expect(result.current.isExpired).toBe(false);
  });

  it('provides a reset function', () => {
    const { result } = renderHook(() => useSessionExpiryGuard());
    expect(typeof result.current.reset).toBe('function');
  });

  it('does not call revalidate when not authenticated', async () => {
    store.current.isAuthenticated = false;

    renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(store.current.revalidate).not.toHaveBeenCalled();
  });

  it('does not call revalidate for OIDC sessions', async () => {
    store.current.authMode = 'oidc';
    store.current.revalidate = vi.fn();

    renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(store.current.revalidate).not.toHaveBeenCalled();
  });

  it('does not call revalidate for token-based sessions', async () => {
    store.current.token = 'Bearer abc123';

    renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(store.current.revalidate).not.toHaveBeenCalled();
  });

  it('calls revalidate on the initial timeout for cookie-based auth', async () => {
    store.current.revalidate = vi.fn().mockResolvedValue(true);

    renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(store.current.revalidate).toHaveBeenCalledWith(true);
  });

  it('does not set expired when revalidation succeeds', async () => {
    store.current.revalidate = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() => useSessionExpiryGuard());

    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(result.current.isExpired).toBe(false);
  });

  it('resets expired state via reset()', () => {
    const { result } = renderHook(() => useSessionExpiryGuard());

    act(() => {
      result.current.reset();
    });
    expect(result.current.isExpired).toBe(false);
  });
});
