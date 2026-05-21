/**
 * services/squad/service.ts — Squad business logic.
 *
 * Ported from Multica's squad handler. Manages multi-agent teams:
 * - Squad CRUD (create, update, delete, list)
 * - Member management (add, remove, role assignment)
 * - Leader-based work routing
 * - Integration with TaskService for squad task dispatch
 */

import type { TaskService } from '../task-queue/service.js';
import type {
  SquadRecord,
  SquadMemberRecord,
  CreateSquadParams,
  UpdateSquadParams,
  AddSquadMemberParams,
} from './types.js';

export class SquadService {
  private readonly taskService: TaskService;
  private readonly squads: Map<string, SquadRecord> = new Map();
  private readonly members: Map<string, SquadMemberRecord> = new Map();

  constructor(taskService: TaskService) {
    this.taskService = taskService;
  }

  /** Create a new squad. */
  async create(params: CreateSquadParams): Promise<SquadRecord> {
    const record: SquadRecord = {
      id: crypto.randomUUID(),
      workspaceId: '',
      name: params.name,
      description: params.description ?? '',
      instructions: params.instructions ?? '',
      leaderId: params.leaderId,
      creatorId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
      tenantId: params.tenantId ?? null,
      ownerKeyId: params.ownerKeyId ?? null,
    };
    this.squads.set(record.id, record);

    // Add leader as a member
    await this.addMember({
      squadId: record.id,
      memberId: params.leaderId,
      role: 'leader',
    });

    // Add additional members
    if (params.memberIds) {
      for (const memberId of params.memberIds) {
        if (memberId !== params.leaderId) {
          await this.addMember({
            squadId: record.id,
            memberId,
            role: 'worker',
          });
        }
      }
    }

    return record;
  }

  /** Get squad by ID. */
  async get(id: string): Promise<SquadRecord | null> {
    return this.squads.get(id) ?? null;
  }

  /** List squads. */
  async list(filters?: { workspaceId?: string }): Promise<SquadRecord[]> {
    let results = Array.from(this.squads.values()).filter(s => !s.archivedAt);
    if (filters?.workspaceId) {
      results = results.filter(s => s.workspaceId === filters.workspaceId);
    }
    return results;
  }

  /** Update squad. */
  async update(id: string, params: UpdateSquadParams): Promise<SquadRecord | null> {
    const existing = this.squads.get(id);
    if (!existing || existing.archivedAt) return null;

    // If leader is changing, update member roles
    if (params.leaderId && params.leaderId !== existing.leaderId) {
      // Demote old leader to worker
      for (const [memberId, member] of this.members) {
        if (member.squadId === id && member.role === 'leader') {
          member.role = 'worker';
        }
      }
      // Promote new leader
      const newLeaderMember = Array.from(this.members.values()).find(
        m => m.squadId === id && m.memberId === params.leaderId,
      );
      if (newLeaderMember) {
        newLeaderMember.role = 'leader';
      } else {
        await this.addMember({ squadId: id, memberId: params.leaderId, role: 'leader' });
      }
    }

    const updated: SquadRecord = {
      ...existing,
      ...(params.name !== undefined && { name: params.name }),
      ...(params.description !== undefined && { description: params.description }),
      ...(params.instructions !== undefined && { instructions: params.instructions }),
      ...(params.leaderId !== undefined && { leaderId: params.leaderId }),
      updatedAt: new Date(),
    };
    this.squads.set(id, updated);
    return updated;
  }

  /** Archive a squad. */
  async archive(id: string): Promise<SquadRecord | null> {
    const existing = this.squads.get(id);
    if (!existing) return null;
    existing.archivedAt = new Date();
    existing.updatedAt = new Date();
    return existing;
  }

  /** Add a member to a squad. */
  async addMember(params: AddSquadMemberParams): Promise<SquadMemberRecord> {
    // Check for duplicate
    const existing = Array.from(this.members.values()).find(
      m => m.squadId === params.squadId && m.memberId === params.memberId,
    );
    if (existing) return existing;

    const record: SquadMemberRecord = {
      id: crypto.randomUUID(),
      squadId: params.squadId,
      memberType: 'agent',
      memberId: params.memberId,
      role: params.role,
      createdAt: new Date(),
    };
    this.members.set(record.id, record);
    return record;
  }

  /** Remove a member from a squad. */
  async removeMember(squadId: string, memberId: string): Promise<boolean> {
    const entry = Array.from(this.members.entries()).find(
      ([_, m]) => m.squadId === squadId && m.memberId === memberId,
    );
    if (!entry) return false;
    return this.members.delete(entry[0]);
  }

  /** List members of a squad. */
  async listMembers(squadId: string): Promise<SquadMemberRecord[]> {
    return Array.from(this.members.values()).filter(m => m.squadId === squadId);
  }

  /** Get the leader of a squad. */
  async getLeader(squadId: string): Promise<SquadMemberRecord | null> {
    return Array.from(this.members.values()).find(
      m => m.squadId === squadId && m.role === 'leader',
    ) ?? null;
  }

  /** Dispatch a task to the squad leader. */
  async dispatchToLeader(squadId: string, params: { issueId?: string; prompt?: string; autopilotRunId?: string }): Promise<import('../task-queue/types.js').TaskRecord | null> {
    const squad = this.squads.get(squadId);
    if (!squad || squad.archivedAt) return null;

    return this.taskService.enqueue({
      agentId: squad.leaderId,
      issueId: params.issueId,
      autopilotRunId: params.autopilotRunId,
      prompt: params.prompt,
      isLeaderTask: true,
      tenantId: squad.tenantId ?? undefined,
      ownerKeyId: squad.ownerKeyId ?? undefined,
    });
  }

  /** Check if an agent is a member of a squad. */
  async isMember(squadId: string, agentId: string): Promise<boolean> {
    return Array.from(this.members.values()).some(
      m => m.squadId === squadId && m.memberId === agentId,
    );
  }

  /** Get squads that an agent belongs to. */
  async getAgentSquads(agentId: string): Promise<SquadRecord[]> {
    const squadIds = new Set<string>();
    for (const member of this.members.values()) {
      if (member.memberId === agentId) {
        squadIds.add(member.squadId);
      }
    }
    return Array.from(this.squads.values()).filter(
      s => squadIds.has(s.id) && !s.archivedAt,
    );
  }
}
