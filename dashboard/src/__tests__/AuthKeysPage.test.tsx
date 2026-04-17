import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthKeysPage from '../pages/AuthKeysPage';

const mockCreateAuthKey = vi.fn();
const mockGetAuthKeys = vi.fn();
const mockRevokeAuthKey = vi.fn();
const mockAddToast = vi.fn();

vi.mock('../api/client', () => ({
  createAuthKey: (...args: unknown[]) => mockCreateAuthKey(...args),
  getAuthKeys: (...args: unknown[]) => mockGetAuthKeys(...args),
  revokeAuthKey: (...args: unknown[]) => mockRevokeAuthKey(...args),
}));

vi.mock('../store/useToastStore', () => ({
  useToastStore: (selector: (store: { addToast: typeof mockAddToast }) => unknown) => selector({ addToast: mockAddToast }),
}));

describe('AuthKeysPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-03T14:00:00.000Z'));
    mockGetAuthKeys.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function renderPage(): void {
    render(<AuthKeysPage />);
  }

  it('lists existing auth keys', async () => {
    mockGetAuthKeys.mockResolvedValueOnce([
      {
        id: 'key-1',
        name: 'ops-primary',
        createdAt: Date.parse('2026-04-03T13:00:00.000Z'),
        lastUsedAt: 0,
        rateLimit: 100,
        expiresAt: null,
        role: 'operator',
        permissions: ['create', 'send', 'approve'],
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('ops-primary')).toBeDefined();
      expect(screen.getByText('1h ago')).toBeDefined();
      expect(screen.getByText('approve')).toBeDefined();
    });
  });

  it('creates a key, refreshes the list, and keeps the secret hidden by default', async () => {
    mockGetAuthKeys
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'key-1',
          name: 'ops-primary',
          createdAt: Date.parse('2026-04-03T13:59:00.000Z'),
          lastUsedAt: 0,
          rateLimit: 100,
          expiresAt: null,
          role: 'viewer',
          permissions: ['create'],
        },
      ]);
    mockCreateAuthKey.mockResolvedValueOnce({
      id: 'key-1',
      name: 'ops-primary',
      key: 'aegis_super_secret_key_1234567890',
      expiresAt: null,
      role: 'viewer',
      permissions: ['create'],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No auth keys yet')).toBeDefined();
    });

    fireEvent.change(screen.getByLabelText('Key Name'), { target: { value: 'ops-primary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Auth Key' }));

    await waitFor(() => {
      expect(mockCreateAuthKey).toHaveBeenCalledWith('ops-primary');
      expect(screen.getByText('Store this key now')).toBeDefined();
      expect(screen.getAllByText('ops-primary').length).toBeGreaterThan(0);
      expect(screen.queryByText('aegis_super_secret_key_1234567890')).toBeNull();
      expect(screen.getAllByText('create').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reveal secret' }));

    expect(screen.getByText('aegis_super_secret_key_1234567890')).toBeDefined();
    expect(mockGetAuthKeys).toHaveBeenCalledTimes(2);
    expect(mockAddToast).toHaveBeenCalledWith(
      'success',
      'Auth key created',
      'Store the secret now. It is only shown once.',
    );
  });

  it('revokes a key after confirmation', async () => {
    mockGetAuthKeys.mockResolvedValueOnce([
      {
        id: 'key-1',
        name: 'ops-primary',
        createdAt: Date.parse('2026-04-03T13:00:00.000Z'),
        lastUsedAt: 0,
        rateLimit: 100,
        expiresAt: null,
        role: 'operator',
        permissions: ['create', 'send'],
      },
    ]);
    mockRevokeAuthKey.mockResolvedValueOnce({ ok: true });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('ops-primary')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    // Confirm in the dialog — scope query to the dialog to avoid ambiguity
    await waitFor(() => {
      expect(screen.getByRole('alertdialog')).toBeDefined();
    });
    const dialog = screen.getByRole('alertdialog');
    // The confirm button is the second button inside the dialog
    const buttons = dialog.querySelectorAll('button');
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(mockRevokeAuthKey).toHaveBeenCalledWith('key-1');
      expect(screen.queryByText('ops-primary')).toBeNull();
    });

    expect(mockAddToast).toHaveBeenCalledWith('success', 'Auth key revoked');
  });
});
