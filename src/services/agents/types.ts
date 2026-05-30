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

// ── Agent Profiles — Issue #3971 ────────────────────────────────────
//
// AgentProfile extends the base Agent identity with workspace-scoped
// configuration: runtime binding, model routing, prompt customization,
// MCP config, and archive/restore lifecycle.
//
// v1 scope cuts (ADR-0029 single-tenant):
//   - visibility removed from API (field kept for forward compat)
//   - workspaceId nullable
//   - no skills endpoint
//   - no routing rules

/** Runtime mode for the agent. */
export type AgentRuntimeMode = 'claude-code' | 'daemon';

/** Thinking level for model reasoning effort. */
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

/** Agent visibility scope (v2 — not used in v1 API). */
export type AgentVisibility = 'workspace' | 'private';

/** Regex for safe agent names (Themis audit finding #2). */
export const SAFE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Environment variable entry. */
export interface EnvVar {
  key: string;
  value: string;
}

/** Agent profile — workspace-scoped configuration layer on top of Agent identity. */
export interface AgentProfile {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Referenced Agent identity (ADR-0024). */
  agentId: string;
  /** Workspace this agent belongs to (nullable in v1 — single-tenant). */
  workspaceId: string | null;

  // ── Identity ──
  /** Human-readable name (SAFE_NAME_RE validated). */
  name: string;
  /** Optional description. */
  description: string | null;
  /** Optional avatar URL. */
  avatarUrl: string | null;

  // ── Runtime configuration ──
  /** Runtime mode: claude-code (default) or daemon. */
  runtimeMode: AgentRuntimeMode;
  /** Tool-specific runtime settings. */
  runtimeConfig: Record<string, unknown>;
  /** Bound runtime ID (optional — links to a registered runtime). */
  runtimeId: string | null;

  // ── Execution settings ──
  /** Model override (null = tool default). */
  model: string | null;
  /** Thinking/reasoning level. */
  thinkingLevel: ThinkingLevel | null;
  /** Max concurrent tasks for this agent. */
  maxConcurrentTasks: number;

  // ── Prompt customization ──
  /** Custom system prompt additions. */
  instructions: string | null;
  /** Environment variables injected into agent sessions (denylist validated). */
  customEnv: EnvVar[];
  /** Extra CLI arguments passed to the agent process. */
  customArgs: string[];

  // ── MCP configuration ──
  /** MCP server definitions for this agent (allowlist validated). */
  mcpConfig: Record<string, unknown>;

  // ── Ownership ──
  /** Creator/owner API key ID (ADR-0024 ownership model). */
  ownerKeyId: string;

  // ── Lifecycle ──
  /** Timestamp (epoch ms) when agent was archived (null = active). */
  archivedAt: number | null;
  /** API key ID that archived this agent. */
  archivedBy: string | null;
  /** Timestamp (epoch ms) when agent was created. */
  createdAt: number;
  /** Timestamp (epoch ms) when agent was last updated. */
  updatedAt: number;

  // ── Integrity ──
  /** SHA-256 hash of serialized config for key rotation race protection. */
  configHash: string;
}

/** Payload for creating a new agent profile. */
export interface CreateAgentProfilePayload {
  agentId?: string;
  workspaceId?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  runtimeMode?: AgentRuntimeMode;
  runtimeConfig?: Record<string, unknown>;
  runtimeId?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  maxConcurrentTasks?: number;
  instructions?: string;
  customEnv?: EnvVar[];
  customArgs?: string[];
  mcpConfig?: Record<string, unknown>;
}

/** Payload for updating an existing agent profile. */
export interface UpdateAgentProfilePayload {
  name?: string;
  description?: string | null;
  avatarUrl?: string | null;
  runtimeMode?: AgentRuntimeMode;
  runtimeConfig?: Record<string, unknown>;
  runtimeId?: string | null;
  model?: string | null;
  thinkingLevel?: ThinkingLevel | null;
  maxConcurrentTasks?: number;
  instructions?: string | null;
  customEnv?: EnvVar[];
  customArgs?: string[];
  mcpConfig?: Record<string, unknown>;
}

/** Serialized agent profile for JSON storage. */
export interface SerializedAgentProfile {
  id: string;
  agentId: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  runtimeMode: string;
  runtimeConfig: Record<string, unknown>;
  runtimeId: string | null;
  model: string | null;
  thinkingLevel: string | null;
  maxConcurrentTasks: number;
  instructions: string | null;
  customEnv: EnvVar[];
  customArgs: string[];
  mcpConfig: Record<string, unknown>;
  ownerKeyId: string;
  archivedAt: number | null;
  archivedBy: string | null;
  createdAt: number;
  updatedAt: number;
  configHash: string;
}
