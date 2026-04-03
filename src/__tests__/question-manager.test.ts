/**
 * question-manager.test.ts — Tests for QuestionManager lifecycle.
 *
 * Issue #336: Tests pending question queue management.
 * Issue #351 Phase 2: Extracted from session.ts as part of decomposition.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuestionManager } from '../question-manager.js';

describe('QuestionManager', () => {
  let manager: QuestionManager;
  const sessionId = 'test-session-123';
  const toolUseId = 'tool-456';
  const question = 'What is your name?';

  beforeEach(() => {
    manager = new QuestionManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('waitForAnswer', () => {
    it('stores pending question and returns promise', async () => {
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question);
      expect(manager.hasPendingQuestion(sessionId)).toBe(true);

      // Should not resolve immediately
      let resolved = false;
      answerPromise.then(() => {
        resolved = true;
      });
      await vi.runAllTimersAsync();
      expect(resolved).toBe(true);
    });

    it('resolves promise with answer when submitAnswer is called', async () => {
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question);
      const answer = 'My name is Claude';

      const result = manager.submitAnswer(sessionId, toolUseId, answer);
      expect(result).toBe(true);

      const resolved = await Promise.race([
        answerPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100)),
      ]);
      expect(resolved).toBe(answer);
    });

    it('resolves promise with null on timeout', async () => {
      const timeoutMs = 1000;
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question, timeoutMs);

      // Advance timer past timeout
      vi.advanceTimersByTime(timeoutMs + 100);
      const result = await answerPromise;

      expect(result).toBeNull();
      expect(manager.hasPendingQuestion(sessionId)).toBe(false);
    });

    it('uses default timeout of 30_000ms', async () => {
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question);

      // Advance timer to just before default timeout - promise should not resolve yet
      vi.advanceTimersByTime(29_999);
      let resolved = false;
      answerPromise.then(() => {
        resolved = true;
      });
      // Don't advance further, just check the state
      expect(resolved).toBe(false);

      // Advance timer past default timeout
      vi.advanceTimersByTime(2);
      // Now run all pending timers to allow promises to settle
      await vi.advanceTimersByTimeAsync(1);
      // The promise should now resolve
      const result = await answerPromise;
      expect(result).toBeNull();
    });

    it('clears timeout when answer is submitted before timeout', async () => {
      const timeoutMs = 5000;
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question, timeoutMs);

      const answer = 'Answered!';
      manager.submitAnswer(sessionId, toolUseId, answer);

      // Advance past timeout - should not trigger since we already answered
      vi.advanceTimersByTime(timeoutMs + 1000);
      const result = await answerPromise;
      expect(result).toBe(answer);
    });

    it('stores question metadata', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);

      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info).not.toBeNull();
      expect(info?.toolUseId).toBe(toolUseId);
      expect(info?.question).toBe(question);
      expect(typeof info?.timestamp).toBe('number');
    });
  });

  describe('submitAnswer', () => {
    it('returns false if no pending question exists', () => {
      const result = manager.submitAnswer(sessionId, toolUseId, 'answer');
      expect(result).toBe(false);
    });

    it('returns false if question ID does not match', async () => {
      manager.waitForAnswer(sessionId, toolUseId, question);

      const result = manager.submitAnswer(sessionId, 'different-tool-id', 'answer');
      expect(result).toBe(false);
      expect(manager.hasPendingQuestion(sessionId)).toBe(true); // Still pending
    });

    it('returns true and resolves promise on successful answer', async () => {
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question);
      const answer = 'Test answer';

      const result = manager.submitAnswer(sessionId, toolUseId, answer);
      expect(result).toBe(true);

      const resolved = await Promise.race([
        answerPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100)),
      ]);
      expect(resolved).toBe(answer);
    });

    it('cleans up question from manager after submission', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);
      expect(manager.hasPendingQuestion(sessionId)).toBe(true);

      manager.submitAnswer(sessionId, toolUseId, 'answer');
      expect(manager.hasPendingQuestion(sessionId)).toBe(false);
    });

    it('allows empty string as valid answer', async () => {
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question);

      manager.submitAnswer(sessionId, toolUseId, '');
      const result = await answerPromise;
      expect(result).toBe('');
    });
  });

  describe('hasPendingQuestion', () => {
    it('returns false when no question is pending', () => {
      expect(manager.hasPendingQuestion(sessionId)).toBe(false);
    });

    it('returns true when question is pending', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);
      expect(manager.hasPendingQuestion(sessionId)).toBe(true);
    });

    it('returns false after question is answered', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);
      manager.submitAnswer(sessionId, toolUseId, 'answer');
      expect(manager.hasPendingQuestion(sessionId)).toBe(false);
    });

    it('returns false after question times out', () => {
      manager.waitForAnswer(sessionId, toolUseId, question, 1000);
      vi.advanceTimersByTime(1100);
      expect(manager.hasPendingQuestion(sessionId)).toBe(false);
    });
  });

  describe('getPendingQuestionInfo', () => {
    it('returns null when no question is pending', () => {
      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info).toBeNull();
    });

    it('returns question info when question is pending', () => {
      const beforeTime = Date.now();
      manager.waitForAnswer(sessionId, toolUseId, question);
      const afterTime = Date.now();

      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info).not.toBeNull();
      expect(info?.toolUseId).toBe(toolUseId);
      expect(info?.question).toBe(question);
      expect(info?.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(info?.timestamp).toBeLessThanOrEqual(afterTime);
    });

    it('returns null after question is answered', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);
      manager.submitAnswer(sessionId, toolUseId, 'answer');

      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info).toBeNull();
    });

    it('returns null after question times out', () => {
      manager.waitForAnswer(sessionId, toolUseId, question, 1000);
      vi.advanceTimersByTime(1100);

      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info).toBeNull();
    });
  });

  describe('cleanupPendingQuestion', () => {
    it('removes pending question', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);
      expect(manager.hasPendingQuestion(sessionId)).toBe(true);

      manager.cleanupPendingQuestion(sessionId);
      expect(manager.hasPendingQuestion(sessionId)).toBe(false);
    });

    it('clears timeout to prevent resolve', () => {
      const answerPromise = manager.waitForAnswer(sessionId, toolUseId, question, 5000);
      manager.cleanupPendingQuestion(sessionId);

      // Advance timer past timeout - promise should not resolve since we cleaned up
      let resolved = false;
      answerPromise.then(() => {
        resolved = true;
      });
      vi.advanceTimersByTime(5100);
      expect(resolved).toBe(false);
    });

    it('is safe to call when no question is pending', () => {
      expect(() => {
        manager.cleanupPendingQuestion(sessionId);
      }).not.toThrow();
    });

    it('is safe to call multiple times', () => {
      manager.waitForAnswer(sessionId, toolUseId, question);
      manager.cleanupPendingQuestion(sessionId);
      
      expect(() => {
        manager.cleanupPendingQuestion(sessionId);
      }).not.toThrow();
    });
  });

  describe('multiple pending questions', () => {
    it('manages separate questions for different sessions', async () => {
      const session1 = 'session1';
      const session2 = 'session2';
      const toolId1 = 'tool1';
      const toolId2 = 'tool2';

      const answer1Promise = manager.waitForAnswer(session1, toolId1, 'Q1?');
      const answer2Promise = manager.waitForAnswer(session2, toolId2, 'Q2?');

      expect(manager.hasPendingQuestion(session1)).toBe(true);
      expect(manager.hasPendingQuestion(session2)).toBe(true);

      manager.submitAnswer(session1, toolId1, 'A1');
      expect(manager.hasPendingQuestion(session1)).toBe(false);
      expect(manager.hasPendingQuestion(session2)).toBe(true);

      const result1 = await answer1Promise;
      expect(result1).toBe('A1');

      manager.submitAnswer(session2, toolId2, 'A2');
      const result2 = await answer2Promise;
      expect(result2).toBe('A2');
    });

    it('answer goes to correct session', async () => {
      const session1 = 'session1';
      const session2 = 'session2';
      const tool1 = 'tool1';
      const tool2 = 'tool2';

      const promise1 = manager.waitForAnswer(session1, tool1, 'Q1?');
      const promise2 = manager.waitForAnswer(session2, tool2, 'Q2?');

      // Submit answer for session2 first
      manager.submitAnswer(session2, tool2, 'A2');
      const result2 = await promise2;
      expect(result2).toBe('A2');

      // Session1 should still be pending
      expect(manager.hasPendingQuestion(session1)).toBe(true);

      manager.submitAnswer(session1, tool1, 'A1');
      const result1 = await promise1;
      expect(result1).toBe('A1');
    });
  });

  describe('edge cases', () => {
    it('handles special characters in question text', () => {
      const specialQuestion = 'What is 2+2? (use /path/to/file.txt or "quotes")';
      manager.waitForAnswer(sessionId, toolUseId, specialQuestion);

      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info?.question).toBe(specialQuestion);
    });

    it('handles long question text', () => {
      const longQuestion = 'Q'.repeat(10000);
      manager.waitForAnswer(sessionId, toolUseId, longQuestion);

      const info = manager.getPendingQuestionInfo(sessionId);
      expect(info?.question).toBe(longQuestion);
    });

    it('handles very short timeout', async () => {
      const promise = manager.waitForAnswer(sessionId, toolUseId, question, 1);
      vi.advanceTimersByTime(10);

      const result = await promise;
      expect(result).toBeNull();
    });

    it('handles answer submission with special characters', async () => {
      const specialAnswer = 'Answer with /path and "quotes" and 中文';
      const promise = manager.waitForAnswer(sessionId, toolUseId, question);

      manager.submitAnswer(sessionId, toolUseId, specialAnswer);
      const result = await promise;
      expect(result).toBe(specialAnswer);
    });
  });
});
