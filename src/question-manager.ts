/**
 * Question Manager: Manages pending user questions and their lifecycle.
 * Issue #336: Store a pending AskUserQuestion and return a promise that
 * resolves when the external client provides an answer via POST /answer.
 *
 * Phase 2: Extracted from session.ts as part of Issue #351 decomposition.
 */

/** Pending answer resolver for AskUserQuestion tool calls (Issue #336). */
interface PendingQuestion {
  resolve: (answer: string | null) => void;
  timer: NodeJS.Timeout;
  toolUseId: string;
  question: string;
  timestamp: number;
}

export class QuestionManager {
  private pendingQuestions: Map<string, PendingQuestion> = new Map();

  /**
   * Store a pending AskUserQuestion and return a promise that resolves
   * when the external client provides an answer via POST /answer.
   *
   * @param sessionId - Aegis session ID
   * @param toolUseId - Unique tool use ID for this question
   * @param question - The question text to ask the user
   * @param timeoutMs - Timeout before resolving with null (default 30_000ms)
   * @returns Promise that resolves with the user's answer or null on timeout
   */
  waitForAnswer(
    sessionId: string,
    toolUseId: string,
    question: string,
    timeoutMs: number = 30_000,
  ): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingQuestions.delete(sessionId);
        console.log(`Hooks: AskUserQuestion timeout for session ${sessionId} — allowing without answer`);
        resolve(null);
      }, timeoutMs);

      this.pendingQuestions.set(sessionId, { resolve, timer, toolUseId, question, timestamp: Date.now() });
    });
  }

  /**
   * Submit an answer to a pending question.
   *
   * @param sessionId - Aegis session ID
   * @param questionId - Tool use ID of the question (for verification)
   * @param answer - The user's answer
   * @returns True if the question was resolved, false if not found or ID mismatch
   */
  submitAnswer(sessionId: string, questionId: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(sessionId);
    if (!pending) return false;
    if (pending.toolUseId !== questionId) return false;
    clearTimeout(pending.timer);
    this.pendingQuestions.delete(sessionId);
    pending.resolve(answer);
    return true;
  }

  /**
   * Check if a session has a pending question.
   *
   * @param sessionId - Aegis session ID
   * @returns True if a pending question exists for this session
   */
  hasPendingQuestion(sessionId: string): boolean {
    return this.pendingQuestions.has(sessionId);
  }

  /**
   * Get info about a pending question (for API responses).
   *
   * @param sessionId - Aegis session ID
   * @returns Object with toolUseId, question, and timestamp, or null if no pending question
   */
  getPendingQuestionInfo(sessionId: string): { toolUseId: string; question: string; timestamp: number } | null {
    const pending = this.pendingQuestions.get(sessionId);
    return pending ? { toolUseId: pending.toolUseId, question: pending.question, timestamp: pending.timestamp } : null;
  }

  /**
   * Clean up any pending question for a session (e.g. on session delete).
   *
   * @param sessionId - Aegis session ID
   */
  cleanupPendingQuestion(sessionId: string): void {
    const pending = this.pendingQuestions.get(sessionId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingQuestions.delete(sessionId);
    }
  }
}
