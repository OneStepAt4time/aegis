import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomeStatusPanel from '../HomeStatusPanel';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../store/useStore.js', () => ({
  useStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    activities: [],
    sseConnected: true,
    sseError: null,
  }),
}));

vi.mock('../../hooks/useSseAwarePolling.js', () => ({
  useSseAwarePolling: () => {},
}));

vi.mock('../../api/client.js', () => ({
  getHealth: vi.fn().mockResolvedValue({
    status: 'ok',
    claude: { available: true, healthy: true, version: '1.0.0' },
    sessions: { active: 3, total: 10 },
  }),
}));

vi.mock('../../i18n/context', async () => {
  const { testT } = await import('../../../__tests__/i18n-test-helper');
  return { useT: () => testT };
});

vi.mock('./RealtimeBadge.js', () => ({
  default: () => <span data-testid="realtime-badge">RT</span>,
}));

function renderPanel(overrides = {}) {
  return render(
    <MemoryRouter>
      <HomeStatusPanel onCreateFirstSession={vi.fn()} {...overrides} />
    </MemoryRouter>,
  );
}

describe('HomeStatusPanel', () => {
  it('renders Claude CLI card', () => {
    renderPanel();
    expect(screen.getByText('Claude CLI')).toBeDefined();
  });

  it('renders Active sessions card', () => {
    renderPanel();
    expect(screen.getByText('Active sessions')).toBeDefined();
  });

  it('renders status cards as articles with aria-labels', () => {
    renderPanel();
    const articles = screen.getAllByRole('article');
    expect(articles.length).toBeGreaterThanOrEqual(2);
  });

  it('has aria-labels on status cards', () => {
    renderPanel();
    const articles = screen.getAllByRole('article');
    articles.forEach((article) => {
      expect(article.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('shows loading state initially', () => {
    renderPanel();
    const checkingTexts = screen.getAllByText('Checking…');
    expect(checkingTexts.length).toBeGreaterThanOrEqual(1);
  });

  it('renders section with aria-label', () => {
    renderPanel();
    const section = document.querySelector('section');
    expect(section).not.toBeNull();
    expect(section!.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders Claude CLI status detail', () => {
    renderPanel();
    // Loading detail
    expect(screen.getAllByText('Checking…').length).toBeGreaterThanOrEqual(1);
  });
});
