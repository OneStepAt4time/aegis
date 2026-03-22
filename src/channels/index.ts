/**
 * channels/index.ts — Re-exports for the channel plugin system.
 */

export type {
  Channel,
  SessionEvent,
  SessionEventPayload,
  InboundCommand,
  InboundHandler,
} from './types.js';

export { ChannelManager } from './manager.js';
export { TelegramChannel, type TelegramChannelConfig } from './telegram.js';
export { WebhookChannel, type WebhookChannelConfig, type WebhookEndpoint } from './webhook.js';
