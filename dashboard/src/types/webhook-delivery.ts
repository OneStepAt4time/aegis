/**
 * Webhook delivery tracking types.
 * API contract: GET /v1/hooks/:hookId/deliveries
 */

export type DeliveryStatus = 'success' | 'failed' | 'retrying';

export interface WebhookDelivery {
  id: string;
  hookId: string;
  timestamp: string;
  status: DeliveryStatus;
  statusCode: number;
  durationMs: number;
  attemptCount: number;
  targetUrl: string;
  errorMessage?: string;
}

export interface WebhookDeliveryResponse {
  deliveries: WebhookDelivery[];
}

export interface WebhookInfo {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt?: string;
}
