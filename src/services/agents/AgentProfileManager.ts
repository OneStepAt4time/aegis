/**
 * AgentProfileManager — Issue #3971
 *
 * CRUD operations for agent profiles. Persistence is delegated to an
 * AgentStore implementation (file-based, Postgres, etc.). Manager keeps
 * in-memory cache and business logic (validation, configHash, archive/restore).
 */

import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Mutex } from 'async-mutex';
import { logger } from '../../logger.js';
import { ENV_DENYLIST, ENV_DANGEROUS_PREFIXES, ENV_NAME_RE, hasControlChars, ENV_VALUE_MAX_BYTES } from '../../validation.js';
import type {
  AgentProfile,
  CreateAgentProfilePayload,
  EnvVar,
  SerializedAgentProfile,
  UpdateAgentProfilePayload,
} from './types.js';
import { SAFE_NAME_RE } from './types.js';
import type AgentStore from './AgentStore.js';



function cloneProfile(p: AgentProfile): AgentProfile {
  return {
    ...p,
    runtimeConfig: { ...p.runtimeConfig },
    customEnv: [...p.customEnv],
    customArgs: [...p.customArgs],
    mcpConfig: { ...p.mcpConfig },
  };
}
// ── Env validation (reuses denylist from validation.ts) ─────────

const DENY_SET = new Set(ENV_DENYLIST);
const DANGEROUS_PREFIXES = [...ENV_DANGEROUS_PREFIXES];

function validateEnvVars(envVars: EnvVar[]): void {
  for (const { key, value } of envVars) {
    // Check dangerous prefixes (case-insensitive)
    const matchedPrefix = DANGEROUS_PREFIXES.find(p => key.toLowerCase().startsWith(p));
    if (matchedPrefix) {
      throw new AgentProfileEnvError(key, `cannot override dangerous prefix "${matchedPrefix}"`);
    }
    // Name format
    if (!ENV_NAME_RE.test(key)) {
      throw new AgentProfileEnvError(key, `name must match ${ENV_NAME_RE.source}`);
    }
    // Denylist
    if (DENY_SET.has(key)) {
      throw new AgentProfileEnvError(key, 'denylisted');
    }
    // Value hardening
    if (/[\r\n]/.test(value)) {
      throw new AgentProfileEnvError(key, 'value contains CR/LF');
    }
    if (hasControlChars(value)) {
      throw new AgentProfileEnvError(key, 'value contains control characters');
    }
    if (Buffer.byteLength(value, 'utf-8') > ENV_VALUE_MAX_BYTES) {
      throw new AgentProfileEnvError(key, `value exceeds ${ENV_VALUE_MAX_BYTES} byte limit`);
    }
  }
}

// ── Config hash ────────────────────────────────────────────────

function computeConfigHash(profile: Omit<AgentProfile, 'configHash' | 'updatedAt'>): string {
  // Hash the core config fields — excludes timestamps and the hash itself
  const hashInput = JSON.stringify({
    id: profile.id,
    agentId: profile.agentId,
    workspaceId: profile.workspaceId,
    name: profile.name,
    runtimeMode: profile.runtimeMode,
    runtimeConfig: profile.runtimeConfig,
    runnerName: profile.runnerName,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    maxConcurrentTasks: profile.maxConcurrentTasks,
    instructions: profile.instructions,
    customEnv: profile.customEnv,
    customArgs: profile.customArgs,
    mcpConfig: profile.mcpConfig,
    ownerKeyId: profile.ownerKeyId,
  });
  return createHash('sha256').update(hashInput).digest('hex');
}

export interface ListProfilesOptions {
  /** Include archived profiles (default: false). */
  includeArchived?: boolean;
}

export class AgentProfileManager {
  private store: AgentStore;
  private profiles = new Map<string, AgentProfile>();
  private loaded = false;
  private readonly writeMutex = new Mutex();

  constructor(store: AgentStore) {
    this.store = store;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async load(): Promise<void> {
    const data = await this.store.loadAgents();
    this.profiles.clear();
    for (const s of data) {
      this.profiles.set(s.id, deserializeProfile(s));
    }
    this.loaded = true;
    logger.info({
      component: 'agent-profiles',
      operation: 'loaded',
      attributes: { count: this.profiles.size },
    });
  }

  // Persist helpers delegate to the injected store
  private async putSerialized(profile: AgentProfile): Promise<void> {
    await this.store.putAgent(serializeProfile(profile));
  }

  // ── CRUD ─────────────────────────────────────────────────────────

  async create(
    workspaceId: string | null,
    ownerKeyId: string,
    payload: CreateAgentProfilePayload,
  ): Promise<AgentProfile> {
    return this.writeMutex.runExclusive(async () => {
      if (!this.loaded) throw new Error('AgentProfileManager not loaded');

    // Name validation (Themis finding #2: model layer)
    if (!SAFE_NAME_RE.test(payload.name)) {
      throw new AgentProfileNameError(payload.name);
    }

    // Env validation (Themis finding #3: write time)
    if (payload.customEnv?.length) {
      validateEnvVars(payload.customEnv);
    }

    const now = Date.now();
    const profileBase: Omit<AgentProfile, 'configHash' | 'updatedAt'> = {
      id: randomUUID(),
      agentId: payload.agentId ?? randomUUID(),
      workspaceId: workspaceId ?? null,
      name: payload.name,
      description: payload.description ?? null,
      avatarUrl: payload.avatarUrl ?? null,
      runtimeMode: payload.runtimeMode ?? 'claude-code',
      runtimeConfig: payload.runtimeConfig ?? {},
      runnerName: payload.runnerName ?? 'claude-code',
      model: payload.model ?? null,
      thinkingLevel: payload.thinkingLevel ?? null,
      maxConcurrentTasks: payload.maxConcurrentTasks ?? 1,
      instructions: payload.instructions ?? null,
      customEnv: payload.customEnv ?? [],
      customArgs: payload.customArgs ?? [],
      mcpConfig: payload.mcpConfig ?? {},
      ownerKeyId,
      archivedAt: null,
      archivedBy: null,
      createdAt: now,
    };

    const configHash = computeConfigHash(profileBase);
    const profile: AgentProfile = {
      ...profileBase,
      updatedAt: now,
      configHash,
    };

    this.profiles.set(profile.id, profile);
    await this.putSerialized(profile);

    logger.info({
      component: 'agent-profiles',
      operation: 'created',
      attributes: { profileId: profile.id, name: profile.name, agentId: profile.agentId },
    });

      return cloneProfile(profile);
    });
  }

  get(profileId: string): AgentProfile | undefined {
    const p = this.profiles.get(profileId);
    return p ? cloneProfile(p) : undefined;
  }

  /**
   * List profiles, excluding archived by default.
   * v1: no visibility filtering (single-tenant).
   */
  list(opts?: ListProfilesOptions): AgentProfile[] {
    let result = [...this.profiles.values()];

    if (!opts?.includeArchived) {
      result = result.filter(p => p.archivedAt === null);
    }

    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async update(
    profileId: string,
    payload: UpdateAgentProfilePayload,
  ): Promise<AgentProfile> {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new AgentProfileNotFoundError(profileId);
    if (profile.archivedAt !== null) {
      throw new AgentProfileArchivedError(profileId);
    }

    // Name validation (Themis finding #2: model layer)
    if (payload.name !== undefined && !SAFE_NAME_RE.test(payload.name)) {
      throw new AgentProfileNameError(payload.name);
    }

    // Env validation (Themis finding #3: write time)
    if (payload.customEnv?.length) {
      validateEnvVars(payload.customEnv);
    }

    if (payload.name !== undefined) profile.name = payload.name;
    if (payload.description !== undefined) profile.description = payload.description;
    if (payload.avatarUrl !== undefined) profile.avatarUrl = payload.avatarUrl;
    if (payload.runtimeMode !== undefined) profile.runtimeMode = payload.runtimeMode;
    if (payload.runtimeConfig !== undefined) profile.runtimeConfig = payload.runtimeConfig;
    if (payload.runnerName !== undefined) profile.runnerName = payload.runnerName;
    if (payload.model !== undefined) profile.model = payload.model;
    if (payload.thinkingLevel !== undefined) profile.thinkingLevel = payload.thinkingLevel;
    if (payload.maxConcurrentTasks !== undefined) profile.maxConcurrentTasks = payload.maxConcurrentTasks;
    if (payload.instructions !== undefined) profile.instructions = payload.instructions;
    if (payload.customEnv !== undefined) profile.customEnv = payload.customEnv;
    if (payload.customArgs !== undefined) profile.customArgs = payload.customArgs;
    if (payload.mcpConfig !== undefined) profile.mcpConfig = payload.mcpConfig;

    return this.writeMutex.runExclusive(async () => {
      profile.updatedAt = Date.now();
      // Recompute config hash on any update
      const { configHash: _old, updatedAt: _ts, ...base } = profile;
      profile.configHash = computeConfigHash(base as Omit<AgentProfile, 'configHash' | 'updatedAt'>);

      await this.putSerialized(profile);
      return cloneProfile(profile);
    });
  }

  async archive(profileId: string, archivedByKeyId: string): Promise<AgentProfile> {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new AgentProfileNotFoundError(profileId);
    if (profile.archivedAt !== null) return cloneProfile(profile); // idempotent

    return this.writeMutex.runExclusive(async () => {
      profile.archivedAt = Date.now();
      profile.archivedBy = archivedByKeyId;
      profile.updatedAt = Date.now();
      await this.putSerialized(profile);

      logger.info({
        component: 'agent-profiles',
        operation: 'archived',
        attributes: { profileId },
      });

      return cloneProfile(profile);
    });
  }

  async restore(profileId: string): Promise<AgentProfile> {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new AgentProfileNotFoundError(profileId);
    if (profile.archivedAt === null) return cloneProfile(profile); // idempotent

    return this.writeMutex.runExclusive(async () => {
      profile.archivedAt = null;
      profile.archivedBy = null;
      profile.updatedAt = Date.now();
      await this.putSerialized(profile);

      logger.info({
        component: 'agent-profiles',
        operation: 'restored',
        attributes: { profileId },
      });

      return cloneProfile(profile);
    });
  }
}

// ── Serialization ──────────────────────────────────────────────

function serializeProfile(p: AgentProfile): SerializedAgentProfile {
  return {
    id: p.id,
    agentId: p.agentId,
    workspaceId: p.workspaceId,
    name: p.name,
    description: p.description,
    avatarUrl: p.avatarUrl,
    runtimeMode: p.runtimeMode,
    runtimeConfig: { ...p.runtimeConfig },
    runnerName: p.runnerName,
    model: p.model,
    thinkingLevel: p.thinkingLevel,
    maxConcurrentTasks: p.maxConcurrentTasks,
    instructions: p.instructions,
    customEnv: [...p.customEnv],
    customArgs: [...p.customArgs],
    mcpConfig: { ...p.mcpConfig },
    ownerKeyId: p.ownerKeyId,
    archivedAt: p.archivedAt,
    archivedBy: p.archivedBy,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    configHash: p.configHash,
  };
}

function deserializeProfile(s: SerializedAgentProfile): AgentProfile {
  return {
    id: s.id,
    agentId: s.agentId ?? s.id, // backward compat: old data without agentId
    workspaceId: s.workspaceId,
    name: s.name,
    description: s.description,
    avatarUrl: s.avatarUrl,
    runtimeMode: (s.runtimeMode as AgentProfile['runtimeMode']) ?? 'claude-code',
    runtimeConfig: { ...s.runtimeConfig },
    runnerName: s.runnerName,
    model: s.model,
    thinkingLevel: s.thinkingLevel as AgentProfile['thinkingLevel'],
    maxConcurrentTasks: s.maxConcurrentTasks,
    instructions: s.instructions,
    customEnv: [...s.customEnv],
    customArgs: [...s.customArgs],
    mcpConfig: { ...s.mcpConfig },
    ownerKeyId: s.ownerKeyId,
    archivedAt: s.archivedAt,
    archivedBy: s.archivedBy,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    configHash: s.configHash ?? '', // backward compat
  };
}

// ── Errors ─────────────────────────────────────────────────────

export class AgentProfileNotFoundError extends Error {
  constructor(profileId: string) {
    super(`Agent profile not found: ${profileId}`);
    this.name = 'AgentProfileNotFoundError';
  }
}

export class AgentProfileArchivedError extends Error {
  constructor(profileId: string) {
    super(`Agent profile is archived: ${profileId}`);
    this.name = 'AgentProfileArchivedError';
  }
}

export class AgentProfileNameError extends Error {
  constructor(name: string) {
    super(`Invalid agent name: "${name}" — must match ${SAFE_NAME_RE.source}`);
    this.name = 'AgentProfileNameError';
  }
}

export class AgentProfileEnvError extends Error {
  constructor(key: string, reason: string) {
    super(`Forbidden env var: "${key}" — ${reason}`);
    this.name = 'AgentProfileEnvError';
  }
}
