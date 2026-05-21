/**
 * services/agent-profile/types.ts — Agent Profile domain types.
 *
 * Ported from Multica's agent model. Agents are first-class entities:
 * named, configured, skill-bearing runtimes that own tasks and participate
 * in squads. This is the foundation for all multi-agent features.
 */

/** Agent visibility. */
export type AgentVisibility = 'workspace' | 'private';

/** Runtime mode. */
export type RuntimeMode = 'daemon' | 'cloud';

/** Thinking level. */
export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high';

/** Agent status (derived from runtime heartbeat). */
export type AgentStatus = 'online' | 'offline' | 'unknown';

/** Agent profile record. */
export interface AgentProfileRecord {
  id: string;
  workspaceId: string;

  // Identity
  name: string;
  description: string | null;
  avatarUrl: string | null;

  // Runtime configuration
  runtimeMode: RuntimeMode;
  runtimeConfig: Record<string, unknown>;
  runtimeId: string | null;

  // Execution settings
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  maxConcurrentTasks: number;

  // Prompt customization
  instructions: string | null;
  customEnv: Array<{ key: string; value: string }>;
  customArgs: string[];

  // MCP configuration
  mcpConfig: Record<string, unknown>;

  // Visibility
  visibility: AgentVisibility;
  ownerId: string | null;

  // Lifecycle
  status: AgentStatus;
  archivedAt: Date | null;
  archivedBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  // Tenant
  tenantId: string | null;
  ownerKeyId: string | null;
}

/** Agent skill summary (embedded in agent response). */
export interface AgentSkillSummary {
  id: string;
  name: string;
  description: string;
}

/** Create agent params. */
export interface CreateAgentProfileParams {
  name: string;
  description?: string;
  avatarUrl?: string;
  runtimeMode?: RuntimeMode;
  runtimeConfig?: Record<string, unknown>;
  runtimeId?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  maxConcurrentTasks?: number;
  instructions?: string;
  customEnv?: Array<{ key: string; value: string }>;
  customArgs?: string[];
  mcpConfig?: Record<string, unknown>;
  visibility?: AgentVisibility;
  ownerId?: string;
  workspaceId?: string;
  tenantId?: string;
  ownerKeyId?: string;
}

/** Update agent params. */
export interface UpdateAgentProfileParams {
  name?: string;
  description?: string;
  avatarUrl?: string;
  runtimeMode?: RuntimeMode;
  runtimeConfig?: Record<string, unknown>;
  runtimeId?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  maxConcurrentTasks?: number;
  instructions?: string;
  customEnv?: Array<{ key: string; value: string }>;
  customArgs?: string[];
  mcpConfig?: Record<string, unknown>;
  visibility?: AgentVisibility;
}

/** Agent list filters. */
export interface AgentListFilters {
  workspaceId?: string;
  visibility?: AgentVisibility;
  status?: AgentStatus;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

/** Agent config resolved for task dispatch. */
export interface ResolvedAgentConfig {
  model: string | null;
  thinkingLevel: ThinkingLevel | null;
  instructions: string | null;
  customEnv: Array<{ key: string; value: string }>;
  customArgs: string[];
  mcpConfig: Record<string, unknown>;
  maxConcurrentTasks: number;
}
