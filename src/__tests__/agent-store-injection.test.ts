import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentStore } from '../services/agents/AgentStore.js';
import { AgentProfileManager } from '../services/agents/AgentProfileManager.js';
import type { SerializedAgentProfile } from '../services/agents/types.js';

describe('AgentProfileManager uses injected AgentStore', () => {
  let calls: string[];
  let savedProfiles: SerializedAgentProfile[] = [];
  const mockStore: AgentStore = {
    async loadAgents() {
      return savedProfiles;
    },
    async saveAgents(profiles) {
      calls.push('saveAgents');
      savedProfiles = profiles;
    },
    async getAgent(id) {
      calls.push('getAgent');
      return savedProfiles.find(p => p.id === id);
    },
    async putAgent(profile) {
      calls.push('putAgent');
      const i = savedProfiles.findIndex(p => p.id === profile.id);
      if (i >= 0) savedProfiles[i] = profile;
      else savedProfiles.push(profile);
    },
    async deleteAgent(id) {
      calls.push('deleteAgent');
      savedProfiles = savedProfiles.filter(p => p.id !== id);
    },
    async listAgentIds() {
      calls.push('listAgentIds');
      return savedProfiles.map(p => p.id);
    },
  };

  beforeEach(() => {
    calls = [];
    savedProfiles = [];
  });

  it('calls putAgent on create and update', async () => {
    const manager = new AgentProfileManager(mockStore as unknown as AgentStore);
    await manager.load();
    const created = await manager.create(null, 'key-1', { name: 'uses-store' });
    expect(calls).toContain('putAgent');
    calls = [];

    const updated = await manager.update(created.id, { name: 'updated' });
    expect(calls).toContain('putAgent');
  });

  it('calls putAgent on archive/restore', async () => {
    const manager = new AgentProfileManager(mockStore as unknown as AgentStore);
    await manager.load();
    const created = await manager.create(null, 'key-1', { name: 'archive-store' });
    calls = [];
    await manager.archive(created.id, 'key-1');
    expect(calls).toContain('putAgent');
    calls = [];
    await manager.restore(created.id);
    expect(calls).toContain('putAgent');
  });
});
