/**
 * LoginPage.test.tsx — Tests for the login page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';

const mockLogin = vi.fn();

vi.mock('../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: { login: typeof mockLogin }) => unknown) =>
    selector({ login: mockLogin }),
}));

function renderPage(): void {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
