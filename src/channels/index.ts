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
export { WebhookChannel, type WebhookChannelConfig, type WebhookEndpoint, type DeadLetterEntry } from './webhook.js';

// Telegram Style Guide — 6 standard message types
export {
  quickUpdate,
  quickUpdateCode,
  taskComplete,
  alert,
  yesNo,
  decision,
  progress,
  esc,
  bold,
  code,
  italic,
  statusEmoji,
  type StyledMessage,
  type InlineButton,
  type StatusEmoji,
  type TaskCompleteData,
  type AlertData,
  type AlertButtons,
  type DecisionOption,
  type ProgressStep,
} from './telegram-style.js';
