/**
 * __tests__/agent-profile.test.ts — Agent Profile unit tests.
 *
 * Tests CRUD, visibility, archive/restore, status, and config resolution.
 * Uses real Postgres for E2E verification.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AgentProfileService } from '../services/agent-profile/service.js';
import { PostgresAgentProfileStore } from '../services/agent-profile/store.js';

const pgUrl = process.env.AEGIS_POSTGRES_URL ?? process.env.TEST_POSTGRES_URL ?? '';
const skipIfNoDb = pgUrl ? describe : describe.skip;

const TEST_TABLE = `test_agent_profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

skipIfNoDb('Agent Profile Service', () => {
  let store: PostgresAgentProfileStore;
  let service: AgentProfileService;

  beforeAll(async () => {
    store = new PostgresAgentProfileStore({ url: pgUrl, tableName: TEST_TABLE, poolMax: 2 });
    await store.start();
  });

  afterAll(async () => {
    try { await store.pool.query(`DROP TABLE IF EXISTS "public"."${TEST_TABLE}"`); } catch {}
    await store.stop();
  });

  beforeEach(() => {
    service = new AgentProfileService(store);
  });

  describe('Create agent', () => {
    it('creates an agent with defaults', async () => {
      const agent = await service.create({ name: 'Frontend Lead' });

      expect(agent.id).toBeTruthy();
      expect(agent.name).toBe('Frontend Lead');
      expect(agent.runtimeMode).toBe('daemon');
      expect(agent.maxConcurrentTasks).toBe(1);
      expect(agent.visibility).toBe('workspace');
      expect(agent.status).toBe('unknown');
      expect(agent.archivedAt).toBeNull();
    });

    it('creates an agent with full config', async () => {
      const agent = await service.create({
        name: 'Backend Engineer',
        description: 'Handles API and database work',
        model: 'claude-sonnet-4-20250514',
        thinkingLevel: 'high',
        maxConcurrentTasks: 3,
        instructions: 'Focus on TypeScript best practices',
        customEnv: [{ key: 'NODE_ENV', value: 'production' }],
        customArgs: ['--verbose'],
        mcpConfig: { 'my-server': { command: 'node', args: ['server.js'] } },
        visibility: 'private',
        runtimeId: 'runtime-1',
      });

      expect(agent.name).toBe('Backend Engineer');
      expect(agent.model).toBe('claude-sonnet-4-20250514');
      expect(agent.thinkingLevel).toBe('high');
      expect(agent.maxConcurrentTasks).toBe(3);
      expect(agent.instructions).toBe('Focus on TypeScript best practices');
      expect(agent.customEnv).toEqual([{ key: 'NODE_ENV', value: 'production' }]);
      expect(agent.customArgs).toEqual(['--verbose']);
      expect(agent.visibility).toBe('private');
      expect(agent.runtimeId).toBe('runtime-1');
    });

    it('rejects empty name', async () => {
      await expect(service.create({ name: '' })).rejects.toThrow('name is required');
    });

    it('rejects name over 200 chars', async () => {
      await expect(service.create({ name: 'x'.repeat(201) })).rejects.toThrow('200 characters');
    });
  });

  describe('Get agent', () => {
    it('gets agent by ID', async () => {
      const created = await service.create({ name: 'Test Agent' });
      const fetched = await service.get(created.id);

      expect(fetched).toBeTruthy();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.name).toBe('Test Agent');
    });

    it('returns null for non-existent ID', async () => {
      const fetched = await service.get('nonexistent');
      expect(fetched).toBeNull();
    });
  });

  describe('List agents', () => {
    it('lists agents excluding archived', async () => {
      const a1 = await service.create({ name: 'Agent 1', workspaceId: 'ws-list-test' });
      const a2 = await service.create({ name: 'Agent 2', workspaceId: 'ws-list-test' });
      await service.archive(a1.id);

      const result = await service.list({ workspaceId: 'ws-list-test' });
      expect(result.agents.length).toBe(1);
      expect(result.agents[0].id).toBe(a2.id);
    });

    it('lists agents including archived', async () => {
      const a1 = await service.create({ name: 'Agent 1' });
      await service.archive(a1.id);

      const result = await service.list({ includeArchived: true });
      expect(result.agents.length).toBeGreaterThanOrEqual(1);
    });

    it('filters by workspace', async () => {
      await service.create({ name: 'WS Agent', workspaceId: 'ws-1' });
      await service.create({ name: 'Other Agent', workspaceId: 'ws-2' });

      const result = await service.list({ workspaceId: 'ws-1' });
      expect(result.agents.every(a => a.workspaceId === 'ws-1')).toBe(true);
    });

    it('filters by visibility for non-admin viewers', async () => {
      await service.create({ name: 'Public', visibility: 'workspace' });
      await service.create({ name: 'Private', visibility: 'private' });

      const result = await service.list({}, 'viewer');
      expect(result.agents.every(a => a.visibility === 'workspace')).toBe(true);
    });

    it('admin sees all visibility levels', async () => {
      await service.create({ name: 'Public', visibility: 'workspace' });
      await service.create({ name: 'Private', visibility: 'private' });

      const result = await service.list({}, 'admin');
      expect(result.agents.some(a => a.visibility === 'private')).toBe(true);
    });
  });

  describe('Update agent', () => {
    it('updates individual fields', async () => {
      const agent = await service.create({ name: 'Original' });
      const updated = await service.update(agent.id, {
        name: 'Updated',
        model: 'gpt-4o',
        maxConcurrentTasks: 5,
      });

      expect(updated!.name).toBe('Updated');
      expect(updated!.model).toBe('gpt-4o');
      expect(updated!.maxConcurrentTasks).toBe(5);
    });

    it('rejects update to archived agent', async () => {
      const agent = await service.create({ name: 'Archived' });
      await service.archive(agent.id);

      await expect(
        service.update(agent.id, { name: 'New Name' }),
      ).rejects.toThrow('archived');
    });

    it('rejects empty name on update', async () => {
      const agent = await service.create({ name: 'Good' });
      await expect(
        service.update(agent.id, { name: '' }),
      ).rejects.toThrow('empty');
    });

    it('returns null for non-existent agent', async () => {
      const result = await service.update('nonexistent', { name: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('Archive and restore', () => {
    it('archives an agent', async () => {
      const agent = await service.create({ name: 'To Archive' });
      const archived = await service.archive(agent.id, 'user-1');

      expect(archived).toBeTruthy();
      expect(archived!.archivedAt).toBeTruthy();
      expect(archived!.archivedBy).toBe('user-1');
    });

    it('restores an archived agent', async () => {
      const agent = await service.create({ name: 'To Restore' });
      await service.archive(agent.id);

      const restored = await service.restore(agent.id);
      expect(restored).toBeTruthy();
      expect(restored!.archivedAt).toBeNull();
      expect(restored!.archivedBy).toBeNull();
    });

    it('returns null when archiving non-existent agent', async () => {
      const result = await service.archive('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when restoring non-archived agent', async () => {
      const agent = await service.create({ name: 'Active' });
      const result = await service.restore(agent.id);
      expect(result).toBeNull();
    });
  });

  describe('Status tracking', () => {
    it('updates agent status', async () => {
      const agent = await service.create({ name: 'Status Test' });
      const updated = await service.updateStatus(agent.id, 'online');

      expect(updated!.status).toBe('online');
    });
  });

  describe('Config resolution', () => {
    it('resolves agent config for task dispatch', async () => {
      const agent = await service.create({
        name: 'Config Test',
        model: 'claude-sonnet-4-20250514',
        thinkingLevel: 'medium',
        instructions: 'Be helpful',
        customEnv: [{ key: 'API_KEY', value: 'secret' }],
        customArgs: ['--json'],
        mcpConfig: { server: { command: 'node' } },
        maxConcurrentTasks: 3,
      });

      const config = await service.resolveConfig(agent.id);

      expect(config).toBeTruthy();
      expect(config!.model).toBe('claude-sonnet-4-20250514');
      expect(config!.thinkingLevel).toBe('medium');
      expect(config!.instructions).toBe('Be helpful');
      expect(config!.customEnv).toEqual([{ key: 'API_KEY', value: 'secret' }]);
      expect(config!.customArgs).toEqual(['--json']);
      expect(config!.maxConcurrentTasks).toBe(3);
    });

    it('returns null for archived agent config', async () => {
      const agent = await service.create({ name: 'Archived' });
      await service.archive(agent.id);

      const config = await service.resolveConfig(agent.id);
      expect(config).toBeNull();
    });
  });

  describe('Task acceptance', () => {
    it('accepts task when under limit', async () => {
      const agent = await service.create({ name: 'Worker', maxConcurrentTasks: 3 });
      const canAccept = await service.canAcceptTask(agent.id, 2);
      expect(canAccept).toBe(true);
    });

    it('rejects task at limit', async () => {
      const agent = await service.create({ name: 'Worker', maxConcurrentTasks: 3 });
      const canAccept = await service.canAcceptTask(agent.id, 3);
      expect(canAccept).toBe(false);
    });

    it('rejects task for archived agent', async () => {
      const agent = await service.create({ name: 'Archived' });
      await service.archive(agent.id);
      const canAccept = await service.canAcceptTask(agent.id, 0);
      expect(canAccept).toBe(false);
    });
  });
});
