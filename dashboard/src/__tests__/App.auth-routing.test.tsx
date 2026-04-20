import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../store/useAuthStore';

vi.mock('../pages/OverviewPage', () => ({ default: () => <div>Overview Page</div> }));
vi.mock('../pages/AuthKeysPage', () => ({ default: () => <div>Auth Keys Page</div> }));
vi.mock('../pages/AuditPage', () => ({ default: () => <div>Audit Page</div> }));
vi.mock('../pages/SessionDetailPage', () => ({ default: () => <div>Session Detail Page</div> }));
vi.mock('../pages/PipelinesPage', () => ({ default: () => <div>Pipelines Page</div> }));
vi.mock('../pages/PipelineDetailPage', () => ({ default: () => <div>Pipeline Detail Page</div> }));
vi.mock('../pages/NotFoundPage', () => ({ default: () => <div>Not Found Page</div> }));
vi.mock('../pages/LoginPage', () => ({ default: () => <div>Login Page</div> }));
vi.mock('../components/Layout', () => ({ default: () => <div>Layout Outlet</div> }));

describe('App auth routing', () => {
  beforeEach(() => {
    // Suppress OnboardingScreen so routing tests can find page content
    localStorage.setItem('aegis:onboarded', 'true');
    useAuthStore.setState({
      token: null,
      isAuthenticated: false,
      isVerifying: false,
      lastVerifiedAt: null,
      init: vi.fn(async () => {}),
    });
  });

  it('registers /login route', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Login Page')).toBeDefined();
  });

  it('guards non-login routes by redirecting to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Login Page')).toBeDefined();
  });
});
