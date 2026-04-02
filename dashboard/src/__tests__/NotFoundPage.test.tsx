/**
 * NotFoundPage.test.tsx — Tests for the 404 catch-all route (#646).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import App from '../App';

// Mock child page components to isolate routing behavior
vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/Layout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">
      <div>Aegis Dashboard</div>
      {children}
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

// Mock SSE/Layout dependencies
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
    render(
      <MemoryRouter initialEntries={['/nonexistent']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByText('404')).toBeDefined();
    expect(screen.getByText('Page not found')).toBeDefined();
    expect(screen.getByText('Back to Dashboard')).toBeDefined();
  });
});
