/**
 * channels/telegram/types.ts — Shared interfaces for the Telegram channel modules.
 */

import type { InboundHandler } from '../types.js';
import type { TopicPersistence } from './topic-persistence.js';

export interface TelegramChannelConfig {
  botToken: string;
  groupChatId: string;
  allowedUserIds: number[];
  topicTtlMs?: number;
  topicAutoDelete?: boolean;
  /** Issue #1911: Outgoing Telegram API fetch timeout in ms (default: 10_000). */
  hookTimeoutMs?: number;
  /** Forward verbose CC output (thinking, tool calls, code). Default: false. */
  verbose?: boolean;
}

export interface SessionTopic {
  sessionId: string;
  topicId: number;
  displayName: string;
  endedAt: number | null;
  cleanupScheduledAt: number | null;
  cleanupRetries: number;
  deleting: boolean;
}

export interface SessionProgress {
  totalMessages: number;
  reads: number;
  edits: number;
  creates: number;
  commands: number;
  searches: number;
  errors: number;
  filesRead: string[];
  filesEdited: string[];
  startedAt: number;
  lastMessage: string;
  currentStatus: string;
  progressMessageId: number | null; // For edit-in-place progress
}

export interface QueuedItem {
  text: string;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
}

export interface ToolInfo {
  icon: string;
  label: string;
  file?: string;
  cmd?: string;
  category: 'read' | 'edit' | 'create' | 'search' | 'command' | 'other';
}

/**
 * Shared context interface for extracted TelegramChannel functions.
 * The TelegramChannel class satisfies this interface so extracted modules
 * can access internal state without reaching into private fields.
 */
export interface TelegramChannelInternals {
  readonly config: TelegramChannelConfig;
  topics: Map<string, SessionTopic>;
  progress: Map<string, SessionProgress>;
  messageQueue: Map<string, QueuedItem[]>;
  lastSent: Map<string, number>;
  flushTimers: Map<string, NodeJS.Timeout>;
  pendingTool: Map<string, ToolInfo>;
  inFlightCount: Map<string, number>;
  pendingReads: Map<string, string[]>;
  readTimer: Map<string, NodeJS.Timeout>;
  preTopicBuffer: Map<string, Array<{ method: string; payload: any }>>;
  lastUserMessage: Map<string, string>;
  rateLimitUntil: number;
  pollOffset: number;
  polling: boolean;
  pollBackoffMs: number;
  onInbound: InboundHandler | null;
  topicCleanupTimers: Map<string, NodeJS.Timeout>;
  topicCleanupSweepTimer: NodeJS.Timeout | null;
  readonly topicTtlMs: number;
  readonly topicAutoDelete: boolean;
  readonly topicPersistence: TopicPersistence;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  deliveryFailCount: number;
  pollLoopPromise: Promise<void>;
  tgApi(method: string, body: Record<string, unknown>, retries?: number): Promise<unknown>;
  trackSuccess(): void;
  trackFailure(error: unknown): void;
  redactError(err: unknown): unknown;
}
