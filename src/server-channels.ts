/**
 * server-channels.ts — Notification channel registration extracted from server.ts (Issue #4227).
 *
 * Exports:
 *   - `registerChannels(cfg)`: register notification channels (Telegram, webhooks, Slack, email) from config
 *   - `channels`: shared ChannelManager instance used across the server
 *
 * Extraction acceptance criteria (per Ema's spec):
 *   - No behavior change
 *   - No edits in extracted files (src/routes/*.ts) beyond imports
 */
import {
  ChannelManager,
  TelegramChannel,
  SlackChannel,
  EmailChannel,
  WebhookChannel,
} from './channels/index.js';
import type { Config } from './config.js';

/** Shared ChannelManager instance used across the server */
export const channels = new ChannelManager();

/** Register notification channels from config */
export function registerChannels(cfg: Config): void {
  // Telegram (optional)
  if (cfg.tgBotToken && cfg.tgGroupId) {
    channels.register(new TelegramChannel({
      botToken: cfg.tgBotToken,
      groupChatId: cfg.tgGroupId,
      allowedUserIds: cfg.tgAllowedUsers,
      topicTtlMs: cfg.tgTopicTtlMs,
      topicAutoDelete: cfg.tgTopicAutoDelete,
      hookTimeoutMs: cfg.hookTimeoutMs,
      verbose: cfg.tgVerbose,
    }));
  }

  // Webhooks (optional)
  if (cfg.webhooks.length > 0) {
    const webhookChannel = new WebhookChannel({
      endpoints: cfg.webhooks.map(url => ({ url })),
    });
    channels.register(webhookChannel);
  }

  // Slack (optional)
  const slackChannel = SlackChannel.fromEnv();
  if (slackChannel) {
    channels.register(slackChannel);
  }

  // Email (optional)
  const emailChannel = EmailChannel.fromEnv();
  if (emailChannel) {
    channels.register(emailChannel);
  }
}
