/**
 * useKeyboardShortcuts.test.tsx — Tests for keyboard shortcut hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useKeyboardShortcuts, SHORTCUTS } from '../useKeyboardShortcuts';

function TestComponent({
  onShortcut,
  enabled,
}: {
  onShortcut?: (s: (typeof SHORTCUTS)[number]) => void;
  enabled?: boolean;
}) {
  useKeyboardShortcuts({ onShortcut, enabled });
  return (
    <div data-testid="root">
      <input data-testid="search-input" />
      <textarea data-testid="text-area" />
    </div>
  );
}

describe('useKeyboardShortcuts', () => {
  let onShortcut: ReturnType<typeof vi.fn<(s: (typeof SHORTCUTS)[number]) => void>>;

  beforeEach(() => {
    cleanup();
    onShortcut = vi.fn<(s: (typeof SHORTCUTS)[number]) => void>();
  });

  it('fires onShortcut for Ctrl+K (focus search)', () => {
    render(<TestComponent onShortcut={onShortcut} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('k');
  });

  it('fires onShortcut for Escape in input fields', () => {
    render(<TestComponent onShortcut={onShortcut} />);
    const input = document.querySelector('[data-testid="search-input"]') as HTMLElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onShortcut).toHaveBeenCalledTimes(1);
    expect(onShortcut.mock.calls[0][0].key).toBe('Escape');
  });

  it('does not fire shortcuts when typing in input fields', () => {
    render(<TestComponent onShortcut={onShortcut} />);
    const input = document.querySelector('[data-testid="search-input"]') as HTMLElement;
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('does not fire shortcuts when disabled', () => {
    render(<TestComponent onShortcut={onShortcut} enabled={false} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(onShortcut).not.toHaveBeenCalled();
  });

  it('calls preventDefault on matched shortcut', () => {
    render(<TestComponent onShortcut={onShortcut} />);
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
    const spy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('exposes SHORTCUTS array with expected entries', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    const keys = SHORTCUTS.map((s) => s.key);
    expect(keys).toContain('?');
    expect(keys).toContain('Escape');
    SHORTCUTS.forEach((s) => {
      expect(s.description).toBeTruthy();
    });
  });
});
