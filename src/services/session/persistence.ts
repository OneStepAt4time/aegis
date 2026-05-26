import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { z } from 'zod';
import type { StateStore, SerializedSessionState, SerializedSessionInfo } from '../state/state-store.js';
import type { SessionState, SessionInfo } from '../../session.js';
import { persistedStateSchema } from '../../validation.js';
import type { SessionEncryptionService } from './encryption.js';
import { StructuredLogger } from '../../logger.js';

const log = new StructuredLogger();

function hydrateSessions(raw: z.infer<typeof persistedStateSchema>): Record<string, SessionInfo> {
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

export class SessionPersistenceService {
  constructor(
    private readonly stateFile: string,
    private readonly store: StateStore | null,
    private readonly enc: SessionEncryptionService,
  ) {}

  private isValidState(data: unknown): data is SessionState {
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

  private cleanTmpFiles(dir: string): void {
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

  serializeState(state: SessionState): string {
    return JSON.stringify(state, (key, value) => {
      if (key === 'hookSecret') {
        if (typeof value !== 'string' || !this.enc.hasKey) return undefined;
        return this.enc.encrypt(value);
      }
      if (value instanceof Set) return [...value];
      return value;
    }, 2);
  }

  serializeStateForStore(state: SessionState): SerializedSessionState {
    const sessions: Record<string, SerializedSessionInfo> = Object.create(null) as Record<string, SerializedSessionInfo>;
    for (const [id, session] of Object.entries(state.sessions)) {
      const { activeSubagents, hookSecret, ...rest } = session;
      sessions[id] = {
        ...rest,
        activeSubagents: activeSubagents ? [...activeSubagents] : undefined,
        hookSecret: (typeof hookSecret === 'string' && this.enc.hasKey)
          ? this.enc.encrypt(hookSecret)
          : undefined,
      } as unknown as SerializedSessionInfo;
    }
    return { sessions };
  }

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

    // Clean stale .tmp files from crashed writes
    this.cleanTmpFiles(dir);

    if (existsSync(this.stateFile)) {
      try {
        const raw = await readFile(this.stateFile, 'utf-8');
        const parsed = persistedStateSchema.safeParse(JSON.parse(raw));
        if (parsed.success && this.isValidState({ sessions: parsed.data })) {
          return { sessions: hydrateSessions(parsed.data) };
        }
        log.warn({ component: 'session', operation: 'stateValidationFailed' });
        const backupFile = `${this.stateFile}.bak`;
        if (existsSync(backupFile)) {
          try {
            const backupRaw = await readFile(backupFile, 'utf-8');
            const backupParsed = persistedStateSchema.safeParse(JSON.parse(backupRaw));
            if (backupParsed.success && this.isValidState({ sessions: backupParsed.data })) {
              log.info({ component: 'session', operation: 'stateRestoredFromBackup' });
              return { sessions: hydrateSessions(backupParsed.data) };
            }
          } catch { /* backup corrupted — start empty */ }
        }
      } catch { /* state file corrupted — start empty */ }
    }

    return { sessions: Object.create(null) as Record<string, SessionInfo> };
  }

  async flush(state: SessionState): Promise<void> {
    if (this.store) {
      await this.store.save(this.serializeStateForStore(state));
      return;
    }
    // Legacy file I/O path: write to temp then rename for atomicity.
    const dir = dirname(this.stateFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const tmpFile = `${this.stateFile}.tmp`;
    await writeFile(tmpFile, this.serializeState(state));
    await rename(tmpFile, this.stateFile);
  }

  async writeBackup(state: SessionState): Promise<void> {
    try {
      await writeFile(`${this.stateFile}.bak`, this.serializeState(state));
    } catch { /* non-critical */ }
  }
}

export default SessionPersistenceService;
