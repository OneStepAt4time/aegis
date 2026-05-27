/**
 * config/channels.ts — Zod schema for Telegram & webhook channel config.
 *
 * Covers: Telegram bot settings, topic TTL/verbose, webhook URLs.
 */

import { z } from 'zod';

/** Zod schema for channel config domain. */
export const channelConfigSchema = z.object({
  /** Telegram bot token. */
  tgBotToken: z.string().default(''),
  /** Telegram group chat ID. */
  tgGroupId: z.string().default(''),
  /** Allowed Telegram user IDs for inbound commands (empty = allow all). */
  tgAllowedUsers: z.array(z.number()).default([]),
  /** TTL for Telegram forum topics after session end, in milliseconds. */
  tgTopicTtlMs: z.number().int().positive().default(24 * 60 * 60 * 1000),
  /** Whether to auto-delete Telegram forum topics after TTL expires (default: true). */
  tgTopicAutoDelete: z.boolean().default(true),
  /** Forward verbose CC output to Telegram (thinking, tool calls, code). Default: false. */
  tgVerbose: z.boolean().default(false),
  /** TTL for Telegram forum topics in hours (alternative to tgTopicTtlMs; takes priority if set). */
  tgTopicTTLHours: z.number().int().nonnegative().default(0),
  /** Webhook URLs (comma-separated or array). */
  webhooks: z.array(z.string()).default([]),
});

/** Inferred type for the channel config domain. */
export type ChannelConfig = z.infer<typeof channelConfigSchema>;
