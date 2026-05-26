/**
 * useServerHealth.test.tsx — Tests for server health polling hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServerHealth } from '../useServerHealth';

// Mock the module-level fetchHealth by mocking fetch
vi.stubGlobal('fetch', vi.fn());

describe('useServerHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with checking status', () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useServerHealth());
    expect(result.current.status).toBe('checking');
    expect(result.current.lastCheck).toBeNull();
  });

  it('transitions to connected on successful health check', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    const { result } = renderHook(() => useServerHealth());

    await waitFor(() => expect(result.current.status).toBe('connected'), { timeout: 3000 });
    expect(result.current.lastCheck).toBeInstanceOf(Date);
    expect(result.current.errorMessage).toBeNull();
  });

  it('transitions to reconnecting on failed health check', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useServerHealth());

    await waitFor(() => expect(result.current.status).toBe('reconnecting'), { timeout: 3000 });
    expect(result.current.downSince).toBeInstanceOf(Date);
    expect(result.current.errorMessage).toContain('Reconnecting');
  });

});
