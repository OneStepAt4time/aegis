/**
 * useFocusTrap.test.tsx — Tests for focus trap accessibility hook.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useFocusTrap } from '../useFocusTrap';

// jsdom doesn't implement offsetParent — mock it to return document.body
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  get() {
    return document.body;
  },
  configurable: true,
});

function FocusTrapTestComponent({ isActive }: { isActive: boolean }) {
  const containerRef = useFocusTrap(isActive, { autoFocus: true });
  return (
    <div ref={containerRef} data-testid="trap-container">
      <button data-testid="btn-first">First</button>
      <button data-testid="btn-middle">Middle</button>
      <button data-testid="btn-last">Last</button>
    </div>
  );
}

describe('useFocusTrap', () => {
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  it('returns a ref for the container element', () => {
    const { getByTestId } = render(<FocusTrapTestComponent isActive={true} />);
    expect(getByTestId('trap-container')).toBeDefined();
  });

  it('auto-focuses the first focusable element when activated', () => {
    const { getByTestId } = render(<FocusTrapTestComponent isActive={true} />);
    expect(document.activeElement).toBe(getByTestId('btn-first'));
  });

  it('wraps focus from last to first on Tab', () => {
    const { getByTestId } = render(<FocusTrapTestComponent isActive={true} />);

    const lastBtn = getByTestId('btn-last');
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('btn-first'));
  });

  it('wraps focus from first to last on Shift+Tab', () => {
    const { getByTestId } = render(<FocusTrapTestComponent isActive={true} />);

    const firstBtn = getByTestId('btn-first');
    firstBtn.focus();

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByTestId('btn-last'));
  });

  it('does not trap focus when inactive', () => {
    const { getByTestId } = render(<FocusTrapTestComponent isActive={false} />);

    const lastBtn = getByTestId('btn-last');
    lastBtn.focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(lastBtn);
  });

  it('restores focus to previously focused element on unmount', () => {
    const externalBtn = document.createElement('button');
    document.body.appendChild(externalBtn);
    externalBtn.focus();

    const { unmount } = render(<FocusTrapTestComponent isActive={true} />);
    unmount();

    expect(document.activeElement).toBe(externalBtn);
    document.body.removeChild(externalBtn);
  });

  it('wraps focus when active element is outside container', () => {
    const { getByTestId } = render(<FocusTrapTestComponent isActive={true} />);

    const externalBtn = document.createElement('button');
    document.body.appendChild(externalBtn);
    externalBtn.focus();

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('btn-first'));

    document.body.removeChild(externalBtn);
  });
});
