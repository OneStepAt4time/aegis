/**
 * services/agent-profile/service.ts — Agent Profile business logic.
 *
 * Manages first-class agent entities with CRUD, visibility rules,
 * archive/restore, status tracking, and resolved config for task dispatch.
 * Ported from Multica's agent handler (1146 lines) adapted to Aegis patterns.
 */

import type { SessionEventBus } from '../../events.js';
import type {
  AgentProfileRecord,
  CreateAgentProfileParams,
  UpdateAgentProfileParams,
  AgentListFilters,
  ResolvedAgentConfig,
  AgentVisibility,
  AgentStatus,
} from './types.js';
import type { PostgresAgentProfileStore } from './store.js';

export class AgentProfileService {
  private readonly store: PostgresAgentProfileStore;
  private readonly eventBus?: SessionEventBus;

  constructor(store: PostgresAgentProfileStore, eventBus?: SessionEventBus) {
    this.store = store;
    this.eventBus = eventBus;
  }

  /** Create a new agent profile. */
  async create(params: CreateAgentProfileParams): Promise<AgentProfileRecord> {
    // Validate name
    if (!params.name || params.name.trim().length === 0) {
      throw new Error('Agent name is required');
    }
    if (params.name.length > 200) {
      throw new Error('Agent name must be 200 characters or less');
    }

    const record = await this.store.create(params);

    this.eventBus?.emit('agent:created' as any, { agentId: record.id });

    return record;
  }

  /** Get agent by ID. */
  async get(id: string): Promise<AgentProfileRecord | null> {
    return this.store.get(id);
  }

  /** List agents with filters. Respects visibility rules. */
  async list(
    filters: AgentListFilters,
    viewerRole?: 'admin' | 'operator' | 'viewer',
  ): Promise<{ agents: AgentProfileRecord[]; total: number }> {
    const result = await this.store.list(filters);

    // Filter by visibility if viewer is not admin/operator
    if (viewerRole && viewerRole !== 'admin' && viewerRole !== 'operator') {
      result.agents = result.agents.filter(a => a.visibility === 'workspace');
    }

    return result;
  }

  /** Update an agent profile. */
  async update(id: string, params: UpdateAgentProfileParams): Promise<AgentProfileRecord | null> {
    const existing = await this.store.get(id);
    if (!existing) return null;
    if (existing.archivedAt) throw new Error('Cannot update archived agent');

    if (params.name !== undefined && params.name.trim().length === 0) {
      throw new Error('Agent name cannot be empty');
    }

    return this.store.update(id, params);
  }

  /** Archive an agent (soft delete). */
  async archive(id: string, archivedBy?: string): Promise<AgentProfileRecord | null> {
    const record = await this.store.archive(id, archivedBy);
    if (record) {
      this.eventBus?.emit('agent:archived' as any, { agentId: id });
    }
    return record;
  }

  /** Restore an archived agent. */
  async restore(id: string): Promise<AgentProfileRecord | null> {
    const record = await this.store.restore(id);
    if (record) {
      this.eventBus?.emit('agent:restored' as any, { agentId: id });
    }
    return record;
  }

  /** Update agent status (from runtime heartbeat). */
  async updateStatus(id: string, status: AgentStatus): Promise<AgentProfileRecord | null> {
    const record = await this.store.updateStatus(id, status);
    if (record) {
      this.eventBus?.emit('agent:status' as any, { agentId: id, status });
    }
    return record;
  }

  /** Resolve agent config for task dispatch. */
  async resolveConfig(id: string): Promise<ResolvedAgentConfig | null> {
    const agent = await this.store.get(id);
    if (!agent || agent.archivedAt) return null;

    return {
      model: agent.model,
      thinkingLevel: agent.thinkingLevel,
      instructions: agent.instructions,
      customEnv: agent.customEnv,
      customArgs: agent.customArgs,
      mcpConfig: agent.mcpConfig,
      maxConcurrentTasks: agent.maxConcurrentTasks,
    };
  }

  /** Check if agent can accept more concurrent tasks. */
  async canAcceptTask(id: string, currentTaskCount: number): Promise<boolean> {
    const agent = await this.store.get(id);
    if (!agent || agent.archivedAt) return false;
    return currentTaskCount < agent.maxConcurrentTasks;
  }
}
