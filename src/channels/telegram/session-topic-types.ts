/**
 * session-topic-types.ts — SessionTopic interface for the Telegram channel.
 *
 * Extracted from types.ts to break the circular dependency:
 *   types.ts ↔ topic-persistence.ts
 */

export interface SessionTopic {
  sessionId: string;
  topicId: number;
  displayName: string;
  endedAt: number | null;
  cleanupScheduledAt: number | null;
  cleanupRetries: number;
  deleting: boolean;
}
