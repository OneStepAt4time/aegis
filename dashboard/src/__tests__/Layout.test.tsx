/**
 * Layout.test.tsx — Tests for Layout SSE error handling (#587).
 *
 * Verifies that if subscribeGlobalSSE throws synchronously, the component
 * survives (no crash) and still renders the UI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mockSubscribeGlobalSSE = vi.fn();

vi.mock('../api/client', () => ({
  subscribeGlobalSSE: (...args: unknown[]) => mockSubscribeGlobalSSE(...args),
}));

vi.mock('../components/ToastContainer', () => ({
  default: () => <div data-testid="toast-container" />,
}));

// Lazy import so mocks are in place
import Layout from '../components/Layout';

function renderLayout(): RenderResult {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>Test Content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout SSE error handling (#587)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without crashing when subscribeGlobalSSE succeeds', () => {
    mockSubscribeGlobalSSE.mockReturnValue(() => {});
    renderLayout();
    expect(screen.getByText('Aegis Dashboard')).toBeDefined();
    expect(mockSubscribeGlobalSSE).toHaveBeenCalled();
  });

  it('renders without crashing when subscribeGlobalSSE throws synchronously', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('Invalid URL construction');
    });

    // Should NOT throw — the component catches the error
    expect(() => renderLayout()).not.toThrow();
    expect(screen.getByText('Aegis Dashboard')).toBeDefined();
    expect(console.error).toHaveBeenCalledWith(
      'Failed to subscribe to global SSE:',
      expect.any(Error),
    );
  });

  it('calls unsubscribe on cleanup', () => {
    const unsubscribe = vi.fn();
    mockSubscribeGlobalSSE.mockReturnValue(unsubscribe);

    const { unmount } = renderLayout();
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('does not call unsubscribe on cleanup when subscribeGlobalSSE threw', () => {
    mockSubscribeGlobalSSE.mockImplementation(() => {
      throw new Error('boom');
    });

    const { unmount } = renderLayout();
    // Unmounting should not throw even though unsubscribe is undefined
    expect(() => unmount()).not.toThrow();
  });
});
