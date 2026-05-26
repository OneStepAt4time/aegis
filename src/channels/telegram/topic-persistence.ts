/**
 * channels/telegram/topic-persistence.ts — Persists session→topic mapping to disk.
 *
 * Issue #3168: Without persistence, the topic map is lost on every restart,
 * causing all event deliveries to silently fail (no topic to send to).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'node:fs';

import { StructuredLogger } from '../../logger.js';
import type { SessionTopic } from './types.js';

const log = new StructuredLogger();

export class TopicPersistence {
  private readonly filePath: string;

  constructor(stateDir?: string) {
    const dir = stateDir ?? join(homedir(), '.aegis');
    this.filePath = join(dir, 'telegram-topics.json');
  }

  save(topics: Map<string, SessionTopic>): void {
    const entries: Array<{
      sessionId: string;
      topicId: number;
      displayName: string;
      endedAt: number | null;
    }> = [];
    for (const [, t] of topics) {
      // Don't persist topics that are being deleted
      if (t.deleting) continue;
      entries.push({
        sessionId: t.sessionId,
        topicId: t.topicId,
        displayName: t.displayName,
        endedAt: t.endedAt,
      });
    }
    try {
      const dir = join(this.filePath, '..');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = this.filePath + '.tmp';
      writeFileSync(tmp, JSON.stringify({ version: 1, topics: entries }), 'utf-8');
      // Atomic rename
      renameSync(tmp, this.filePath);
    } catch (e) {
      log.error({ component: 'telegram', operation: 'persistTopicMap', attributes: { error: String(e) } });
    }
  }

  load(): Map<string, SessionTopic> {
    const result = new Map<string, SessionTopic>();
    try {
      if (!existsSync(this.filePath)) return result;
      const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      if (!data?.topics || !Array.isArray(data.topics)) return result;
      for (const t of data.topics) {
        if (!t.sessionId || !t.topicId) continue;
        result.set(t.sessionId, {
          sessionId: t.sessionId,
          topicId: t.topicId,
          displayName: t.displayName || t.sessionId.slice(0, 8),
          endedAt: t.endedAt ?? null,
          cleanupScheduledAt: null,
          cleanupRetries: 0,
          deleting: false,
        });
      }
    } catch (e) {
      log.error({ component: 'telegram', operation: 'loadTopicMap', attributes: { error: String(e) } });
    }
    return result;
  }

  clear(): void {
    try {
      if (existsSync(this.filePath)) {
        unlinkSync(this.filePath);
      }
    } catch { /* non-critical */ }
  }
}
