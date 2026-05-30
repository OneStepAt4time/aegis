import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import type { AgentStore } from './AgentStore.js';
import type { SerializedAgentProfile } from './types.js';

export class JsonAgentStore implements AgentStore {
  private filePath: string;
  private mutex = new Mutex();

  constructor(stateDir: string) {
    this.filePath = join(stateDir, 'agents.json');
  }

  async loadAgents(): Promise<SerializedAgentProfile[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { profiles: SerializedAgentProfile[] };
      return parsed.profiles ?? [];
    } catch (err) {
      // ENOENT -> empty
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
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
    });
  }

  async getAgent(id: string): Promise<SerializedAgentProfile | undefined> {
    const all = await this.loadAgents();
    return all.find(p => p.id === id);
  }

  async putAgent(profile: SerializedAgentProfile): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const all = await this.loadAgents();
      const idx = all.findIndex(p => p.id === profile.id);
      if (idx >= 0) all[idx] = profile;
      else all.push(profile);
      await this.saveAgents(all);
    });
  }

  async deleteAgent(id: string): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const all = await this.loadAgents();
      const filtered = all.filter(p => p.id !== id);
      await this.saveAgents(filtered);
    });
  }

  async listAgentIds(): Promise<string[]> {
    const all = await this.loadAgents();
    return all.map(p => p.id);
  }
}

export default JsonAgentStore;
