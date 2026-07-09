/**
 * session-transcripts.ts — JSONL transcript reading, caching, and pagination.
 *
 * Extracted from SessionManager (ARC-3, #1696) to isolate transcript
 * concerns from session lifecycle management.
 */

import { StructuredLogger } from './logger.js';
const log = new StructuredLogger();

import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { findSessionFile, readNewEntries, type ParsedEntry } from './transcript.js';
import { findSessionFileWithFanout } from './worktree-lookup.js';
import { computeProjectHash } from './path-utils.js';
import type { AcpEventStore } from './services/acp/event-store.js';
import { listAllTranscriptEvents } from './services/acp/transcript-events.js';
import type { Config } from './config.js';
import type { SessionInfo } from './session-types.js';
import type { UIState } from './session-types.js';

/** Stub: detect UI state from terminal pane text (ACP mode).
 * Issue #3081: In ACP mode there is no tmux pane to read, so we cannot
 * detect the actual UI state. Return the session's current status instead
 * of hardcoding 'idle', which was overwriting 'pending' on fresh sessions.
 */
function detectUIState(currentStatus: UIState): UIState {
  return currentStatus;
}

/** Stub: parse status line from terminal pane text. */
function parseStatusLine(_paneText: string): string | null {
  return null;
}

/** Stub: extract interactive content from terminal pane text. */
function extractInteractiveContent(_paneText: string): { content: string } | null {
  return null;
}

/**
 * Handles all JSONL transcript reading, caching, and pagination for sessions.
 *
 * Operates on `SessionInfo` objects by reference — mutations to offsets and
 * discovered paths are visible to the caller (SessionManager).
 */
export class SessionTranscripts {
  /** Issue #3762: Reduced from 10K to 2K — large entries consume massive memory. */
  private static readonly MAX_CACHE_ENTRIES_PER_SESSION = 2_000;
  /** Issue #3762: Max text length retained per cached entry (bytes). Truncate longer text. */
  private static readonly MAX_CACHED_TEXT_LENGTH = 2_048;
  /** Issue #3762: Total byte budget for the parsed entries cache (50MB). Evict oldest sessions when exceeded. */
  private static readonly CACHE_BYTE_BUDGET = 50 * 1024 * 1024;
  private parsedEntriesCache = new Map<string, { entries: ParsedEntry[]; offset: number; estimatedBytes: number }>();

  private acpEventStore: AcpEventStore | null = null;
  constructor(
    private config: Config,
  ) {}

  /** Issue #3143: Inject ACP event store for reading ACP session transcripts. */
  setAcpEventStore(store: AcpEventStore): void {
    this.acpEventStore = store;
  }

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
    // Detect UI state from terminal (stub: ACP mode)
    // Issue #3081: Pass current status so stub preserves it
    const status = detectUIState(session.status);
    const statusText = parseStatusLine('');
    const interactive = extractInteractiveContent('');

    session.status = status;
    session.lastActivity = Date.now();

    // Issue #1768: Invalidate stale jsonlPath so re-discovery can occur.
    if (session.jsonlPath && !existsSync(session.jsonlPath)) {
      session.jsonlPath = undefined;
    }

    // Try to find JSONL if we don't have it yet (Issue #884: worktree-aware)
    // ADR-0034 M4: Skip CC JSONL discovery for non-claude-code runners.
    if (this.isCcSession(session) && !session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    // Issue #1768: Filesystem fallback when claudeSessionId was never discovered
    // (e.g. discovery polling timed out or hooks never fired).
    if (this.isCcSession(session) && !session.jsonlPath) {
      await this.discoverFromFilesystemFallback(session);
    }

    // Read JSONL if we have the file path
    let messages: ParsedEntry[] = [];
    if (session.jsonlPath && existsSync(session.jsonlPath)) {
      try {
        const result = await readNewEntries(session.jsonlPath, session.byteOffset);
        messages = result.entries;
        session.byteOffset = result.newOffset;
        // Issue #3632: When a session is idle/killed (completed) and readMessages
        // returns empty, the byteOffset was consumed during the session by prior
        // reads (dashboard polling, MCP getTranscript, etc.). Reset to 0 and
        // re-read so the caller gets the full transcript.
        if (messages.length === 0 && (status === 'idle' || status === 'killed') && session.byteOffset > 0) {
          const fullResult = await readNewEntries(session.jsonlPath, 0);
          messages = fullResult.entries;
          session.byteOffset = fullResult.newOffset;
        }
      } catch {
        // File may not exist yet
      }
    } else if (this.acpEventStore) {
      // Issue #3143: Fall back to ACP event store for ACP sessions.
      // ACP sessions don't produce JSONL files — transcript data is in the event store.
      try {
        messages = await this.readFromAcpEvents(session);
      } catch {
        // ACP event read failed — return empty
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
    // Detect UI state from terminal (stub: ACP mode)
    // Issue #3081: Pass current status so stub preserves it
    const status = detectUIState(session.status);
    const statusText = parseStatusLine('');
    const interactive = extractInteractiveContent('');

    session.status = status;

    // Issue #1768: Invalidate stale jsonlPath (same fix as readMessages)
    if (session.jsonlPath && !existsSync(session.jsonlPath)) {
      session.jsonlPath = undefined;
    }

    // Try to find JSONL if we don't have it yet (Issue #884: worktree-aware)
    // ADR-0034 M4: Skip CC JSONL discovery for non-claude-code runners.
    if (this.isCcSession(session) && !session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.monitorOffset = 0;
      }
    }

    // Issue #1768: Filesystem fallback when claudeSessionId was never discovered
    if (this.isCcSession(session) && !session.jsonlPath) {
      await this.discoverFromFilesystemFallback(session);
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
    displayName: string;
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
      displayName: session.displayName,
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
    // ADR-0034 M4: Skip CC JSONL discovery for non-claude-code runners.
    if (this.isCcSession(session) && !session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    // Issue #3863: Read full entries from disk for API transcript endpoints
    let allEntries = await this.getFullEntries(session);

    // Issue #3864: Sync session.byteOffset with cache offset so the
    // session detail endpoint shows an accurate byteOffset instead of
    // perpetually showing 0 while the monitor has read thousands of bytes.
    const cached = this.parsedEntriesCache.get(session.id);
    if (cached && cached.offset > session.byteOffset) {
      session.byteOffset = cached.offset;
    }

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
    // ADR-0034 M4: Skip CC JSONL discovery for non-claude-code runners.
    if (this.isCcSession(session) && !session.jsonlPath && session.claudeSessionId) {
      const path = await findSessionFile(session.claudeSessionId, this.config.claudeProjectsDir);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    let allEntries = await this.getFullEntries(session);

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

  /** Issue #3143: Read messages from ACP event store for ACP sessions.
   *  Converts ACP events to ParsedEntry format compatible with JSONL-based reads. */
  private async readFromAcpEvents(session: SessionInfo): Promise<ParsedEntry[]> {
    if (!this.acpEventStore) return [];

    const scope = {
      tenantId: session.tenantId ?? 'default',
      ownerKeyId: session.ownerKeyId ?? '',
    };

    const events = await listAllTranscriptEvents(this.acpEventStore, scope, session.id);

    if (events.length === 0) return [];

    const entries: ParsedEntry[] = [];
    // Accumulate consecutive same-type delta events into single entries (like JSONL)
    let pendingMessageText = '';
    let pendingThinkingText = '';
    let lastMessageId: string | undefined;
    let lastDeltaType: 'message' | 'thinking' | null = null;

    const flushPending = (): void => {
      if (pendingThinkingText) {
        entries.push({
          role: 'assistant',
          contentType: 'thinking',
          text: pendingThinkingText.trim(),
        });
        pendingThinkingText = '';
      }
      if (pendingMessageText) {
        entries.push({
          role: 'assistant',
          contentType: 'text',
          text: pendingMessageText.trim(),
        });
        pendingMessageText = '';
      }
    };

    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | null;
      if (!payload) continue;

      switch (event.eventType) {
        case 'message.delta': {
          const messageId = typeof payload.messageId === 'string' ? payload.messageId : undefined;
          // Flush when switching from thinking to message, or messageId changes
          if (lastDeltaType === 'thinking' || (messageId && messageId !== lastMessageId && lastMessageId !== undefined)) {
            flushPending();
          }
          lastMessageId = messageId;
          lastDeltaType = 'message';
          const text = typeof payload.text === 'string' ? payload.text : '';
          if (text) pendingMessageText += text;
          break;
        }
        case 'thinking.delta': {
          // Flush when switching from message to thinking
          if (lastDeltaType === 'message') {
            flushPending();
          }
          lastDeltaType = 'thinking';
          const text = typeof payload.text === 'string' ? payload.text : '';
          if (text) pendingThinkingText += text;
          break;
        }
        case 'tool.started': {
          flushPending();
          const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
          const title = typeof payload.title === 'string' ? payload.title : 'unknown';
          entries.push({
            role: 'assistant',
            contentType: 'tool_use',
            text: title,
            toolName: title,
            toolUseId: toolCallId,
          });
          break;
        }
        case 'tool.completed': {
          const toolCallId = typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined;
          const isError = payload.isError === true || payload.status === 'error';
          const outputText = typeof payload.output === 'string'
            ? payload.output
            : payload.output != null ? JSON.stringify(payload.output) : '';
          entries.push({
            role: 'assistant',
            contentType: isError ? 'tool_error' : 'tool_result',
            text: outputText.slice(0, 500),
            toolUseId: toolCallId,
          });
          break;
        }
        case 'approval.requested': {
          flushPending();
          const toolCall = typeof payload.toolCall === 'object' && payload.toolCall !== null
            ? payload.toolCall as Record<string, unknown>
            : null;
          const toolTitle = toolCall && typeof toolCall.title === 'string' ? toolCall.title : 'Permission request';
          entries.push({
            role: 'system',
            contentType: 'permission_request',
            text: toolTitle,
          });
          break;
        }
        default:
          // Skip session.updated, usage.updated, turn.completed, etc.
          break;
      }
    }

    flushPending();
    return entries;
  }

  /** Remove cached entries for a session (e.g. on session kill). */
  /** Issue #3762: Truncate text in a ParsedEntry to reduce memory footprint in cache. */
  private static truncateEntryText(entry: ParsedEntry): ParsedEntry {
    if (entry.text.length <= SessionTranscripts.MAX_CACHED_TEXT_LENGTH) return entry;
    return {
      ...entry,
      text: entry.text.slice(0, SessionTranscripts.MAX_CACHED_TEXT_LENGTH) + '\n... [truncated]',
    };
  }

  /** Issue #3762: Estimate bytes used by cached entries for a session. */
  private estimateCacheBytes(entries: ParsedEntry[]): number {
    let bytes = 0;
    for (const entry of entries) {
      // Rough estimate: text content + overhead for object structure
      bytes += entry.text.length * 2 + 200; // UTF-16 chars + overhead
    }
    return bytes;
  }

  /** Issue #3762: Evict oldest session caches when total exceeds byte budget. */
  private evictIfNeeded(): void {
    if (this.parsedEntriesCache.size <= 1) return;
    let totalBytes = 0;
    for (const cached of this.parsedEntriesCache.values()) {
      totalBytes += cached.estimatedBytes;
    }
    if (totalBytes <= SessionTranscripts.CACHE_BYTE_BUDGET) return;
    // Evict oldest sessions first (first inserted = oldest by insertion order of Map)
    const keysToDelete: string[] = [];
    for (const [sessionId, cached] of this.parsedEntriesCache) {
      if (totalBytes <= SessionTranscripts.CACHE_BYTE_BUDGET * 0.7) break;
      totalBytes -= cached.estimatedBytes;
      keysToDelete.push(sessionId);
    }
    for (const key of keysToDelete) {
      this.parsedEntriesCache.delete(key);
    }
  }

  clearCache(sessionId: string): void {
    this.parsedEntriesCache.delete(sessionId);
  }

  /** #357: Get all parsed entries for a session, using a cache to avoid full reparse.
   *  Reads only the delta from the last cached offset. */
  private async getCachedEntries(session: SessionInfo): Promise<ParsedEntry[]> {
    if (!session.jsonlPath || !existsSync(session.jsonlPath)) {
      // Issue #3143: Fall back to ACP event store for ACP sessions.
      if (this.acpEventStore) {
        try {
          return await this.readFromAcpEvents(session);
        } catch {
          return [];
        }
      }
      return [];
    }
    const cached = this.parsedEntriesCache.get(session.id);
    try {
      const fromOffset = cached ? cached.offset : 0;
      const result = await readNewEntries(session.jsonlPath, fromOffset);
      if (cached) {
        // #832: Detect JSONL truncation — newOffset resets to 0 when file is rewritten.
        if (fromOffset > 0 && result.newOffset === 0 && result.entries.length === 0) {
          const freshResult = await readNewEntries(session.jsonlPath, 0);
          const truncatedEntries = freshResult.entries.map(e => SessionTranscripts.truncateEntryText(e));
          const estBytes = this.estimateCacheBytes(truncatedEntries);
          this.parsedEntriesCache.set(session.id, { entries: truncatedEntries, offset: freshResult.newOffset, estimatedBytes: estBytes });
          return freshResult.entries; // Return untruncated to callers
        }
        // Issue #3762: Truncate before caching to reduce memory
        const truncatedNew = result.entries.map(e => SessionTranscripts.truncateEntryText(e));
        cached.entries.push(...truncatedNew);
        cached.offset = result.newOffset;
        cached.estimatedBytes = this.estimateCacheBytes(cached.entries);
        // #424: Evict oldest entries when cache exceeds per-session cap
        if (cached.entries.length > SessionTranscripts.MAX_CACHE_ENTRIES_PER_SESSION) {
          cached.entries.splice(0, cached.entries.length - SessionTranscripts.MAX_CACHE_ENTRIES_PER_SESSION);
          cached.estimatedBytes = this.estimateCacheBytes(cached.entries);
        }
        // Issue #3762: Evict other sessions if total cache exceeds budget
        this.evictIfNeeded();
        return cached.entries;
      }
      // First read — cache with truncated entries
      const truncatedEntries = result.entries.map(e => SessionTranscripts.truncateEntryText(e));
      const estBytes = this.estimateCacheBytes(truncatedEntries);
      this.parsedEntriesCache.set(session.id, { entries: truncatedEntries, offset: result.newOffset, estimatedBytes: estBytes });
      this.evictIfNeeded();
      return result.entries; // Return untruncated to callers
    } catch { /* JSONL read failed — return cached entries or empty */
      return cached ? [...cached.entries] : [];
    }
  }

  /**
   * Issue #3863: Read full (untruncated) entries from JSONL for API transcript endpoints.
   * Unlike getCachedEntries(), this reads directly from disk and does not truncate text,
   * ensuring API consumers get complete assistant messages.
   */
  private async getFullEntries(session: SessionInfo): Promise<ParsedEntry[]> {
    // Discover JSONL path if not yet known (Issue #884: worktree-aware)
    // ADR-0034 M4: Skip CC JSONL discovery for non-claude-code runners.
    if (this.isCcSession(session) && !session.jsonlPath && session.claudeSessionId) {
      const path = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
      if (path) {
        session.jsonlPath = path;
        session.byteOffset = 0;
      }
    }

    if (!session.jsonlPath || !existsSync(session.jsonlPath)) {
      // Issue #3143: Fall back to ACP event store for ACP sessions.
      if (this.acpEventStore) {
        try {
          return await this.readFromAcpEvents(session);
        } catch {
          return [];
        }
      }
      return [];
    }

    try {
      const result = await readNewEntries(session.jsonlPath, 0, true);
      return result.entries;
    } catch {
      // Fall back to cache (may be truncated, but better than nothing)
      const cached = this.parsedEntriesCache.get(session.id);
      return cached ? [...cached.entries] : [];
    }
  }

  /**
   * Issue #1768: Filesystem fallback when claudeSessionId was never discovered.
   * Scans the project hash directory for JSONL files newer than the session's
   * creation time, matching the logic in SessionDiscovery.maybeDiscoverFromFilesystem.
   */
  private async discoverFromFilesystemFallback(session: SessionInfo): Promise<void> {
    if (session.jsonlPath || !session.workDir) return;

    const projectHash = computeProjectHash(session.workDir);
    const projectDir = join(this.config.claudeProjectsDir, projectHash);
    if (!existsSync(projectDir)) return;

    try {
      const files = await readdir(projectDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl') && !f.startsWith('.'));

      for (const file of jsonlFiles) {
        const filePath = join(projectDir, file);
        const fileStat = await stat(filePath);

        // Only consider files created after the session
        if (fileStat.mtimeMs < session.createdAt) continue;

        // Extract session ID from filename (filename = sessionId.jsonl)
        const sessionId = file.replace('.jsonl', '');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) continue;

        session.claudeSessionId = sessionId;
        session.jsonlPath = filePath;
        // Issue #2537: Reset both offsets to 0 when discovering a new JSONL path.
        // Using `?? 0` preserved stale offsets from persisted state or prior reads,
        // causing /read to return empty messages despite the JSONL having content.
        session.byteOffset = 0;
        session.monitorOffset = 0;
        log.info({ component: 'session-transcripts', operation: 'fallbackMapping', attributes: { displayName: session.displayName, sessionId: sessionId.slice(0, 8) } });
        return;
      }
    } catch {
      // Directory read failed — best effort
    }
  }

  /** ADR-0034 M4: True only for runners that produce CC-format JSONL transcripts. */
  private isCcSession(session: SessionInfo): boolean {
    return session.runnerName === undefined || session.runnerName === 'claude-code';
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
