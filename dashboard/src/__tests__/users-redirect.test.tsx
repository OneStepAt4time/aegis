/**
 * users-redirect.test.tsx — Verifies /users redirects to /auth/keys at the
 * App router level (issue 022 — dashboard-perfection epic).
 *
 * The /v1/users endpoint does not exist on the server; in single-tenant mode,
 * Users == Auth Keys. Banner rendering is covered in AuthKeysPage.test.tsx.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../store/useAuthStore';

vi.mock('../pages/OverviewPage', () => ({ default: () => <div>Overview Page</div> }));
vi.mock('../pages/AuthKeysPage', () => ({ default: () => <div>Auth Keys Page</div> }));
vi.mock('../pages/AuditPage', () => ({ default: () => <div>Audit Page</div> }));
vi.mock('../pages/SessionDetailPage', () => ({ default: () => <div>Session Detail Page</div> }));
vi.mock('../pages/SessionHistoryPage', () => ({ default: () => <div>Session History Page</div> }));
vi.mock('../pages/NewSessionPage', () => ({ default: () => <div>New Session Page</div> }));
vi.mock('../pages/PipelinesPage', () => ({ default: () => <div>Pipelines Page</div> }));
vi.mock('../pages/PipelineDetailPage', () => ({ default: () => <div>Pipeline Detail Page</div> }));
vi.mock('../pages/SettingsPage', () => ({ default: () => <div>Settings Page</div> }));
vi.mock('../pages/NotFoundPage', () => ({ default: () => <div>Not Found Page</div> }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div>Login Page</div> }));
vi.mock('../components/Layout', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <div data-testid="layout-outlet"><Outlet /></div> };
});
vi.mock('../components/ProtectedRoute', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});

describe('/users client-side redirect', () => {
  beforeEach(() => {
    // Suppress OnboardingScreen so routing tests can find page content
    localStorage.setItem('aegis:onboarded', 'true');
    useAuthStore.setState({
      token: 'test-token',
      isAuthenticated: true,
      isVerifying: false,
      lastVerifiedAt: Date.now(),
      init: vi.fn(async () => {}),
    });
  });

  it('redirects /users to /auth/keys', async () => {
    render(
      <MemoryRouter initialEntries={['/users']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Auth Keys Page')).toBeDefined();
  });
});
