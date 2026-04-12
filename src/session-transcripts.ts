/**
 * session-transcripts.ts — JSONL transcript reading, caching, and pagination.
 *
 * Extracted from SessionManager (ARC-3, #1696) to isolate transcript
 * concerns from session lifecycle management.
 */

import { existsSync } from 'node:fs';
import type { TmuxManager } from './tmux.js';
import { findSessionFile, readNewEntries, type ParsedEntry } from './transcript.js';
import { findSessionFileWithFanout } from './worktree-lookup.js';
import { detectUIState, extractInteractiveContent, parseStatusLine, type UIState } from './terminal-parser.js';
import type { Config } from './config.js';
import type { SessionInfo } from './session.js';

/**
 * Handles all JSONL transcript reading, caching, and pagination for sessions.
 *
 * Operates on `SessionInfo` objects by reference — mutations to offsets and
 * discovered paths are visible to the caller (SessionManager).
 */
export class SessionTranscripts {
  private static readonly MAX_CACHE_ENTRIES_PER_SESSION = 10_000;
  private parsedEntriesCache = new Map<string, { entries: ParsedEntry[]; offset: number }>();

  constructor(
    private tmux: TmuxManager,
    private config: Config,
  ) {}

  /**
   * Read new messages from a session with UI state detection.
   * Mutates session.byteOffset, session.status, session.lastActivity, and
   * optionally session.jsonlPath via JSONL discovery.
   */
  async readMessages(session: SessionInfo): Promise<{
    messages: ParsedEntry[];
    status: UIState;
    statusText: string | null;
    interactiveContent: string | null;
  }> {
    // Detect UI state from terminal
    const paneText = await this.tmux.capturePane(session.windowId);
    const status = detectUIState(paneText);
    const statusText = parseStatusLine(paneText);
    const interactive = extractInteractiveContent(paneText);

    session.status = status;
    session.lastActivity = Date.now();

    // Try to find JSONL if we don't have it yet (Issue #884: worktree-aware)
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    // Read JSONL if we have the file path
    let messages: ParsedEntry[] = [];
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, session.byteOffset);
        messages = result.entries;
        session.byteOffset = result.newOffset;
      } catch {
        // File may not exist yet
      }
    }

    return {
      messages,
      status,
      statusText,
      interactiveContent: interactive?.content || null,
    };
  }

  /**
   * Read new messages for the monitor (separate offset from API reads).
   * Mutates session.monitorOffset and session.status.
   */
  async readMessagesForMonitor(session: SessionInfo): Promise<{
    messages: ParsedEntry[];
    status: UIState;
    statusText: string | null;
    interactiveContent: string | null;
  }> {
    // Detect UI state from terminal
    const paneText = await this.tmux.capturePane(session.windowId);
    const status = detectUIState(paneText);
    const statusText = parseStatusLine(paneText);
    const interactive = extractInteractiveContent(paneText);

    session.status = status;

    // Try to find JSONL if we don't have it yet (Issue #884: worktree-aware)
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.monitorOffset = 0;
      }
    }

    // Read JSONL using monitor offset
    let messages: ParsedEntry[] = [];
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, session.monitorOffset);
        messages = result.entries;
        session.monitorOffset = result.newOffset;
      } catch {
        // File may not exist yet
      }
    }

    return {
      messages,
      status,
      statusText,
      interactiveContent: interactive?.content || null,
    };
  }

  /** Get a condensed summary of a session's transcript. */
  async getSummary(session: SessionInfo, maxMessages = 20): Promise<{
    sessionId: string;
    windowName: string;
    status: UIState;
    totalMessages: number;
    messages: Array<{ role: string; contentType: string; text: string }>;
    createdAt: number;
    lastActivity: number;
    permissionMode: string;
    prd?: string;
  }> {
    // #357: Use cached entries instead of re-reading from offset 0
    const allMessages = await this.getCachedEntries(session);

    // Take last N messages
    const recent = allMessages.slice(-maxMessages).map(m => ({
      role: m.role,
      contentType: m.contentType,
      text: m.text.slice(0, 500), // Truncate long messages
    }));

    return {
      sessionId: session.id,
      windowName: session.windowName,
      status: session.status,
      totalMessages: allMessages.length,
      messages: recent,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      permissionMode: session.permissionMode,
      prd: session.prd,
    };
  }

  /** Paginated transcript read — does NOT advance the session's byteOffset. */
  async readTranscript(
    session: SessionInfo,
    page = 1,
    limit = 50,
    roleFilter?: 'user' | 'assistant' | 'system',
  ): Promise<{
    messages: ParsedEntry[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    // Discover JSONL path if not yet known (Issue #884: worktree-aware)
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    // #357: Use cached entries instead of re-reading from offset 0
    let allEntries = await this.getCachedEntries(session);

    if (roleFilter) {
      allEntries = allEntries.filter(e => e.role === roleFilter);
    }

    const total = allEntries.length;
    const start = (page - 1) * limit;
    const messages = allEntries.slice(start, start + limit);
    const hasMore = start + messages.length < total;

    return {
      messages,
      total,
      page,
      limit,
      hasMore,
    };
  }

  /**
   * Cursor-based transcript read — stable under concurrent appends.
   *
   * Uses 1-based sequential entry indices as cursors.
   * - `beforeId`: exclusive upper bound (fetch entries with index < beforeId).
   *               If omitted, fetch the newest `limit` entries.
   * - `limit`: max entries to return (capped at 200).
   * - Returns entries in ascending order (oldest first) within the window.
   */
  async readTranscriptCursor(
    session: SessionInfo,
    beforeId?: number,
    limit = 50,
    roleFilter?: 'user' | 'assistant' | 'system',
  ): Promise<{
    messages: (ParsedEntry & { _cursor_id: number })[];
    has_more: boolean;
    oldest_id: number | null;
    newest_id: number | null;
  }> {
    // Discover JSONL path if not yet known
    if (!session.jsonlPath && session.claudeSessionId) {
      const path = await findSessionFile(session.claudeSessionId, this.config.claudeProjectsDir);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    let allEntries = await this.getCachedEntries(session);

    if (roleFilter) {
      allEntries = allEntries.filter(e => e.role === roleFilter);
    }

    const total = allEntries.length;
    const clampedLimit = Math.min(200, Math.max(1, limit));

    // Determine exclusive upper index (0-based)
    const upperExclusive = beforeId !== undefined
      ? Math.min(beforeId - 1, total)  // beforeId is 1-based
      : total;

    const lowerInclusive = Math.max(0, upperExclusive - clampedLimit);
    const slice = allEntries.slice(lowerInclusive, upperExclusive);

    const messages = slice.map((entry, i) => ({
      ...entry,
      _cursor_id: lowerInclusive + i + 1,  // 1-based stable index
    }));

    return {
      messages,
      has_more: lowerInclusive > 0,
      oldest_id: messages.length > 0 ? messages[0]._cursor_id : null,
      newest_id: messages.length > 0 ? messages[messages.length - 1]._cursor_id : null,
    };
  }

  /** Remove cached entries for a session (e.g. on session kill). */
  clearCache(sessionId: string): void {
    this.parsedEntriesCache.delete(sessionId);
  }

  /** #357: Get all parsed entries for a session, using a cache to avoid full reparse.
   *  Reads only the delta from the last cached offset. */
  private async getCachedEntries(session: SessionInfo): Promise<ParsedEntry[]> {
    if (!session.jsonlPath || !existsSync(session.jsonlPath)) return [];
    const cached = this.parsedEntriesCache.get(session.id);
    try {
      const fromOffset = cached ? cached.offset : 0;
      const result = await readNewEntries(session.jsonlPath, fromOffset);
      if (cached) {
        // #832: Detect JSONL truncation — newOffset resets to 0 when file is rewritten.
        // readNewEntries returns empty entries + newOffset:0 on truncation.
        // Discard stale cached entries and rebuild from scratch.
        if (fromOffset > 0 && result.newOffset === 0 && result.entries.length === 0) {
          const freshResult = await readNewEntries(session.jsonlPath, 0);
          this.parsedEntriesCache.set(session.id, { entries: [...freshResult.entries], offset: freshResult.newOffset });
          return freshResult.entries;
        }
        cached.entries.push(...result.entries);
        cached.offset = result.newOffset;
        // #424: Evict oldest entries when cache exceeds per-session cap
        if (cached.entries.length > SessionTranscripts.MAX_CACHE_ENTRIES_PER_SESSION) {
          cached.entries.splice(0, cached.entries.length - SessionTranscripts.MAX_CACHE_ENTRIES_PER_SESSION);
        }
        return cached.entries;
      }
      // First read — cache it
      this.parsedEntriesCache.set(session.id, { entries: [...result.entries], offset: result.newOffset });
      return result.entries;
    } catch { /* JSONL read failed — return cached entries or empty */
      return cached ? [...cached.entries] : [];
    }
  }

  /** Issue #884: Worktree-aware session file lookup. */
  private findSessionFileMaybeWorktree(sessionId: string): Promise<string | null> {
    if (this.config.worktreeAwareContinuation && this.config.worktreeSiblingDirs.length > 0) {
      return findSessionFileWithFanout(
        sessionId,
        this.config.claudeProjectsDir,
        this.config.worktreeSiblingDirs,
      );
    }
    return findSessionFile(sessionId, this.config.claudeProjectsDir);
  }
}
