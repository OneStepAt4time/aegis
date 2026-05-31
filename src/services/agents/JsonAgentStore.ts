import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import type { AgentStore } from './AgentStore.js';
import type { SerializedAgentProfile } from './types.js';

export class JsonAgentStore implements AgentStore {
  private filePath: string;
  private mutex = new Mutex();
  private cache: SerializedAgentProfile[] | null = null;
  private dirty = false;

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'agents.json');
  }

  async loadAgents(): Promise<SerializedAgentProfile[]> {
    // If cache is warm, return it (avoids re-reading disk)
    if (this.cache !== null) {
      return [...this.cache];
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { profiles: SerializedAgentProfile[] };
      this.cache = parsed.profiles ?? [];
      return [...this.cache];
    } catch (err) {
      // ENOENT -> empty
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = [];
        return [];
      }
      throw err;
    }
  }

  async saveAgents(profiles: SerializedAgentProfile[]): Promise<void> {
    return this.mutex.runExclusive(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${randomUUID()}.tmp`;
      const data = JSON.stringify({ profiles }, null, 2);
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.filePath);
      this.cache = [...profiles];
      this.dirty = false;
    });
  }

  async getAgent(id: string): Promise<SerializedAgentProfile | undefined> {
    const all = await this.loadAgents();
    return all.find(p => p.id === id);
  }

  async putAgent(profile: SerializedAgentProfile): Promise<void> {
    return this.mutex.runExclusive(async () => {
      // Use cache if warm, otherwise load from disk
      const all = this.cache !== null ? [...this.cache] : await this.loadAgents();
      const idx = all.findIndex(p => p.id === profile.id);
      if (idx >= 0) all[idx] = profile;
      else all.push(profile);
      this.cache = all;
      this.dirty = true;
      await this.flushLocked();
    });
  }

  async deleteAgent(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const all = this.cache !== null ? [...this.cache] : await this.loadAgents();
      const filtered = all.filter(p => p.id !== id);
      this.cache = filtered;
      this.dirty = true;
      await this.flushLocked();
    });
  }

  async listAgentIds(): Promise<string[]> {
    const all = await this.loadAgents();
    return all.map(p => p.id);
  }

  /** Flush the in-memory cache to disk. Safe to call even when not dirty. */
  async flush(): Promise<void> {
    return this.mutex.runExclusive(async () => this.flushLocked());
  }

  private async flushLocked(): Promise<void> {
    if (!this.dirty || this.cache === null) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${randomUUID()}.tmp`;
    const data = JSON.stringify({ profiles: this.cache }, null, 2);
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, this.filePath);
    this.dirty = false;
  }
}

export default JsonAgentStore;
