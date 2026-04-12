/**
 * session-discovery.ts — JSONL discovery polling and session map synchronization.
 *
 * Extracted from SessionManager (ARC-3, #1696) to isolate discovery
 * concerns from session lifecycle management.
 */

import { existsSync } from 'node:fs';
import { readdir, stat, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { findSessionFile } from './transcript.js';
import { findSessionFileWithFanout } from './worktree-lookup.js';
import { loadContinuationPointers, type ContinuationPointerEntry } from './continuation-pointer.js';
import { computeProjectHash } from './path-utils.js';
import type { Config } from './config.js';
import type { SessionInfo } from './session.js';

/**
 * Callback interface for discovery to interact with SessionManager state
 * without taking a dependency on the full class.
 */
export interface DiscoveryDeps {
  getSession(id: string): SessionInfo | null;
  getAllSessions(): SessionInfo[];
  save(): Promise<void>;
}

/**
 * Manages JSONL discovery polling and session_map.json synchronization.
 *
 * Each session gets a coordinated poller that checks hook/session_map sync
 * and filesystem fallback on a 2-second interval, with a 5-minute timeout.
 */
export class SessionDiscovery {
  private pollTimers = new Map<string, NodeJS.Timeout>();
  /** #835: Discovery timeout timers — cleared in cleanup to prevent orphan callbacks. */
  private discoveryTimeouts = new Map<string, NodeJS.Timeout>();
  /** Next filesystem-scan time (ms epoch) for each discovery poller. */
  private discoveryNextFilesystemScanAt = new Map<string, number>();

  constructor(
    private deps: DiscoveryDeps,
    private config: Config,
    private sessionMapFile: string,
  ) {}

  /** Stop and remove the coordinated discovery poller/timer for a session. */
  stopDiscoveryPolling(id: string): void {
    const timer = this.pollTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(id);
    }

    const timeout = this.discoveryTimeouts.get(id);
    if (timeout) {
      clearTimeout(timeout);
      this.discoveryTimeouts.delete(id);
    }

    this.discoveryNextFilesystemScanAt.delete(id);
  }

  /**
   * Coordinated discovery poller for a session.
   *
   * Consolidates hook/session_map sync and filesystem fallback into a single
   * interval loop per session, reducing duplicate independent pollers.
   */
  startDiscoveryPolling(id: string, workDir: string): void {
    // If a poller already exists, replace it to ensure only one active poller/session.
    this.stopDiscoveryPolling(id);

    const interval = setInterval(async () => {
      const session = this.deps.getSession(id);
      if (!session) {
        this.stopDiscoveryPolling(id);
        return;
      }

      // Stop when we have both session ID and JSONL path.
      if (session.claudeSessionId && session.jsonlPath) {
        this.stopDiscoveryPolling(id);
        return;
      }

      try {
        await this.syncSessionMap();

        // If we have claudeSessionId but no jsonlPath, try finding it (Issue #884: worktree-aware).
        if (session.claudeSessionId && !session.jsonlPath) {
          const jsonlPath = await this.findSessionFileMaybeWorktree(session.claudeSessionId);
          if (jsonlPath) {
            session.jsonlPath = jsonlPath;
            session.byteOffset = 0;
            await this.deps.save();
          }
        }

        // Filesystem fallback scan cadence (originally every 3s).
        const now = Date.now();
        const nextFsScanAt = this.discoveryNextFilesystemScanAt.get(id) ?? 0;
        if (now >= nextFsScanAt && (!session.claudeSessionId || !session.jsonlPath)) {
          this.discoveryNextFilesystemScanAt.set(id, now + 3_000);
          await this.maybeDiscoverFromFilesystem(session, workDir);
        }

        if (session.claudeSessionId && session.jsonlPath) {
          this.stopDiscoveryPolling(id);
        }
      } catch {
        // best-effort polling; ignore transient errors
      }
    }, 2_000);

    this.pollTimers.set(id, interval);
    this.discoveryNextFilesystemScanAt.set(id, Date.now());

    // P3 fix: Stop after 5 minutes if not found, log timeout.
    // #835: Track the timeout so cleanupSession can cancel it.
    const discoveryTimeout = setTimeout(() => {
      const session = this.deps.getSession(id);
      this.stopDiscoveryPolling(id);
      if (session && !session.claudeSessionId) {
        console.log(`Discovery: session ${session.windowName} — timed out after 5min, no session_id found`);
      }
    }, 5 * 60 * 1000);
    this.discoveryTimeouts.set(id, discoveryTimeout);
  }

  /**
   * Remove stale entries from session_map.json for a given window.
   * P0 fix: Cleans by BOTH windowName AND windowId to prevent collisions.
   */
  async cleanSessionMapForWindow(windowName: string, windowId?: string): Promise<void> {
    if (!existsSync(this.sessionMapFile)) return;
    try {
      const mapData = await loadContinuationPointers(
        this.sessionMapFile,
        this.config.continuationPointerTtlMs,
      );
      let changed = false;
      for (const [key, info] of Object.entries(mapData) as [string, ContinuationPointerEntry][]) {
        // Clean by window_name (original behavior)
        if (info.window_name === windowName) {
          delete mapData[key];
          changed = true;
          continue;
        }
        // P0 fix: Also clean entries where key ends with :windowId
        // This prevents stale windowId collisions after restart
        if (windowId && key.endsWith(':' + windowId)) {
          delete mapData[key];
          changed = true;
        }
      }
      if (changed) {
        const tmpFile = `${this.sessionMapFile}.tmp`;
        await writeFile(tmpFile, JSON.stringify(mapData, null, 2));
        await rename(tmpFile, this.sessionMapFile);
      }
    } catch { /* ignore parse/write errors */ }
  }

  /**
   * Purge session_map entries that don't correspond to active aegis sessions.
   * P0 fix: After restarts, old entries with stale windowIds can cause collisions.
   */
  async purgeStaleSessionMapEntries(
    activeWindowIds: Set<string>,
    activeWindowNames: Set<string>,
  ): Promise<void> {
    if (!existsSync(this.sessionMapFile)) return;
    try {
      const mapData = await loadContinuationPointers(
        this.sessionMapFile,
        this.config.continuationPointerTtlMs,
      );
      let changed = false;
      const activeNamesLower = new Set([...activeWindowNames].map(n => n.toLowerCase()));

      for (const [key, info] of Object.entries(mapData) as [string, ContinuationPointerEntry][]) {
        // Extract windowId from key (format: "sessionName:windowId")
        const keyWindowId = key.includes(':') ? key.split(':').pop() : null;
        const windowName = (info.window_name || '').toLowerCase();

        // Keep entry only if it matches an active window
        const windowIdActive = keyWindowId && activeWindowIds.has(keyWindowId);
        const windowNameActive = activeNamesLower.has(windowName);

        if (!windowIdActive && !windowNameActive) {
          console.log(`Reconcile: purging stale session_map entry: ${key}`);
          delete mapData[key];
          changed = true;
        }
      }
      if (changed) {
        const tmpFile = `${this.sessionMapFile}.tmp`;
        await writeFile(tmpFile, JSON.stringify(mapData, null, 2));
        await rename(tmpFile, this.sessionMapFile);
      }
    } catch { /* ignore parse/write errors */ }
  }

  /** Sync CC session IDs from the hook-written session_map.json. */
  private async syncSessionMap(): Promise<void> {
    if (!existsSync(this.sessionMapFile)) return;

    try {
      const mapData = await loadContinuationPointers(
        this.sessionMapFile,
        this.config.continuationPointerTtlMs,
      );

      for (const session of this.deps.getAllSessions() as SessionInfo[]) {
        if (session.claudeSessionId) continue;

        // Find matching entry by window ID (exact match to avoid @1 matching @10, @11, etc.)
        for (const [key, info] of Object.entries(mapData) as [string, ContinuationPointerEntry][]) {
          // P0 fix: Match by exact windowId suffix (e.g., "aegis:@5"), not substring
          const keyWindowId = key.includes(':') ? key.split(':').pop() : null;
          const matchesWindowId = keyWindowId === session.windowId;
          const matchesWindowName = info.window_name === session.windowName;

          if (matchesWindowId || matchesWindowName) {
            // GUARD 1: Timestamp — reject session_map entries written before this session was created.
            const writtenAt = info.written_at || 0;
            if (writtenAt > 0 && writtenAt < session.createdAt) {
              console.log(`Discovery: session ${session.windowName} — rejecting stale entry ` +
                `(written_at ${new Date(writtenAt).toISOString()} < createdAt ${new Date(session.createdAt).toISOString()})`);
              continue;
            }

            // Use transcript_path from hook if available (M3: eliminates filesystem scan)
            let jsonlPath: string | null = null;
            if (info.transcript_path && existsSync(info.transcript_path)) {
              jsonlPath = info.transcript_path;
            } else {
              jsonlPath = await findSessionFile(info.session_id, this.config.claudeProjectsDir);
            }

            // GUARD 2: Reject paths in _archived/ directory — these are stale sessions
            if (jsonlPath && (jsonlPath.includes('/_archived/') || jsonlPath.includes('\\_archived\\'))) {
              console.log(`Discovery: session ${session.windowName} — rejecting archived path: ${jsonlPath}`);
              continue;
            }

            if (!jsonlPath) {
              continue;
            }

            // GUARD 3: JSONL mtime — reject if file was last modified before session creation.
            try {
              const fileStat = await stat(jsonlPath);
              if (fileStat.mtimeMs < session.createdAt) {
                console.log(`Discovery: session ${session.windowName} — rejecting stale JSONL ` +
                  `(mtime ${new Date(fileStat.mtimeMs).toISOString()} < createdAt ${new Date(session.createdAt).toISOString()})`);
                continue;
              }
            } catch {
              continue;
            }

            session.claudeSessionId = info.session_id;
            session.jsonlPath = jsonlPath;
            session.byteOffset = 0;
            console.log(`Discovery: session ${session.windowName} mapped to ` +
              `${info.session_id.slice(0, 8)}... (verified: timestamp + mtime)`);
            break;
          }
        }
      }
      await this.deps.save();
    } catch { /* ignore parse errors */ }
  }

  /** Attempt filesystem-based discovery for a single session poll tick. */
  private async maybeDiscoverFromFilesystem(session: SessionInfo, workDir: string): Promise<boolean> {
    const projectHash = computeProjectHash(workDir);
    const projectDir = join(this.config.claudeProjectsDir, projectHash);
    if (!existsSync(projectDir)) return false;

    const files = await readdir(projectDir);
    const jsonlFiles = files.filter(f =>
      f.endsWith('.jsonl') && !f.startsWith('.'),
    );

    for (const file of jsonlFiles) {
      const filePath = join(projectDir, file);
      const fileStat = await stat(filePath);

      // Only consider files created after the session.
      if (fileStat.mtimeMs < session.createdAt) continue;

      // Extract session ID from filename (filename = sessionId.jsonl).
      const sessionId = file.replace('.jsonl', '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(sessionId)) continue;

      session.claudeSessionId = sessionId;
      session.jsonlPath = filePath;
      session.byteOffset = 0;
      console.log(`Discovery (filesystem): session ${session.windowName} mapped to ${sessionId.slice(0, 8)}...`);
      await this.deps.save();
      return true;
    }

    return false;
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
