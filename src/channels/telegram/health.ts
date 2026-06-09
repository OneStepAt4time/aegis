/**
 * channels/telegram/health.ts — Channel health tracking for TelegramChannel.
 *
 * Extracted from telegram/index.ts (god-module split, #4626).
 * Tracks success/failure state and produces ChannelHealthStatus.
 */

import type { ChannelHealthStatus } from '../types.js';

export interface HealthTracker {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  deliveryFailCount: number;
}

export function createHealthTracker(): HealthTracker {
  return {
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    deliveryFailCount: 0,
  };
}

export function trackSuccess(tracker: HealthTracker): void {
  tracker.lastSuccessAt = Date.now();
  tracker.deliveryFailCount = 0;
}

export function trackFailure(tracker: HealthTracker, error: unknown, redactError: (err: unknown) => unknown): void {
  tracker.lastErrorAt = Date.now();
  const redacted = redactError(error);
  tracker.lastErrorMessage = redacted instanceof Error
    ? (redacted as Error).message
    : String(redacted);
  tracker.deliveryFailCount++;
}

export function getHealth(tracker: HealthTracker, channelName: string, pendingCount: number): ChannelHealthStatus {
  return {
    channel: channelName,
    healthy: tracker.lastErrorAt === null || (tracker.lastSuccessAt !== null && tracker.lastSuccessAt > tracker.lastErrorAt),
    lastSuccess: tracker.lastSuccessAt,
    lastError: tracker.lastErrorMessage,
    pendingCount,
  };
}
