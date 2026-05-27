/**
 * config/sessions.ts — Zod schema for session lifecycle config.
 *
 * Covers: session age, reaper, continuation, stall, cleanup, state store,
 * worktree, ACP, isolation, work directories, default env.
 */

import { z } from 'zod';

/** Zod schema for session config domain. */
export const sessionConfigSchema = z.object({
  /** Directory for bridge state (state.json, session_map.json). */
  stateDir: z.string().default(''),
  /** Directory where Claude Code stores projects (~/.claude/projects). */
  claudeProjectsDir: z.string().default(''),
  /** Max session age in milliseconds. */
  maxSessionAgeMs: z.number().int().positive().default(2 * 60 * 60 * 1000),
  /** Reaper check interval in milliseconds. */
  reaperIntervalMs: z.number().int().positive().default(5 * 60 * 1000),
  /** Continuation pointer TTL in milliseconds. */
  continuationPointerTtlMs: z.number().int().positive().default(24 * 60 * 60 * 1000),
  /** Stall threshold for monitor (ms). */
  stallThresholdMs: z.number().int().positive().default(120_000),
  /** Interval in ms for auto-cleanup of killed sessions. Default: 3600000 (1 hour). 0 = disabled. */
  sessionCleanupIntervalMs: z.number().int().nonnegative().optional().default(3_600_000),
  /** Age in ms after which killed sessions are purged. Default: 86400000 (24 hours). */
  sessionCleanupAgeMs: z.number().int().positive().optional().default(86_400_000),
  /** Session state store backend: 'file' | 'redis' | 'postgres'. Default: 'file'. */
  stateStore: z.enum(['file', 'redis', 'postgres']).default('file'),
  /** PostgreSQL connection URL (required when stateStore='postgres'). */
  postgresUrl: z.string().default(''),
  /** Enable ACP backend for session creation and control actions (default: false). */
  acpEnabled: z.boolean().default(true),
  /** ACP JSON-RPC request timeout in ms (default: 60000). */
  acpPromptTimeoutMs: z.number().int().min(1000).default(120_000),
  /** Enforce ACP validation warnings as errors (default: false). */
  acpStrictValidation: z.boolean().optional().default(false),
  /** Session isolation policy. */
  isolationPolicy: z.enum(['respect-cc', 'enforce-worktree', 'enforce-direct']).optional().default('respect-cc'),
  /** Enable worktree-aware continuation metadata lookup (default: false). */
  worktreeAwareContinuation: z.boolean().default(false),
  /** Additional Claude projects directories to search during worktree fanout. */
  worktreeSiblingDirs: z.array(z.string()).default([]),
  /** Allowed working directories for session creation (empty = all allowed). */
  allowedWorkDirs: z.array(z.string()).default([]),
  /** Default env vars injected into every CC session. */
  defaultSessionEnv: z.record(z.string(), z.string()).default({}),
});

/** Inferred type for the session config domain. */
export type SessionConfig = z.infer<typeof sessionConfigSchema>;
