/**
 * NotificationSettingsPage.test.tsx — Vitest tests for Telegram settings page.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api/telegram-client', () => ({
  mockGetTelegramConnection: vi.fn(),
  mockSaveTelegramConnection: vi.fn(),
  mockSendTelegramTestNotification: vi.fn(),
  mockDisconnectTelegram: vi.fn(),
}));

vi.mock('../../store/useToastStore', () => ({
  useToastStore: (selector: (store: { addToast: () => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));

import * as telegramClient from '../../api/telegram-client';

const mockGetConnection = telegramClient.mockGetTelegramConnection as Mock;
const mockSaveConnection = telegramClient.mockSaveTelegramConnection as Mock;
const mockSendTest = telegramClient.mockSendTelegramTestNotification as Mock;
const mockDisconnect = telegramClient.mockDisconnectTelegram as Mock;

import NotificationSettingsPage from '../NotificationSettingsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationSettingsPage />
    </MemoryRouter>,
  );
}

describe('NotificationSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConnection.mockResolvedValue({ status: 'disconnected' });
    mockSaveConnection.mockResolvedValue({
      status: 'connected',
      botUsername: 'TestBot',
      chatTitle: 'Test Chat',
      connectedAt: '2026-05-24T00:00:00Z',
    });
    mockSendTest.mockResolvedValue({ ok: true, message: 'Test sent!' });
    mockDisconnect.mockResolvedValue({ ok: true });
  });

  it('renders the page title', async () => {
    renderPage();
    expect(await screen.findByText('Notifications')).toBeDefined();
  });

  it('shows connection form when disconnected', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Telegram bot token')).toBeDefined();
      expect(screen.getByLabelText('Telegram chat ID')).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /connect/i })).toBeDefined();
  });

  it('disables Connect button when form is empty', async () => {
    renderPage();
    const connectBtn = await screen.findByRole('button', { name: /connect/i });
    expect(connectBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables Connect button when both fields are filled', async () => {
    renderPage();
    await screen.findByText('Disconnected');

    fireEvent.change(screen.getByLabelText('Telegram bot token'), { target: { value: '123456:ABCDEF' } });
    fireEvent.change(screen.getByLabelText('Telegram chat ID'), { target: { value: '-1001234567890' } });

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /connect/i });
      expect(btn.hasAttribute('disabled')).toBe(false);
    });
  });

  it('saves connection on Connect click', async () => {
    renderPage();
    await screen.findByText('Disconnected');

    fireEvent.change(screen.getByLabelText('Telegram bot token'), { target: { value: '123456:ABCDEF' } });
    fireEvent.change(screen.getByLabelText('Telegram chat ID'), { target: { value: '-1001234567890' } });
    fireEvent.click(screen.getByRole('button', { name: /connect/i }));

    await waitFor(() => {
      expect(mockSaveConnection).toHaveBeenCalledWith({
        botToken: '123456:ABCDEF',
        chatId: '-1001234567890',
      });
    });
  });

  it('shows connected state with Send Test and Disconnect', async () => {
    mockGetConnection.mockResolvedValue({
      status: 'connected',
      botUsername: 'AegisBot',
      chatTitle: 'Approvals',
      connectedAt: '2026-05-24T00:00:00Z',
    });

    renderPage();
    await waitFor(() => {
      const connectedElements = screen.getAllByText('Connected');
      expect(connectedElements.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Send Test')).toBeDefined();
      expect(screen.getByText('Disconnect')).toBeDefined();
    });
  });

  it('shows error state with message', async () => {
    mockGetConnection.mockResolvedValue({
      status: 'error',
      error: 'Invalid bot token',
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Error')).toBeDefined();
      expect(screen.getByText('Invalid bot token')).toBeDefined();
    });
  });

  it('toggles token visibility via show/hide button', async () => {
    renderPage();
    await screen.findByText('Disconnected');

    const tokenInput = screen.getByLabelText('Telegram bot token') as HTMLInputElement;
    expect(tokenInput.type).toBe('password');

    fireEvent.click(screen.getByLabelText('Show token'));
    expect(tokenInput.type).toBe('text');

    fireEvent.click(screen.getByLabelText('Hide token'));
    expect(tokenInput.type).toBe('password');
  });

  it('shows How it works section', async () => {
    renderPage();
    expect(await screen.findByText('How it works')).toBeDefined();
  });

  it('has accessible form labels', async () => {
    renderPage();
    await screen.findByText('Disconnected');
    expect(screen.getByLabelText('Telegram bot token')).toBeDefined();
    expect(screen.getByLabelText('Telegram chat ID')).toBeDefined();
  });

  it('has external links to BotFather and userinfobot', async () => {
    renderPage();
    await screen.findByText('Disconnected');
    const links = screen.getAllByRole('link');
    const botfatherLinks = links.filter((l) => l.getAttribute('href')?.includes('BotFather'));
    const userinfoLinks = links.filter((l) => l.getAttribute('href')?.includes('userinfobot'));
    expect(botfatherLinks.length).toBeGreaterThan(0);
    expect(userinfoLinks.length).toBeGreaterThan(0);
  });

  it('disables inputs when connected', async () => {
    mockGetConnection.mockResolvedValue({
      status: 'connected',
      botUsername: 'AegisBot',
      connectedAt: '2026-05-24T00:00:00Z',
    });

    renderPage();
    await waitFor(() => {
      const allConnected = screen.getAllByText('Connected');
      expect(allConnected.length).toBeGreaterThanOrEqual(1);
      const tokenInput = screen.getByLabelText('Telegram bot token') as HTMLInputElement;
      const chatInput = screen.getByLabelText('Telegram chat ID') as HTMLInputElement;
      expect(tokenInput.hasAttribute('disabled')).toBe(true);
      expect(chatInput.hasAttribute('disabled')).toBe(true);
    });
  });
});
