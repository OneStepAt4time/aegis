/**
 * JsonFileStore.ts — JSON file-backed session state store.
 *
 * Reads/writes state.json on disk using atomic writes (tmp + rename).
 * This is the default persistence backend and the one extracted from
 * SessionManager's original inline file I/O.
 *
 * Issue #1937: Pluggable SessionStore interface.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { LifecycleService, ServiceHealth } from '../../container.js';
import type {
  StateStore,
  SerializedSessionInfo,
  SerializedSessionState,
} from './state-store.js';

/** Configuration for the JSON file store. */
export interface JsonFileStoreConfig {
  /** Directory where state.json is stored. */
  stateDir: string;
}

/**
 * File-backed implementation of StateStore.
 *
 * Persists all session state to a single state.json file with atomic writes.
 * Includes backup (.bak) fallback for crash recovery.
 */
export class JsonFileStore implements StateStore {
  private readonly stateDir: string;
  private readonly stateFile: string;

  constructor(config: JsonFileStoreConfig) {
    this.stateDir = config.stateDir;
    this.stateFile = join(config.stateDir, 'state.json');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!existsSync(this.stateDir)) {
      await mkdir(this.stateDir, { recursive: true });
    }
    this.cleanTmpFiles();
  }

  async stop(): Promise<void> {
    // Nothing to do — saves are explicit via save()
  }

  async health(): Promise<ServiceHealth> {
    try {
      if (!existsSync(this.stateDir)) {
        return { healthy: false, details: 'state directory missing' };
      }
      return { healthy: true, details: 'file store ok' };
    } catch (err) {
      return { healthy: false, details: `file store: ${(err as Error).message}` };
    }
  }

  // ── StateStore interface ───────────────────────────────────────────

  async load(): Promise<SerializedSessionState> {
    this.cleanTmpFiles();

    if (existsSync(this.stateFile)) {
      try {
        const raw = await readFile(this.stateFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (this.isValidState(parsed)) {
          // Write backup of successfully loaded state
          try {
            await writeFile(`${this.stateFile}.bak`, raw);
          } catch { /* non-critical */ }
          return parsed as SerializedSessionState;
        }
      } catch { /* corrupted — try backup */ }

      // Try loading from backup
      const backupFile = `${this.stateFile}.bak`;
      if (existsSync(backupFile)) {
        try {
          const backupRaw = await readFile(backupFile, 'utf-8');
          const backupParsed = JSON.parse(backupRaw);
          if (this.isValidState(backupParsed)) {
            console.log('JsonFileStore: restored state from backup');
            return backupParsed as SerializedSessionState;
          }
        } catch { /* backup corrupted — start empty */ }
      }
    }

    // No valid state found — return empty
    return { sessions: Object.create(null) as Record<string, SerializedSessionInfo> };
  }

  async save(state: SerializedSessionState): Promise<void> {
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.stateFile}.tmp`;
    await writeFile(tmpFile, JSON.stringify(state, null, 2));
    await rename(tmpFile, this.stateFile);
  }

  async getSession(id: string): Promise<SerializedSessionInfo | undefined> {
    const state = await this.load();
    return state.sessions[id];
  }

  async putSession(id: string, session: SerializedSessionInfo): Promise<void> {
    const state = await this.load();
    state.sessions[id] = session;
    await this.save(state);
  }

  async deleteSession(id: string): Promise<void> {
    const state = await this.load();
    delete state.sessions[id];
    await this.save(state);
  }

  async listSessionIds(): Promise<string[]> {
    const state = await this.load();
    return Object.keys(state.sessions);
  }

  // ── Internal helpers ───────────────────────────────────────────────

  /** Validate that parsed data looks like a valid SerializedSessionState. */
  private isValidState(data: unknown): data is SerializedSessionState {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.sessions !== 'object' || obj.sessions === null) return false;
    const sessions = obj.sessions as Record<string, unknown>;
    for (const val of Object.values(sessions)) {
      if (typeof val !== 'object' || val === null) return false;
      const s = val as Record<string, unknown>;
      if (typeof s.id !== 'string' || typeof s.windowId !== 'string') return false;
    }
    return true;
  }

  /** Clean up stale .tmp files left by crashed writes. */
  private cleanTmpFiles(): void {
    try {
      for (const entry of readdirSync(this.stateDir)) {
        if (entry.endsWith('.tmp')) {
          const fullPath = join(this.stateDir, entry);
          try { unlinkSync(fullPath); } catch { /* best effort */ }
          console.log(`Cleaned stale tmp file: ${entry}`);
        }
      }
    } catch { /* dir may not exist yet */ }
  }
}
