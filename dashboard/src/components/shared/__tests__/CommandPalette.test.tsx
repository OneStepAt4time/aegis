/**
 * CommandPalette.test.tsx — Tests for Cmd+K command palette.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import CommandPalette from '../CommandPalette';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    button: ({ children, onClick, ...props }: any) => (
      <button type="button" onClick={onClick} {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock stores
vi.mock('../../../store/useStore', () => ({
  useStore: (sel: any) => sel({ sessions: [] }),
}));

vi.mock('../../../store/useDrawerStore', () => ({
  useDrawerStore: (sel: any) => sel({ openNewSession: vi.fn() }),
}));

vi.mock('../../../hooks/useViewTransitionNavigate', () => ({
  useViewTransitionNavigate: () => vi.fn(),
}));

vi.mock('../../../hooks/useFocusTrap', () => ({
  useFocusTrap: () => ({ current: null }),
}));

vi.mock('../../../i18n/context', () => ({
  useT: () => (key: string) => key,
}));

function renderPalette(open = true) {
  return render(
    <BrowserRouter>
      <CommandPalette open={open} onClose={vi.fn()} />
    </BrowserRouter>,
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderPalette(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders dialog when open', () => {
    renderPalette(true);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('has search input with correct placeholder', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');
    expect(input.getAttribute('placeholder')).toContain('Search');
  });

  it('has ESC keyboard hint', () => {
    renderPalette(true);
    expect(screen.getByText('ESC')).toBeTruthy();
  });

  it('shows Navigate group with Overview', () => {
    renderPalette(true);
    expect(screen.getByText('Navigate')).toBeTruthy();
    expect(screen.getByText('Overview')).toBeTruthy();
  });

  it('shows System Actions group', () => {
    renderPalette(true);
    expect(screen.getByText('System Actions')).toBeTruthy();
  });

  it('shows navigation commands', () => {
    renderPalette(true);
    expect(screen.getByText('Sessions')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Audit')).toBeTruthy();
  });

  it('shows "New Session" action', () => {
    renderPalette(true);
    expect(screen.getByText('New Session')).toBeTruthy();
  });

  it('filters results by search query', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');
    // Search for "overview" — should match the Overview nav command
    fireEvent.change(input, { target: { value: 'overview' } });
    expect(screen.getByText('Overview')).toBeTruthy();
    // Settings command should be filtered out
    const allResults = screen.queryAllByRole('option');
    const hasSettings = allResults.some(el => el.textContent?.includes('Settings'));
    expect(hasSettings).toBe(false);
  });

  it('shows "no results" for unmatched query', () => {
    renderPalette(true);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'zzzzz-nonexistent' } });
    expect(screen.getByText(/No results for/)).toBeTruthy();
  });

  it('has listbox role for results', () => {
    renderPalette(true);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('has footer hints for keyboard navigation', () => {
    renderPalette(true);
    expect(screen.getByText(/navigate/)).toBeTruthy();
    expect(screen.getByText(/select/)).toBeTruthy();
    expect(screen.getByText(/close/)).toBeTruthy();
  });
});
