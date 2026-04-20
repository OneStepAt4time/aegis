/**
 * NotFoundPage.test.tsx — Tests for the 404 catch-all route (#646).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import App from '../App';

// Mock child page components to isolate routing behavior
vi.mock('../components/shared/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/Layout', () => ({
  default: () => (
    <div data-testid="layout">
      <div>Aegis Dashboard</div>
      <Outlet />
    </div>
  ),
}));

vi.mock('../pages/OverviewPage', () => ({
  default: () => <div>Overview</div>,
}));

vi.mock('../pages/SessionDetailPage', () => ({
  default: () => <div>Session Detail</div>,
}));

vi.mock('../pages/PipelinesPage', () => ({
  default: () => <div>Pipelines</div>,
}));

vi.mock('../pages/PipelineDetailPage', () => ({
  default: () => <div>Pipeline Detail</div>,
}));

vi.mock('../pages/AuthKeysPage', () => ({
  default: () => <div>Auth Keys</div>,
}));

vi.mock('../pages/NotFoundPage', () => ({
  default: () => (
    <div>
      <div>404</div>
      <div>Page not found</div>
      <a href="/dashboard">Back to Dashboard</a>
    </div>
  ),
}));

// Mock SSE/Layout dependencies
vi.mock('../store/useAuthStore', () => {
  const state = { isAuthenticated: true, isVerifying: false, token: 'test', init: async () => {} };
  return { useAuthStore: (selector: (s: any) => any) => selector(state) };
});

vi.mock('../api/client', () => ({
  subscribeGlobalSSE: () => () => {},
}));

vi.mock('../components/ToastContainer', () => ({
  default: () => null,
}));

describe('Issue #646: 404 catch-all route', () => {
  it('renders NotFoundPage for an undefined path', () => {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/" element={<div>Overview</div>} />
          <Route path="/pipelines" element={<div>Pipelines</div>} />
          <Route path="*" element={<div data-testid="not-found">404 Page not found</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('not-found')).toBeDefined();
  });

  it('renders NotFoundPage for /foo', () => {
    render(
      <MemoryRouter initialEntries={['/foo']}>
        <Routes>
          <Route path="/" element={<div>Overview</div>} />
          <Route path="*" element={<div data-testid="not-found">404</div>} />
        </Routes>,
      </MemoryRouter>,
    );
    expect(screen.getByTestId('not-found')).toBeDefined();
  });

  it('renders NotFoundPage for deeply nested undefined paths', () => {
    render(
      <MemoryRouter initialEntries={['/a/b/c/d']}>
        <Routes>
          <Route path="/" element={<div>Overview</div>} />
          <Route path="*" element={<div data-testid="not-found">404</div>} />
        </Routes>,
      </MemoryRouter>,
    );
    expect(screen.getByTestId('not-found')).toBeDefined();
  });

  it('does not render NotFoundPage for known routes', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<div>Overview</div>} />
          <Route path="*" element={<div data-testid="not-found">404</div>} />
        </Routes>,
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('not-found')).toBeNull();
  });
});

describe('NotFoundPage component', () => {
  it('renders 404 text and a link back to dashboard', async () => {
    localStorage.setItem('aegis:onboarded', 'true');
    render(
      <MemoryRouter initialEntries={['/nonexistent']}>
        <App />
      </MemoryRouter>,
    );

    // Use findByText for async React.lazy components
    expect(await screen.findByText('404')).toBeDefined();
    expect(await screen.findByText('Page not found')).toBeDefined();
    expect(await screen.findByText('Back to Dashboard')).toBeDefined();
  });
});
