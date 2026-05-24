/**
 * api/telegram-client.ts — Telegram notification integration API client.
 *
 * Stubs for the one-tap Telegram approval feature (Phase 2).
 * Endpoints will be wired to Aegis backend once Hep implements them.
 */

import type {
  TelegramConnectionConfig,
  TelegramConnectionState,
  TelegramTestNotificationResponse,
} from '../types';

const API_BASE = '/v1';

// ── Helpers ────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => 'Unknown error');
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────

/** Fetch current Telegram connection state */
export async function getTelegramConnection(): Promise<TelegramConnectionState> {
  return apiFetch<TelegramConnectionState>('/integrations/telegram');
}

/** Save Telegram bot token + chat ID */
export async function saveTelegramConnection(config: TelegramConnectionConfig): Promise<TelegramConnectionState> {
  return apiFetch<TelegramConnectionState>('/integrations/telegram', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

/** Send a test notification via the connected bot */
export async function sendTelegramTestNotification(): Promise<TelegramTestNotificationResponse> {
  return apiFetch<TelegramTestNotificationResponse>('/integrations/telegram/test', {
    method: 'POST',
  });
}

/** Disconnect (delete) the Telegram integration */
export async function disconnectTelegram(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/integrations/telegram', {
    method: 'DELETE',
  });
}

// ── Mock implementations (dev only, until backend is ready) ──

const MOCK_DELAY_MS = 800;

/** Mock: simulate getTelegramConnection for local dev */
export async function mockGetTelegramConnection(): Promise<TelegramConnectionState> {
  await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
  // Simulate disconnected state (fresh setup)
  return { status: 'disconnected' };
}

/** Mock: simulate saveTelegramConnection */
export async function mockSaveTelegramConnection(
  config: TelegramConnectionConfig,
): Promise<TelegramConnectionState> {
  await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
  if (!config.botToken || !config.chatId) {
    return { status: 'error', error: 'Bot token and Chat ID are required.' };
  }
  return {
    status: 'connected',
    botUsername: 'AegisApproveBot',
    chatTitle: 'Aegis Approvals',
    connectedAt: new Date().toISOString(),
  };
}

/** Mock: simulate sendTelegramTestNotification */
export async function mockSendTelegramTestNotification(): Promise<TelegramTestNotificationResponse> {
  await new Promise((r) => setTimeout(r, MOCK_DELAY_MS + 400));
  return { ok: true, message: '✅ Test notification sent successfully!' };
}

/** Mock: simulate disconnectTelegram */
export async function mockDisconnectTelegram(): Promise<{ ok: boolean }> {
  await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
  return { ok: true };
}
