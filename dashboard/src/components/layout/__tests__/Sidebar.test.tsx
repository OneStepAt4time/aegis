import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../store/useAuthStore.js', () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    identity: { email: 'agent@aegis.io', name: 'Agent', role: 'admin', tenantId: 'default' },
  }),
}));

vi.mock('../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

vi.mock('../shared/ServerHealthIndicator.tsx', () => ({
  ServerHealthDot: () => <div data-testid="health-dot">Health</div>,
}));

vi.mock('../brand/ShieldLogo', () => ({
  ShieldWordmark: () => <div data-testid="logo">Logo</div>,
}));

function renderSidebar(overrides = {}) {
  return render(
    <MemoryRouter>
      <Sidebar
        onNavClick={vi.fn()}
        onLogout={vi.fn()}
        isMobileDrawerOpen={false}
        isMobileSidebarHidden={false}
        hiddenMobileSidebarControlTabIndex={undefined}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('Sidebar', () => {
  it('renders with aside role', () => {
    renderSidebar();
    expect(screen.getByRole('complementary')).toBeDefined();
  });

  it('renders navigation', () => {
    renderSidebar();
    expect(screen.getByRole('navigation')).toBeDefined();
  });

  it('renders nav links', () => {
    renderSidebar();
    expect(screen.getByText('Overview')).toBeDefined();
  });

  it('renders Settings link', () => {
    renderSidebar();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('renders Collapse button', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /collapse/i })).toBeDefined();
  });

  it('renders Sign out button', () => {
    renderSidebar();
    const buttons = screen.getAllByRole('button');
    const signOutBtn = buttons.find(b => b.querySelector('svg.lucide-log-out'));
    expect(signOutBtn).toBeDefined();
  });

  it('calls onNavClick when nav link clicked', () => {
    const onNavClick = vi.fn();
    renderSidebar({ onNavClick });
    const link = screen.getByText('Overview').closest('a');
    if (link) {
      fireEvent.click(link);
      expect(onNavClick).toHaveBeenCalled();
    }
  });

  it('has aria-label on aside', () => {
    renderSidebar();
    expect(screen.getByRole('complementary').getAttribute('aria-label')).toBeTruthy();
  });

  it('has aria-label on navigation', () => {
    renderSidebar();
    expect(screen.getByRole('navigation').getAttribute('aria-label')).toBeTruthy();
  });

  it('renders all NAV_GROUPS link labels', () => {
    renderSidebar();
    // Key nav items from the nav groups
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Audit')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });
});
