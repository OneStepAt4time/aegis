/**
 * Webhook delivery API client.
 * Wired to real Aegis API (Hep's PR #4502).
 */

import type { WebhookDeliveryResponse, WebhookInfo } from '../types/webhook-delivery';

// ── API functions ──────────────────────────────────────────

export async function fetchWebhookDeliveries(hookId: string): Promise<WebhookDeliveryResponse> {
  const res = await fetch(`/v1/hooks/${hookId}/deliveries`);
  if (!res.ok) throw new Error(`Failed to fetch deliveries for hook ${hookId}`);
  return res.json();
}

export async function fetchWebhooks(): Promise<WebhookInfo[]> {
  // The hooks listing endpoint is not implemented by the current Aegis API.
  // Render the empty state quietly instead of surfacing a false error.
  return [];
}
