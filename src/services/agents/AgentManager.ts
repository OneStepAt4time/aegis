/**
 * AgentManager — Issue #3999
 *
 * CRUD operations for agent identities. File-based storage consistent
 * with Aegis solo-dev patterns (see FileAcpLocalStorageProfile).
 *
 * ADR: docs/adr/0024-agent-identity-model.md
 */

import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { logger } from '../../logger.js';
import type { ApiKey, ApiKeyRole } from '../auth/types.js';
import type { ApiKeyPermission } from '../auth/permissions.js';
import { normalizePermissions, permissionsForRole } from '../auth/permissions.js';
import type {
  Agent,
  AgentConstraints,
  AgentId,
  AgentStatus,
  CreateAgentPayload,
  SerializedAgent,
  UpdateAgentPayload,
} from './types.js';

const DEFAULT_CONSTRAINTS: AgentConstraints = {
  maxConcurrentSessions: null,
  maxTokensPerSession: null,
  allowedModels: [],
  deniedTools: [],
};

export class AgentManager {
  private filePath: string;
  private agents = new Map<string, Agent>();
  private loaded = false;

  constructor(dataDir: string) {
    this.filePath = `${dataDir}/agents.json`;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const data = JSON.parse(raw) as { agents: SerializedAgent[] };
      this.agents.clear();
      for (const s of data.agents) {
        this.agents.set(s.id, deserializeAgent(s));
      }
    } catch (err) {
      // File doesn't exist yet — start empty
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.agents.clear();
    }
    this.loaded = true;
    logger.info({
      component: 'agents',
      operation: 'loaded',
      attributes: { count: this.agents.size },
    });
  }

  private async persist(): Promise<void> {
    const data = { agents: [...this.agents.values()].map(serializeAgent) };
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(data, null, 2));
  }

  // ── CRUD ─────────────────────────────────────────────────────────

  async create(owner: ApiKey, payload: CreateAgentPayload): Promise<Agent> {
    if (!this.loaded) throw new Error('AgentManager not loaded');

    // Permissions: subset of owner's permissions
    const requestedPerms = payload.permissions ?? permissionsForRole(owner.role);
    const allowedPerms = new Set<ApiKeyPermission>(owner.permissions);
    const permissions = normalizePermissions(requestedPerms.filter(p => allowedPerms.has(p)));

    const now = Date.now();
    const agent: Agent = {
      id: randomUUID(),
      name: payload.name,
      description: payload.description ?? '',
      runnerType: payload.runnerType,
      role: owner.role,
      permissions,
      constraints: { ...DEFAULT_CONSTRAINTS, ...payload.constraints },
      ownerKeyId: owner.id,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: null,
      metadata: {},
    };

    this.agents.set(agent.id, agent);
    await this.persist();

    logger.info({
      component: 'agents',
      operation: 'created',
      attributes: { agentId: agent.id, name: agent.name, runnerType: agent.runnerType },
    });

    return agent;
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  list(options?: { ownerKeyId?: string; status?: AgentStatus }): Agent[] {
    let result = [...this.agents.values()];
    if (options?.ownerKeyId) {
      result = result.filter(a => a.ownerKeyId === options.ownerKeyId);
    }
    if (options?.status) {
      result = result.filter(a => a.status === options.status);
    }
    return result;
  }

  async update(agentId: string, payload: UpdateAgentPayload, requester: ApiKey): Promise<Agent> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AgentNotFoundError(agentId);
    if (agent.ownerKeyId !== requester.id && requester.role !== 'admin') {
      throw new AgentPermissionDeniedError(agentId, 'update');
    }

    // Permissions: still subset of owner key
    if (payload.permissions) {
      const allowedPerms = new Set<ApiKeyPermission>(requester.permissions);
      agent.permissions = normalizePermissions(payload.permissions.filter(p => allowedPerms.has(p)));
    }

    if (payload.name !== undefined) agent.name = payload.name;
    if (payload.description !== undefined) agent.description = payload.description;
    if (payload.constraints) {
      agent.constraints = { ...agent.constraints, ...payload.constraints };
    }

    agent.updatedAt = Date.now();
    await this.persist();
    return agent;
  }

  async deactivate(agentId: string, requester: ApiKey): Promise<Agent> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AgentNotFoundError(agentId);
    if (agent.ownerKeyId !== requester.id && requester.role !== 'admin') {
      throw new AgentPermissionDeniedError(agentId, 'deactivate');
    }
    if (agent.status === 'deactivated') return agent;

    agent.status = 'deactivated';
    agent.updatedAt = Date.now();
    await this.persist();

    logger.info({
      component: 'agents',
      operation: 'deactivated',
      attributes: { agentId },
    });

    return agent;
  }

  // ── Session binding ──────────────────────────────────────────────

  /** Validate that an agent can be used by the given key for a new session. */
  validateForSession(agentId: string, ownerKey: ApiKey): Agent {
    const agent = this.agents.get(agentId);
    if (!agent) throw new AgentNotFoundError(agentId);
    if (agent.status !== 'active') throw new AgentDeactivatedError(agentId);
    if (agent.ownerKeyId !== ownerKey.id && ownerKey.role !== 'admin') {
      throw new AgentPermissionDeniedError(agentId, 'use');
    }
    return agent;
  }

  /** Get count of active sessions using this agent. Caller provides the count. */
  activeSessionCount(agentId: string): number {
    // Placeholder — will be wired to session store in follow-up
    void agentId;
    return 0;
  }
}

// ── Serialization ──────────────────────────────────────────────

function serializeAgent(agent: Agent): SerializedAgent {
  return {
    ...agent,
    permissions: [...agent.permissions],
    constraints: { ...agent.constraints },
  };
}

function deserializeAgent(s: SerializedAgent): Agent {
  return {
    ...s,
    role: s.role as ApiKeyRole,
    permissions: [...s.permissions] as ApiKeyPermission[],
    constraints: { ...s.constraints },
  };
}

// ── Errors ─────────────────────────────────────────────────────

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

export class AgentDeactivatedError extends Error {
  constructor(agentId: string) {
    super(`Agent is deactivated: ${agentId}`);
    this.name = 'AgentDeactivatedError';
  }
}

export class AgentPermissionDeniedError extends Error {
  constructor(agentId: string, action: string) {
    super(`Permission denied to ${action} agent: ${agentId}`);
    this.name = 'AgentPermissionDeniedError';
  }
}
