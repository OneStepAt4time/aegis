import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../components/ProtectedRoute';
import { useAuthStore } from '../store/useAuthStore';

describe('ProtectedRoute', () => {
  beforeEach(() => {
    useAuthStore.setState({
      token: null,
      authMode: null,
      identity: null,
      oidcAvailable: false,
      isAuthenticated: false,
      isVerifying: false,
      lastVerifiedAt: null,
      init: vi.fn(async () => {}),
    });
  });

  it('redirects unauthenticated users to /login', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>Login Screen</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Login Screen')).toBeDefined();
  });

  it('renders protected content for authenticated users', () => {
    useAuthStore.setState({
      token: 'token-123',
      authMode: 'token',
      identity: null,
      oidcAvailable: false,
      isAuthenticated: true,
      isVerifying: false,
      lastVerifiedAt: Date.now(),
      init: vi.fn(async () => {}),
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>Login Screen</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('renders protected content for authenticated OIDC sessions without API token', () => {
    useAuthStore.setState({
      token: null,
      authMode: 'oidc',
      identity: {
        authenticated: true,
        userId: 'user-123',
        email: 'dev@example.com',
        tenantId: 'default',
        role: 'viewer',
        createdAt: 1,
        expiresAt: 2,
      },
      oidcAvailable: true,
      isAuthenticated: true,
      isVerifying: false,
      lastVerifiedAt: null,
      init: vi.fn(async () => {}),
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>Login Screen</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('shows loading state while verifying', () => {
    useAuthStore.setState({
      token: 'token-123',
      authMode: 'token',
      identity: null,
      oidcAvailable: false,
      isAuthenticated: false,
      isVerifying: true,
      lastVerifiedAt: null,
      init: vi.fn(async () => {}),
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>Login Screen</div>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Protected Content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
