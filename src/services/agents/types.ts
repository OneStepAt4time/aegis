/**
 * Agent Identity Model — Issue #3999
 *
 * An Agent is a configuration entity that defines what a session CAN do.
 * It is not a running process — it's a template with capabilities,
 * constraints, and permission scoping.
 *
 * ADR: docs/adr/0024-agent-identity-model.md
 */

import type { ApiKeyRole } from '../auth/types.js';
import type { ApiKeyPermission } from '../auth/permissions.js';

/** Unique agent identifier (UUID v4). */
export type AgentId = string & { readonly __brand: unique symbol };

/** Agent lifecycle status. */
export type AgentStatus = 'active' | 'deactivated';

/** Resource constraints applied to sessions using this agent. */
export interface AgentConstraints {
  /** Max simultaneous sessions for this agent (null = unlimited). */
  maxConcurrentSessions: number | null;
  /** Max tokens (input + output) per session (null = unlimited). */
  maxTokensPerSession: number | null;
  /** Model allowlist — empty array means all models allowed. */
  allowedModels: string[];
  /** Tool denylist — tools the agent cannot use. */
  deniedTools: string[];
}

/** Agent identity — a configuration entity scoped to an API key. */
export interface Agent {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Human-readable name (e.g. "claude-code-hep", "codex-reviewer"). */
  name: string;
  /** Optional description of the agent's purpose. */
  description: string;
  /** Agent runner type (e.g. "claude-code", "codex", "gemini-cli"). */
  runnerType: string;
  /** Role inherited from creating API key, can be narrowed but never elevated. */
  role: ApiKeyRole;
  /** Permissions — subset of creating key's permissions. */
  permissions: ApiKeyPermission[];
  /** Resource constraints for sessions using this agent. */
  constraints: AgentConstraints;
  /** API key that created (and owns) this agent. */
  ownerKeyId: string;
  /** Agent lifecycle status. */
  status: AgentStatus;
  /** Timestamp (epoch ms) when agent was created. */
  createdAt: number;
  /** Timestamp (epoch ms) when agent was last updated. */
  updatedAt: number;
  /** Timestamp (epoch ms) when agent was last used by a session. */
  lastActiveAt: number | null;
  /** Extensible metadata for future use. */
  metadata: Record<string, unknown>;
}

/** Payload for creating a new agent. */
export interface CreateAgentPayload {
  name: string;
  description?: string;
  runnerType: string;
  permissions?: ApiKeyPermission[];
  constraints?: Partial<AgentConstraints>;
}

/** Payload for updating an existing agent. */
export interface UpdateAgentPayload {
  name?: string;
  description?: string;
  permissions?: ApiKeyPermission[];
  constraints?: Partial<AgentConstraints>;
}

/** Serialized agent for storage (all fields required). */
export interface SerializedAgent {
  id: string;
  name: string;
  description: string;
  runnerType: string;
  role: string;
  permissions: string[];
  constraints: AgentConstraints;
  ownerKeyId: string;
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number | null;
  metadata: Record<string, unknown>;
}
