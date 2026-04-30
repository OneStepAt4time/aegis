/**
 * LoginPage.test.tsx — Tests for the login page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';
import { I18nProvider } from '../i18n/context';

const mockLogin = vi.fn();
const mockInit = vi.fn(async () => {});
const mockLoginWithOidc = vi.fn();

interface MockAuthState {
  login: typeof mockLogin;
  loginWithOidc: typeof mockLoginWithOidc;
  init: typeof mockInit;
  isAuthenticated: boolean;
  isVerifying: boolean;
  oidcAvailable: boolean | null;
}

let mockAuthState: MockAuthState = {
  login: mockLogin,
  loginWithOidc: mockLoginWithOidc,
  init: mockInit,
  isAuthenticated: false,
  isVerifying: false,
  oidcAvailable: false,
};

vi.mock('../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: MockAuthState) => unknown) => selector(mockAuthState),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <I18nProvider>
        <LoginPage />
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockAuthState = {
      login: mockLogin,
      loginWithOidc: mockLoginWithOidc,
      init: mockInit,
      isAuthenticated: false,
      isVerifying: false,
      oidcAvailable: false,
    };
    mockInit.mockResolvedValue(undefined);
  });

  it('renders the login form with Aegis branding', () => {
    renderPage();

    expect(screen.getByText('Aegis')).toBeDefined();
    expect(screen.getByText('Enter your API token to continue')).toBeDefined();
    expect(screen.getByLabelText('API token')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDefined();
  });

  it('shows error on invalid token', async () => {
    mockLogin.mockResolvedValue(false);

    renderPage();

    fireEvent.change(screen.getByLabelText('API token'), {
      target: { value: 'bad-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid API token')).toBeDefined();
    });

    expect(mockLogin).toHaveBeenCalledWith('bad-token');
  });

  it('calls login with valid token and does not show error', async () => {
    mockLogin.mockResolvedValue(true);

    renderPage();

    fireEvent.change(screen.getByLabelText('API token'), {
      target: { value: 'valid-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('valid-token');
    });

    expect(screen.queryByText('Invalid API token')).toBeNull();
  });

  it('toggles password visibility', () => {
    renderPage();

    const input = screen.getByLabelText('API token') as HTMLInputElement;
    expect(input.type).toBe('password');

    const toggle = screen.getByRole('button', { name: 'Show token' });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');

    const hide = screen.getByRole('button', { name: 'Hide token' });
    fireEvent.click(hide);
    expect(input.type).toBe('password');
  });

  it('disables submit button when input is empty', () => {
    renderPage();

    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows OIDC sign-in when dashboard OIDC is available', () => {
    mockAuthState = { ...mockAuthState, oidcAvailable: true };

    renderPage();

    expect(screen.getByText('Sign in with your identity provider to continue')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign in with SSO' })).toBeDefined();
    expect(screen.queryByLabelText('API token')).toBeNull();
  });

  it('uses OIDC sign-in without storing or submitting token secrets', () => {
    mockAuthState = { ...mockAuthState, oidcAvailable: true };

    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with SSO' }));

    expect(mockLoginWithOidc).toHaveBeenCalledTimes(1);
    expect(mockLogin).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('shows a checking state while auth mode is still unknown', () => {
    mockAuthState = { ...mockAuthState, isVerifying: true, oidcAvailable: null };

    renderPage();

    expect(screen.getByLabelText('Checking authentication')).toBeDefined();
    expect(screen.queryByLabelText('API token')).toBeNull();
  });
});
