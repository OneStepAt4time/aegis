import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../ProtectedRoute';

const mockInit = vi.fn(() => Promise.resolve());

interface MockAuthState {
  isAuthenticated: boolean;
  isVerifying: boolean;
  init: ReturnType<typeof vi.fn>;
}

function createAuthMock(overrides: Partial<MockAuthState> = {}): (selector: (s: MockAuthState) => unknown) => unknown {
  const state: MockAuthState = {
    isAuthenticated: false,
    isVerifying: false,
    init: mockInit,
    ...overrides,
  };
  return (selector: (s: MockAuthState) => unknown) => selector(state);
}

let currentMock = createAuthMock();

vi.mock('../../store/useAuthStore.js', () => ({
  useAuthStore: (selector: (s: MockAuthState) => unknown) => currentMock(selector),
}));

function setMock(overrides: Partial<MockAuthState> = {}) {
  currentMock = createAuthMock(overrides);
}

function renderWithRouter(initialPath = '/protected') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/protected" element={<div data-testid="protected-content">Secret</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls init on mount', () => {
    setMock({ isAuthenticated: true, isVerifying: false });
    renderWithRouter();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it('shows loading spinner when verifying', () => {
    setMock({ isAuthenticated: false, isVerifying: true });
    renderWithRouter();
    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeTruthy();
    expect(screen.queryByTestId('protected-content')).toBeNull();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('redirects to /login when not authenticated', () => {
    setMock({ isAuthenticated: false, isVerifying: false });
    renderWithRouter();
    expect(screen.getByTestId('login-page')).toBeTruthy();
    expect(screen.queryByTestId('protected-content')).toBeNull();
  });

  it('renders outlet content when authenticated', () => {
    setMock({ isAuthenticated: true, isVerifying: false });
    renderWithRouter();
    expect(screen.getByTestId('protected-content')).toBeTruthy();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });
});
