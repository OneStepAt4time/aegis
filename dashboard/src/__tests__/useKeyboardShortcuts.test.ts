import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderShortcuts(options?: {
    onShortcut?: (s: { key: string; description: string; modifier?: string }) => void;
    enabled?: boolean;
  }) {
    const { useKeyboardShortcuts } = await import('../hooks/useKeyboardShortcuts');
    return renderHook(
      ({ opts }) => useKeyboardShortcuts(opts),
      { initialProps: { opts: options ?? {} } },
    );
  }

  function dispatchKey(key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; metaKey?: boolean; target?: EventTarget } = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: opts.ctrlKey ?? false,
      shiftKey: opts.shiftKey ?? false,
      altKey: opts.altKey ?? false,
      metaKey: opts.metaKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    if (opts.target) {
      Object.defineProperty(event, 'target', { value: opts.target, writable: false });
    }
    window.dispatchEvent(event);
    return event;
  }

  it('calls onShortcut when Ctrl+K is pressed', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const evt = dispatchKey('k', { ctrlKey: true });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('k');
    expect(evt.defaultPrevented).toBe(true);
  });

  it('calls onShortcut when Meta+K is pressed (Mac)', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('k', { metaKey: true });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('k');
  });

  it('calls onShortcut for Ctrl+K via Mac compat (metaKey matches ctrl shortcut)', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('k', { metaKey: true });
    const shortcut = onShortcut.mock.calls[0][0];
    expect(shortcut.key).toBe('k');
    expect(shortcut.allowMacCompat).toBe(true);
  });

  it('does not fire on plain K without modifier', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('k');
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('fires on Escape without any modifier', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('Escape');
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('Escape');
  });

  it('fires on Escape even when focus is in an input field', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const input = document.createElement('input');
    dispatchKey('Escape', { target: input });
    expect(onShortcut).toHaveBeenCalledTimes(1);
  });

  it('bypasses shortcuts when focus is in an input field', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const input = document.createElement('input');
    dispatchKey('k', { ctrlKey: true, target: input });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('bypasses shortcuts when focus is in a textarea', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const textarea = document.createElement('textarea');
    dispatchKey('k', { ctrlKey: true, target: textarea });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('bypasses shortcuts when focus is in a select', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const select = document.createElement('select');
    dispatchKey('k', { ctrlKey: true, target: select });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('bypasses shortcuts when focus is in input element', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(onShortcut).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('does not fire when enabled is false', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut, enabled: false });

    dispatchKey('k', { ctrlKey: true });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('fires Ctrl+N for new session', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('n', { ctrlKey: true });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('n');
  });

  it('fires Meta+N for new session (Mac)', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('n', { metaKey: true });
    expect(onShortcut).toHaveBeenCalledTimes(1);
  });

  it('fires Shift+? for show shortcuts', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    dispatchKey('?', { shiftKey: true });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('?');
  });

  it('calls preventDefault on matched shortcut', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const evt = dispatchKey('k', { ctrlKey: true });
    expect(evt.defaultPrevented).toBe(true);
  });

  it('does not call preventDefault when no shortcut matches', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    const evt4 = dispatchKey('z', { ctrlKey: true });
    expect(evt4.defaultPrevented).toBe(false);
  });

  it('removes listener on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = await renderShortcuts();

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('skips sequence shortcuts', async () => {
    const onShortcut = vi.fn();
    await renderShortcuts({ onShortcut });

    // 'g' without modifier should not match the sequence shortcut
    dispatchKey('g');
    // Only non-sequence shortcuts are processed; 'g' alone has no non-sequence match
    expect(onShortcut).not.toHaveBeenCalled();
  });
});
