import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useFocusTrap', () => {
  let container: HTMLDivElement;
  let outsideButton: HTMLButtonElement;
  let input1: HTMLButtonElement;
  let input2: HTMLButtonElement;
  let input3: HTMLInputElement;

  beforeEach(() => {
    container = document.createElement('div');
    input1 = document.createElement('button');
    input1.textContent = 'First';
    input2 = document.createElement('button');
    input2.textContent = 'Second';
    input3 = document.createElement('input');
    input3.type = 'text';

    container.appendChild(input1);
    container.appendChild(input2);
    container.appendChild(input3);
    document.body.appendChild(container);

    outsideButton = document.createElement('button');
    outsideButton.textContent = 'Outside';
    document.body.appendChild(outsideButton);
  });

  afterEach(() => {
    container.remove();
    outsideButton.remove();
    vi.restoreAllMocks();
  });

  async function renderFocusTrap(
    isActive: boolean,
    options?: { restoreFocusRef?: React.RefObject<HTMLElement | null>; autoFocus?: boolean },
  ) {
    const { useFocusTrap } = await import('../hooks/useFocusTrap');
    const result = renderHook(({ active, opts }) => useFocusTrap(active, opts), {
      initialProps: { active: isActive, opts: options ?? {} },
    });
    return result;
  }

  function fireKeyDown(target: EventTarget | null, key: string, shiftKey = false) {
    const event = new KeyboardEvent('keydown', {
      key,
      shiftKey,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: target });
    document.dispatchEvent(event);
    return event;
  }

  it('attaches keydown listener when active', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    await renderFocusTrap(true);
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('does not attach listener when inactive', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    await renderFocusTrap(false);
    const keydownCalls = addSpy.mock.calls.filter(
      ([evt]) => evt === 'keydown',
    );
    expect(keydownCalls.length).toBe(0);
  });

  it('auto-focuses first focusable element on activate', async () => {
    vi.useFakeTimers();
    const focusSpy = vi.spyOn(input1, 'focus');

    const { result } = await renderFocusTrap(true);
    // Set the ref to our container
    result.current.current = container;

    // Re-render to trigger the effect with the ref set
    await act(async () => {
      vi.advanceTimersByTimeAsync(0);
    });

    // The hook uses requestAnimationFrame
    await act(async () => {
      vi.advanceTimersByTimeAsync(16);
    });

    expect(focusSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('wraps Tab from last to first element', async () => {
    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    input3.focus();
    expect(document.activeElement).toBe(input3);

    const event = fireKeyDown(input3, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input1);
  });

  it('wraps Shift+Tab from first to last element', async () => {
    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    input1.focus();
    expect(document.activeElement).toBe(input1);

    const event = fireKeyDown(input1, 'Tab', true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input3);
  });

  it('does not wrap Tab when focus is on middle element', async () => {
    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    input2.focus();

    const event = fireKeyDown(input2, 'Tab');
    expect(event.defaultPrevented).toBe(false);
  });

  it('wraps Tab when focus is outside container', async () => {
    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    const event = fireKeyDown(outsideButton, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input1);
  });

  it('wraps Shift+Tab when focus is outside container', async () => {
    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    outsideButton.focus();

    const event = fireKeyDown(outsideButton, 'Tab', true);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input3);
  });

  it('prevents Tab and does nothing on empty container', async () => {
    const emptyContainer = document.createElement('div');
    document.body.appendChild(emptyContainer);

    const { result } = await renderFocusTrap(true);
    result.current.current = emptyContainer;

    const event = fireKeyDown(emptyContainer, 'Tab');
    expect(event.defaultPrevented).toBe(true);

    emptyContainer.remove();
  });

  it('restores focus to previously focused element on deactivate', async () => {
    vi.useFakeTimers();
    outsideButton.focus();
    const focusSpy = vi.spyOn(outsideButton, 'focus');

    const { result, unmount } = await renderFocusTrap(true);
    result.current.current = container;

    await act(async () => {
      vi.advanceTimersByTimeAsync(16);
    });

    unmount();

    await act(async () => {
      vi.advanceTimersByTimeAsync(16);
    });

    expect(focusSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('restores focus to restoreFocusRef element when provided', async () => {
    vi.useFakeTimers();
    const restoreTarget = document.createElement('button');
    restoreTarget.textContent = 'Restore';
    document.body.appendChild(restoreTarget);
    const focusSpy = vi.spyOn(restoreTarget, 'focus');

    const restoreFocusRef = { current: restoreTarget } as React.RefObject<HTMLElement | null>;

    const { result, unmount } = await renderFocusTrap(true, { restoreFocusRef });
    result.current.current = container;

    await act(async () => {
      vi.advanceTimersByTimeAsync(16);
    });

    unmount();

    await act(async () => {
      vi.advanceTimersByTimeAsync(16);
    });

    expect(focusSpy).toHaveBeenCalled();
    restoreTarget.remove();
    vi.useRealTimers();
  });

  it('does not auto-focus when autoFocus is false', async () => {
    vi.useFakeTimers();
    const focusSpy = vi.spyOn(input1, 'focus');

    const { result } = await renderFocusTrap(true, { autoFocus: false });
    result.current.current = container;

    await act(async () => {
      vi.advanceTimersByTimeAsync(16);
    });

    expect(focusSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('ignores non-Tab keys', async () => {
    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    input2.focus();
    const event = fireKeyDown(input2, 'Enter');
    expect(event.defaultPrevented).toBe(false);
  });

  it('removes keydown listener on deactivate', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = await renderFocusTrap(true);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });

  it('skips aria-hidden elements', async () => {
    const hidden = document.createElement('button');
    hidden.textContent = 'Hidden';
    hidden.setAttribute('aria-hidden', 'true');
    container.appendChild(hidden);

    const { result } = await renderFocusTrap(true);
    result.current.current = container;

    input3.focus();
    fireKeyDown(input3, 'Tab');

    // Should wrap to input1 (first visible), not hidden button
    expect(document.activeElement).toBe(input1);
  });
});
