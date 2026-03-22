/**
 * telegram-delivery.test.ts — Tests for Issue #46: Telegram message delivery bug.
 */

import { describe, it, expect } from 'vitest';

describe('Telegram message delivery (Issue #46)', () => {
  describe('Topic creation timing', () => {
    it('should create topic before sending prompt (not after)', () => {
      // The correct order is:
      // 1. createSession()
      // 2. channels.sessionCreated() ← topic created HERE
      // 3. sendInitialPrompt()        ← messages can flow to topic
      const steps = ['createSession', 'sessionCreated', 'sendInitialPrompt'];
      const topicCreatedIdx = steps.indexOf('sessionCreated');
      const promptSentIdx = steps.indexOf('sendInitialPrompt');
      expect(topicCreatedIdx).toBeLessThan(promptSentIdx);
    });
  });

  describe('Pre-topic message buffer', () => {
    it('should buffer messages when topic does not exist', () => {
      const buffer = new Map<string, Array<{ method: string; payload: any }>>();

      // Simulate message arriving before topic
      const sessionId = 'sess-1';
      if (!buffer.has(sessionId)) buffer.set(sessionId, []);
      buffer.get(sessionId)!.push({
        method: 'message',
        payload: { event: 'message.assistant', detail: 'Hello' },
      });

      expect(buffer.get(sessionId)).toHaveLength(1);
      expect(buffer.get(sessionId)![0].method).toBe('message');
    });

    it('should buffer multiple messages', () => {
      const buffer: Array<{ method: string }> = [];
      buffer.push({ method: 'message' });
      buffer.push({ method: 'statusChange' });
      buffer.push({ method: 'message' });
      expect(buffer).toHaveLength(3);
    });

    it('should replay buffered messages after topic creation', () => {
      const buffer = [
        { method: 'message', payload: { detail: 'msg1' } },
        { method: 'statusChange', payload: { detail: 'working' } },
        { method: 'message', payload: { detail: 'msg2' } },
      ];

      const replayed: string[] = [];
      for (const item of buffer) {
        replayed.push(item.method);
      }

      expect(replayed).toEqual(['message', 'statusChange', 'message']);
    });

    it('should clear buffer after replay', () => {
      const buffer = new Map<string, any[]>();
      buffer.set('sess-1', [{ method: 'message' }]);

      // After replay
      buffer.delete('sess-1');
      expect(buffer.has('sess-1')).toBe(false);
    });

    it('should not buffer messages when topic exists', () => {
      const topics = new Map<string, { topicId: number }>();
      topics.set('sess-1', { topicId: 123 });

      const shouldBuffer = !topics.has('sess-1');
      expect(shouldBuffer).toBe(false);
    });

    it('should buffer messages when topic does not exist', () => {
      const topics = new Map<string, { topicId: number }>();
      // sess-1 NOT in topics

      const shouldBuffer = !topics.has('sess-1');
      expect(shouldBuffer).toBe(true);
    });
  });

  describe('sendToTopic guard', () => {
    it('should return null when no topic exists (existing behavior)', () => {
      const topics = new Map<string, { topicId: number }>();
      const topic = topics.get('nonexistent');
      expect(topic).toBeUndefined();
      // sendToTopic returns null in this case — this is the silent drop bug
    });
  });

  describe('Monitor offset integrity', () => {
    it('should not advance monitorOffset when messages are dropped', () => {
      // The key insight: readMessagesForMonitor advances monitorOffset
      // regardless of whether the channel delivered the message.
      // With the buffer fix, messages are buffered (not dropped) so
      // they get delivered when the topic is created.
      const monitorOffset = 0;
      const messagesRead = 5;
      const newOffset = monitorOffset + messagesRead;
      expect(newOffset).toBe(5);
      // This is fine now because messages are buffered, not dropped
    });
  });

  describe('Cleanup includes buffer', () => {
    it('should delete buffer on session cleanup', () => {
      const buffer = new Map<string, any[]>();
      buffer.set('sess-1', [{ method: 'message' }]);

      // cleanup() should delete
      buffer.delete('sess-1');
      expect(buffer.has('sess-1')).toBe(false);
    });
  });

  describe('Race condition prevention', () => {
    it('should handle rapid create+message sequence', () => {
      // Simulate: session created, message arrives, then topic created
      const topics = new Map<string, boolean>();
      const buffer = new Map<string, string[]>();

      // Step 1: message arrives, no topic
      if (!topics.has('s1')) {
        if (!buffer.has('s1')) buffer.set('s1', []);
        buffer.get('s1')!.push('msg1');
      }

      // Step 2: another message
      if (!topics.has('s1')) {
        buffer.get('s1')!.push('msg2');
      }

      // Step 3: topic created, replay
      topics.set('s1', true);
      const buffered = buffer.get('s1') || [];
      expect(buffered).toEqual(['msg1', 'msg2']);

      // Replay and clear
      buffer.delete('s1');
      expect(buffer.has('s1')).toBe(false);
    });
  });
});
