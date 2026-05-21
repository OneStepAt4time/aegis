/**
 * __tests__/squad.test.ts — Squad unit tests.
 *
 * Tests CRUD, member management, leader promotion, and task dispatch.
 * Uses the TaskService with real Postgres for E2E verification.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SquadService } from '../services/squad/service.js';
import { PostgresTaskStore } from '../services/task-queue/store.js';
import { TaskService } from '../services/task-queue/service.js';

const pgUrl = process.env.AEGIS_POSTGRES_URL ?? process.env.TEST_POSTGRES_URL ?? '';
const skipIfNoDb = pgUrl ? describe : describe.skip;

const TEST_TABLE = `test_sq_tasks_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

skipIfNoDb('Squad Service', () => {
  let taskStore: PostgresTaskStore;
  let taskService: TaskService;
  let squadService: SquadService;

  beforeAll(async () => {
    taskStore = new PostgresTaskStore({ url: pgUrl, tableName: TEST_TABLE, poolMax: 2 });
    await taskStore.start();
    taskService = new TaskService(taskStore);
  });

  afterAll(async () => {
    try { await taskStore['pool'].query(`DROP TABLE IF EXISTS "public"."${TEST_TABLE}"`); } catch {}
    await taskStore.stop();
  });

  beforeEach(() => {
    squadService = new SquadService(taskService);
  });

  describe('Squad CRUD', () => {
    it('creates a squad with leader and members', async () => {
      const squad = await squadService.create({
        name: 'Backend Team',
        description: 'Handles backend services',
        instructions: 'Focus on API reliability',
        leaderId: 'agent-leader',
        memberIds: ['agent-leader', 'agent-worker-1', 'agent-worker-2'],
      });

      expect(squad.id).toBeTruthy();
      expect(squad.name).toBe('Backend Team');
      expect(squad.leaderId).toBe('agent-leader');

      const members = await squadService.listMembers(squad.id);
      expect(members.length).toBe(3);
      expect(members.find(m => m.role === 'leader')).toBeTruthy();
      expect(members.filter(m => m.role === 'worker').length).toBe(2);
    });

    it('gets squad by ID', async () => {
      const created = await squadService.create({
        name: 'Test',
        leaderId: 'agent-1',
      });

      const fetched = await squadService.get(created.id);
      expect(fetched).toBeTruthy();
      expect(fetched!.id).toBe(created.id);
    });

    it('lists squads', async () => {
      await squadService.create({ name: 'S1', leaderId: 'a1' });
      await squadService.create({ name: 'S2', leaderId: 'a2' });

      const squads = await squadService.list();
      expect(squads.length).toBe(2);
    });

    it('updates squad', async () => {
      const created = await squadService.create({ name: 'Original', leaderId: 'a1' });
      const updated = await squadService.update(created.id, {
        name: 'Updated',
        instructions: 'New instructions',
      });

      expect(updated!.name).toBe('Updated');
      expect(updated!.instructions).toBe('New instructions');
    });

    it('archives squad', async () => {
      const created = await squadService.create({ name: 'To archive', leaderId: 'a1' });
      const archived = await squadService.archive(created.id);

      expect(archived!.archivedAt).toBeTruthy();

      // Archived squads don't appear in list
      const squads = await squadService.list();
      expect(squads.find(s => s.id === created.id)).toBeUndefined();
    });
  });

  describe('Member management', () => {
    it('adds a member', async () => {
      const squad = await squadService.create({ name: 'Test', leaderId: 'a1' });
      const member = await squadService.addMember({
        squadId: squad.id,
        memberId: 'a3',
        role: 'worker',
      });

      expect(member.memberId).toBe('a3');
      expect(member.role).toBe('worker');
    });

    it('removes a member', async () => {
      const squad = await squadService.create({
        name: 'Test',
        leaderId: 'a1',
        memberIds: ['a1', 'a2'],
      });

      const removed = await squadService.removeMember(squad.id, 'a2');
      expect(removed).toBe(true);

      const members = await squadService.listMembers(squad.id);
      expect(members.length).toBe(1);
    });

    it('prevents duplicate members', async () => {
      const squad = await squadService.create({ name: 'Test', leaderId: 'a1' });
      const m1 = await squadService.addMember({ squadId: squad.id, memberId: 'a2', role: 'worker' });
      const m2 = await squadService.addMember({ squadId: squad.id, memberId: 'a2', role: 'worker' });

      // Should return existing member
      expect(m1.id).toBe(m2.id);

      const members = await squadService.listMembers(squad.id);
      expect(members.filter(m => m.memberId === 'a2').length).toBe(1);
    });

    it('gets leader of squad', async () => {
      const squad = await squadService.create({ name: 'Test', leaderId: 'agent-lead' });
      const leader = await squadService.getLeader(squad.id);

      expect(leader).toBeTruthy();
      expect(leader!.memberId).toBe('agent-lead');
      expect(leader!.role).toBe('leader');
    });
  });

  describe('Leader promotion', () => {
    it('promotes a new leader and demotes old one', async () => {
      const squad = await squadService.create({
        name: 'Test',
        leaderId: 'a1',
        memberIds: ['a1', 'a2'],
      });

      await squadService.update(squad.id, { leaderId: 'a2' });

      const members = await squadService.listMembers(squad.id);
      const leader = members.find(m => m.role === 'leader');
      const oldLeader = members.find(m => m.memberId === 'a1');

      expect(leader!.memberId).toBe('a2');
      expect(oldLeader!.role).toBe('worker');

      const squadRecord = await squadService.get(squad.id);
      expect(squadRecord!.leaderId).toBe('a2');
    });
  });

  describe('Task dispatch to leader', () => {
    it('dispatches a task to the squad leader', async () => {
      const squad = await squadService.create({
        name: 'Backend',
        leaderId: 'agent-leader',
        memberIds: ['agent-leader', 'agent-worker'],
      });

      const task = await squadService.dispatchToLeader(squad.id, {
        prompt: 'Fix the auth bug',
        issueId: 'issue-42',
      });

      expect(task).toBeTruthy();
      expect(task!.agentId).toBe('agent-leader');
      expect(task!.issueId).toBe('issue-42');
      expect(task!.prompt).toBe('Fix the auth bug');
      expect(task!.isLeaderTask).toBe(true);
    });

    it('returns null for archived squad', async () => {
      const squad = await squadService.create({ name: 'Archived', leaderId: 'a1' });
      await squadService.archive(squad.id);

      const task = await squadService.dispatchToLeader(squad.id, { prompt: 'test' });
      expect(task).toBeNull();
    });
  });

  describe('Agent squad lookup', () => {
    it('finds squads an agent belongs to', async () => {
      await squadService.create({ name: 'S1', leaderId: 'a1', memberIds: ['a1', 'a2'] });
      await squadService.create({ name: 'S2', leaderId: 'a3', memberIds: ['a3', 'a2'] });

      const squads = await squadService.getAgentSquads('a2');
      expect(squads.length).toBe(2);

      const squads1 = await squadService.getAgentSquads('a1');
      expect(squads1.length).toBe(1);
    });

    it('checks if agent is a member', async () => {
      const squad = await squadService.create({ name: 'Test', leaderId: 'a1', memberIds: ['a1', 'a2'] });

      expect(await squadService.isMember(squad.id, 'a1')).toBe(true);
      expect(await squadService.isMember(squad.id, 'a3')).toBe(false);
    });
  });
});
