/**
 * persistence.ts — Session persistence service.
 *
 * Extracted from SessionManager (Issue #4251 Step 1).
 * Handles loading, saving, debouncing, and serialization of session state
 * to disk (legacy JSON file) or a pluggable StateStore backend (Issue #1937).
 *
 * Zero behavior changes — pure refactoring.
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { StateStore, SerializedSessionState, SerializedSessionInfo } from '../state/state-store.js';
import { StructuredLogger } from '../../logger.js';
import type { z } from 'zod';
import { persistedStateSchema } from '../../validation.js';
import type { SessionInfo, SessionState } from '../../session.js';

const log = new StructuredLogger();

/** Port interface for session persistence operations. */
export interface SessionPersistencePort {
  load(): Promise<SessionState>;
  save(state: SessionState): Promise<void>;
  debouncedSave(state: SessionState): void;
  cancelDebouncedSave(): void;
}

/** Hydrate raw parsed data into SessionState with Set hydration. */
export function hydrateSessions(raw: z.infer<typeof persistedStateSchema>): Record<string, SessionInfo> {
  const sessions: Record<string, SessionInfo> = Object.create(null);
  for (const [id, s] of Object.entries(raw)) {
    const { activeSubagents, displayName, ...rest } = s as Record<string, unknown>;
    sessions[id] = {
      ...rest,
      displayName: (typeof (rest as Record<string, unknown>).displayName === 'string'
        ? (rest as Record<string, unknown>).displayName
        : typeof displayName === 'string' ? displayName : id.slice(0, 8)) as string,
      activeSubagents: activeSubagents ? new Set(activeSubagents as string[]) : undefined,
    } as SessionInfo;
  }
  return sessions;
}

/** Validate that parsed data looks like a valid SessionState. */
export function isValidState(data: unknown): data is SessionState {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.sessions !== 'object' || obj.sessions === null) return false;
  const sessions = obj.sessions as Record<string, unknown>;
  for (const val of Object.values(sessions)) {
    if (typeof val !== 'object' || val === null) return false;
    const s = val as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.displayName !== 'string') return false;
  }
  return true;
}

/** Clean up stale .tmp files left by crashed writes. */
export function cleanTmpFiles(dir: string): void {
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.tmp')) {
        const fullPath = join(dir, entry);
        try { unlinkSync(fullPath); } catch { /* best effort */ }
        log.info({ component: 'session', operation: 'cleanStaleTmp', attributes: { entry } });
      }
    }
  } catch { /* dir may not exist yet */ }
}

/**
 * SessionPersistenceService — extracted from SessionManager.
 *
 * Manages loading/saving/serializing session state to disk or a pluggable store.
 */
export class SessionPersistenceService implements SessionPersistencePort {
  private saveQueue: Promise<void> = Promise.resolve();
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private static readonly SAVE_DEBOUNCE_MS = 5_000;
  /** #1644: AES-256-GCM key derived from master token for encrypting hook secrets at rest. */
  private encKey: Buffer | null = null;

  constructor(
    private readonly stateFile: string,
    private readonly store: StateStore | null = null,
  ) {}

  /** Set the encryption key derived from the master token. */
  setEncryptionKey(masterToken: string): void {
    if (!masterToken) return;
    this.encKey = scryptSync(masterToken, 'aegis-hook-key-v1', 32);
  }

  /** Get the encryption key (for external decrypt operations). */
  getEncKey(): Buffer | null {
    return this.encKey;
  }

  /** Encrypt a hook secret with AES-256-GCM. Returns '<iv>:<tag>:<ciphertext>' hex. */
  encryptSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey!, iv);
    const enc = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
  }

  /** Decrypt a hook secret from AES-256-GCM '<iv>:<tag>:<ciphertext>' hex. */
  decryptSecret(encrypted: string): string | undefined {
    if (!this.encKey) return undefined;
    try {
      const parts = encrypted.split(':');
      if (parts.length !== 3) return undefined;
      const [ivHex, tagHex, encHex] = parts as [string, string, string];
      const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
    } catch {
      return undefined;
    }
  }

  /** Validate that parsed data looks like a valid SessionState. */
  private isValidState(data: unknown): data is SessionState {
    return isValidState(data);
  }

  /** Load state from disk or the configured store (Issue #1937). */
  async load(): Promise<SessionState> {
    if (this.store) {
      const serialized = await this.store.load();
      const parsed = persistedStateSchema.safeParse(serialized.sessions);
      if (parsed.success && this.isValidState({ sessions: parsed.data })) {
        return { sessions: hydrateSessions(parsed.data) };
      }
      return { sessions: Object.create(null) as Record<string, SessionInfo> };
    }

    // Legacy file I/O path.
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    cleanTmpFiles(dir);

    if (existsSync(this.stateFile)) {
      try {
        const raw = await readFile(this.stateFile, 'utf-8');
        const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
        if (parsed.success && this.isValidState({ sessions: parsed.data })) {
          return { sessions: hydrateSessions(parsed.data) };
        }
        // Validation failed — try backup
        log.warn({ component: 'session', operation: 'stateValidationFailed' });
        return await this.loadFromBackup();
      } catch {
        // State file corrupted — start empty
        return { sessions: Object.create(null) as Record<string, SessionInfo> };
      }
    }

    return { sessions: Object.create(null) as Record<string, SessionInfo> };
  }

  /** Attempt to load state from the backup file. */
  private async loadFromBackup(): Promise<SessionState> {
    const backupFile = `${this.stateFile}.bak`;
    const empty: SessionState = { sessions: Object.create(null) as Record<string, SessionInfo> };
    if (!existsSync(backupFile)) return empty;
    try {
      const backupRaw = await readFile(backupFile, 'utf-8');
      const backupParsed = persistedStateSchema.safeParse(JSON.parse(backupRaw));
      if (backupParsed.success && this.isValidState({ sessions: backupParsed.data })) {
        log.info({ component: 'session', operation: 'stateRestoredFromBackup' });
        return { sessions: hydrateSessions(backupParsed.data) };
      }
      return empty;
    } catch {
      return empty;
    }
  }

  /** Save state to disk atomically via a serialized write queue.
   *  #218: Uses a write queue to serialize concurrent saves and prevent corruption. */
  async save(state: SessionState): Promise<void> {
    this.saveQueue = this.saveQueue.then(() => this.doSave(state)).catch(e =>
      log.error({ component: 'session', operation: 'stateSaveFailed', attributes: { error: String(e) } })
    );
    await this.saveQueue;
  }

  /** #357: Debounced save — coalesces rapid successive saves into one disk write. */
  debouncedSave(state: SessionState): void {
    if (this.saveDebounceTimer !== null) clearTimeout(this.saveDebounceTimer);
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      void this.save(state).catch(e =>
        log.error({ component: 'session', operation: 'debouncedSaveFailed', attributes: { error: String(e) } })
      );
    }, SessionPersistenceService.SAVE_DEBOUNCE_MS);
  }

  /** Cancel any pending debounced save. */
  cancelDebouncedSave(): void {
    if (this.saveDebounceTimer !== null) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
  }

  /** Check if a debounced save is pending. */
  hasPendingDebounce(): boolean {
    return this.saveDebounceTimer !== null;
  }

  private async doSave(state: SessionState): Promise<void> {
    if (this.store) {
      const serialized = this.serializeStateForStore(state);
      await this.store.save(serialized);
      return;
    }
    // Legacy file I/O path.
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.stateFile}.tmp`;
    await writeFile(tmpFile, this.serializeState(state));
    await rename(tmpFile, this.stateFile);
  }

  /** Serialize state to JSON string with Set→array and hook secret encryption. */
  serializeState(state: SessionState): string {
    return JSON.stringify(state, (key, value) => {
      if (key === 'hookSecret') {
        if (typeof value !== 'string' || !this.encKey) return undefined;
        return this.encryptSecret(value);
      }
      if (value instanceof Set) return [...value];
      return value;
    }, 2);
  }

  /** Issue #1937: Serialize state for the store (Set→array, encrypt hook secrets). */
  serializeStateForStore(state: SessionState): SerializedSessionState {
    const sessions: Record<string, SerializedSessionInfo> = Object.create(null) as Record<string, SerializedSessionInfo>;
    for (const [id, session] of Object.entries(state.sessions)) {
      const { activeSubagents, hookSecret, ...rest } = session;
      sessions[id] = {
        ...rest,
        activeSubagents: activeSubagents ? [...activeSubagents] : undefined,
        hookSecret: (typeof hookSecret === 'string' && this.encKey)
          ? this.encryptSecret(hookSecret)
          : undefined,
      } as unknown as SerializedSessionInfo;
    }
    return { sessions };
  }

  /** Write a backup copy of the state file. */
  async writeBackup(state: SessionState): Promise<void> {
    try {
      await writeFile(`${this.stateFile}.bak`, this.serializeState(state));
    } catch { /* non-critical */ }
  }
}
