/**
 * NewSessionDrawer.test.tsx — Tests for the New Session drawer component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useDrawerStore } from '../store/useDrawerStore';

vi.mock('framer-motion', () => {
  const React = require('react');
  return {
    AnimatePresence: ({ children }: any) => children ?? null,
    motion: new Proxy({}, {
      get: (_: any, tag: string) => {
        const Comp = ({ children, initial, animate, exit, transition, variants, whileHover, whileTap, ...rest }: any) =>
          React.createElement(tag, rest, children);
        return Comp;
      },
    }),
  };
});

const mockNavigate = vi.fn();
const mockCreateSession = vi.fn();
const mockGetTemplates = vi.fn();

vi.mock('../api/client', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getTemplates: (...args: unknown[]) => mockGetTemplates(...args),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (s: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

import { NewSessionDrawer } from '../components/NewSessionDrawer';

function renderDrawer() {
  return render(
    <MemoryRouter>
      <NewSessionDrawer />
    </MemoryRouter>
  );
}

describe('NewSessionDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTemplates.mockResolvedValue([]);
    // Reset store
    useDrawerStore.setState({ newSessionOpen: false });
  });

  afterEach(() => {
    useDrawerStore.setState({ newSessionOpen: false });
  });

  it('does not render when closed', () => {
    renderDrawer();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders when opened via store', () => {
    renderDrawer();
    act(() => {
      useDrawerStore.getState().openNewSession();
    });
    expect(screen.getByRole('dialog', { name: 'New Session' })).toBeDefined();
  });

  it('renders form fields when open', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });

    expect(screen.getByLabelText(/Working Directory/)).toBeDefined();
    expect(screen.getByLabelText(/Session Name/)).toBeDefined();
    expect(screen.getByLabelText(/Claude Command/)).toBeDefined();
    expect(screen.getByLabelText(/Initial Prompt/)).toBeDefined();
    expect(screen.getByLabelText(/Permission Mode/)).toBeDefined();
  });

  it('closes on Escape key', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });
    expect(screen.getByRole('dialog')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useDrawerStore.getState().newSessionOpen).toBe(false);
  });

  it('closes on backdrop click', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });

    // Click the backdrop (aria-hidden div)
    const backdrop = document.querySelector('[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(useDrawerStore.getState().newSessionOpen).toBe(false);
  });

  it('closes on Cancel button', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useDrawerStore.getState().newSessionOpen).toBe(false);
  });

  it('closes on X (close) button', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));

    expect(useDrawerStore.getState().newSessionOpen).toBe(false);
  });

  it('openNewSession and closeNewSession store actions work', () => {
    expect(useDrawerStore.getState().newSessionOpen).toBe(false);

    act(() => { useDrawerStore.getState().openNewSession(); });
    expect(useDrawerStore.getState().newSessionOpen).toBe(true);

    act(() => { useDrawerStore.getState().closeNewSession(); });
    expect(useDrawerStore.getState().newSessionOpen).toBe(false);
  });

  it('disables submit when workDir is empty', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });

    const submitBtn = screen.getByRole('button', { name: /Create Session/ });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables submit when workDir is filled', () => {
    renderDrawer();
    act(() => { useDrawerStore.getState().openNewSession(); });

    const workDirInput = screen.getByLabelText(/Working Directory/);
    fireEvent.change(workDirInput, { target: { value: '/home/user/project' } });

    const submitBtn = screen.getByRole('button', { name: /Create Session/ });
    expect(submitBtn.hasAttribute('disabled')).toBe(false);
  });
});

describe('NewSessionDrawer — ⌘N shortcut via useDrawerStore', () => {
  it('openNewSession is callable from store (drawer wired in Layout via ⌘N)', () => {
    // The ⌘N wiring lives in Layout.tsx; here we just verify the store action
    useDrawerStore.setState({ newSessionOpen: false });
    act(() => { useDrawerStore.getState().openNewSession(); });
    expect(useDrawerStore.getState().newSessionOpen).toBe(true);
  });
});
