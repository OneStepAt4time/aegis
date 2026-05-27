/**
 * useCopy.test.tsx — Tests for clipboard copy hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopy } from '../useCopy';

describe('useCopy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns copied=false initially', () => {
    const { result } = renderHook(() => useCopy('test-value'));
    expect(result.current.copied).toBe(false);
  });

  it('sets copied=true after copy() with clipboard API', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    const { result } = renderHook(() => useCopy('hello'));
    await act(async () => {
      result.current.copy();
    });
    expect(result.current.copied).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');

    vi.unstubAllGlobals();
  });

  it('resets copied to false after timeout', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });

    const { result } = renderHook(() => useCopy('hello'));
    await act(async () => {
      result.current.copy();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);

    vi.unstubAllGlobals();
  });

  it('uses clipboard API when available', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    const { result } = renderHook(() => useCopy('test'));
    await act(async () => {
      result.current.copy();
    });

    expect(writeTextMock).toHaveBeenCalledWith('test');
    expect(result.current.copied).toBe(true);

    vi.unstubAllGlobals();
  });

  it('falls back to execCommand when clipboard API rejects', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('not allowed'));
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    // jsdom doesn't have execCommand — mock it
    const execMock = vi.fn().mockReturnValue(true);
    document.execCommand = execMock;

    const { result } = renderHook(() => useCopy('fallback-value'));
    await act(async () => {
      result.current.copy();
    });

    expect(writeTextMock).toHaveBeenCalledWith('fallback-value');
    expect(execMock).toHaveBeenCalledWith('copy');
    expect(result.current.copied).toBe(true);

    delete (document as any).execCommand;
    vi.unstubAllGlobals();
  });

  it('falls back to execCommand when clipboard API is absent', async () => {
    vi.stubGlobal('navigator', {});

    const execMock = vi.fn().mockReturnValue(true);
    document.execCommand = execMock;

    const { result } = renderHook(() => useCopy('no-clipboard'));
    await act(async () => {
      result.current.copy();
    });

    expect(execMock).toHaveBeenCalledWith('copy');
    expect(result.current.copied).toBe(true);

    delete (document as any).execCommand;
    vi.unstubAllGlobals();
  });

  it('does not set copied=true when execCommand returns false', async () => {
    vi.stubGlobal('navigator', {});

    const execMock = vi.fn().mockReturnValue(false);
    document.execCommand = execMock;

    const { result } = renderHook(() => useCopy('failing'));
    await act(async () => {
      result.current.copy();
    });

    expect(result.current.copied).toBe(false);

    delete (document as any).execCommand;
    vi.unstubAllGlobals();
  });
});
