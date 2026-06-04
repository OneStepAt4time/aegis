import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from '../Header';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({ resolvedTheme: 'dark', toggleTheme: vi.fn() }),
}));

vi.mock('../../store/useDrawerStore.js', () => ({
  useDrawerStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ openNewSession: vi.fn() }),
}));

vi.mock('../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

vi.mock('../shared/Breadcrumb.tsx', () => ({
  default: () => <nav data-testid="breadcrumb">Breadcrumb</nav>,
}));

vi.mock('../approvals/ApprovalNotification.tsx', () => ({
  ApprovalBadge: () => <span data-testid="approval-badge">Badge</span>,
}));

function renderHeader(overrides = {}) {
  return render(
    <MemoryRouter>
      <Header
        aegisVersion="1.0.0"
        updateCheckLoading={false}
        updateCheckError={null}
        updateResult={null}
        onCheckUpdates={vi.fn()}
        isMobileDrawerOpen={false}
        onToggleMobile={vi.fn()}
        paletteOpen={false}
        onPaletteOpenChange={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('Header', () => {
  it('renders the header element', () => {
    renderHeader();
    expect(screen.getByRole('banner')).toBeDefined();
  });

  it('renders the version string', () => {
    renderHeader({ aegisVersion: '2.5.0' });
    expect(screen.getByText(/Version 2\.5\.0/)).toBeDefined();
  });

  it('renders PREVIEW badge', () => {
    renderHeader();
    expect(screen.getByText('PREVIEW')).toBeDefined();
  });

  it('renders the command palette button', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: /Open command palette/i })).toBeDefined();
  });

  // Regression: #4564 audit — ensure the search palette button uses overlay
  // design tokens instead of raw `white/N` Tailwind opacity classes.
  it('palette button uses overlay design tokens (no raw white/ classes)', () => {
    renderHeader();
    const btn = screen.getByRole('button', { name: /Open command palette/i });
    const cls = btn.className;
    expect(cls).not.toMatch(/white\//);
    expect(cls).toContain('var(--color-overlay-border-strong)');
    expect(cls).toContain('var(--color-overlay-bg)');
    expect(cls).toContain('var(--color-overlay-bg-hover)');
  });

  // Regression: #4564 audit — the kbd shortcut hint inside the palette button
  // must use the overlay-border-strong token, not raw white/10.
  it('palette kbd uses overlay-border-strong token', () => {
    renderHeader();
    const kbd = screen.getByText('⌘K');
    expect(kbd.className).not.toMatch(/white\//);
    expect(kbd.className).toContain('var(--color-overlay-border-strong)');
  });

  it('renders the theme toggle button', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: /Switch to light mode/i })).toBeDefined();
  });

  it('renders the check updates button', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: /Check updates/i })).toBeDefined();
  });

  it('shows "Checking…" when loading', () => {
    renderHeader({ updateCheckLoading: true });
    expect(screen.getByText('Checking…')).toBeDefined();
  });

  it('shows update available link when update found', () => {
    renderHeader({ updateResult: { updateAvailable: true, latestVersion: '3.0.0', currentVersion: '2.0.0', releaseUrl: 'https://example.com' } });
    expect(screen.getByText(/Update available/)).toBeDefined();
  });

  it('shows "Up to date" when no update', () => {
    renderHeader({ updateResult: { updateAvailable: false, latestVersion: '1.0.0', currentVersion: '1.0.0', releaseUrl: '' } });
    expect(screen.getByText(/Up to date/)).toBeDefined();
  });

  it('shows error when update check fails', () => {
    renderHeader({ updateCheckError: 'Network error' });
    expect(screen.getByText('Update check failed')).toBeDefined();
  });

  it('calls onToggleMobile when menu button clicked', () => {
    const onToggleMobile = vi.fn();
    renderHeader({ onToggleMobile });
    const menuBtn = screen.getByRole('button', { name: /Open menu/i });
    fireEvent.click(menuBtn);
    expect(onToggleMobile).toHaveBeenCalled();
  });

  it('calls onCheckUpdates when button clicked', () => {
    const onCheckUpdates = vi.fn();
    renderHeader({ onCheckUpdates });
    fireEvent.click(screen.getByRole('button', { name: /Check updates/i }));
    expect(onCheckUpdates).toHaveBeenCalled();
  });
});
