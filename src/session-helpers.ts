/**
 * session-helpers.ts — Standalone helper functions for session management.
 *
 * Extracted from session.ts (#4246 step 2): pure functions and async
 * utilities that have no dependency on SessionManager state.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { detectUIState } from './session-ui-parser.js';
import { resolveApprovalInput, type PermissionDecision } from './services/session/permissions.js';
import type { SessionInfo } from './session-types.js';
import { persistedStateSchema } from './validation.js';

export type { PermissionDecision };

/**
 * Rehydrate persisted sessions from the serialized state schema.
 * Handles Set coercion and displayName defaults.
 */
export function hydrateSessions(raw: z.infer<typeof persistedStateSchema>): Record<string, SessionInfo> {
  const sessions: Record<string, SessionInfo> = Object.create(null);
  for (const [id, s] of Object.entries(raw)) {
    const { activeSubagents, displayName, ...rest } = s as Record<string, unknown>;
    sessions[id] = {
      ...rest,
      displayName: (typeof (rest as Record<string, unknown>).displayName === 'string'
        ? (rest as Record<string, unknown>).displayName
        : typeof displayName === 'string' ? displayName : id.slice(0, 8)) as string,
      activeSubagents: activeSubagents ? new Set(activeSubagents as string[]) : undefined,
    } as SessionInfo;
  }
  return sessions;
}

/**
 * Type guard for plain objects (non-null, non-array).
 */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Detect the model name from Claude Code settings files.
 * Checks project-local then global settings.
 */
export async function detectModelFromSettings(workDir: string): Promise<string | undefined> {
  const candidates = [
    join(workDir, '.claude', 'settings.local.json'),
    join(workDir, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.local.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = await readFile(p, { encoding: 'utf8' }).catch(() => undefined);
      if (!raw) continue;
      let obj: any;
      try { obj = JSON.parse(raw); } catch { continue; }
      const model = obj?.env?.ANTHROPIC_MODEL;
      if (typeof model === 'string' && model.length > 0) return model;
    } catch { continue; }
  }
  return undefined;
}

/** Detect session isolation mode from project or global Claude Code settings. */
export async function detectIsolationMode(workDir: string): Promise<'worktree' | 'none' | undefined> {
  const candidates = [
    join(workDir, '.claude', 'settings.local.json'),
    join(workDir, '.claude', 'settings.json'),
    join(homedir(), '.claude', 'settings.local.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];

  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const raw = await readFile(p, { encoding: 'utf8' }).catch(() => undefined);
      if (!raw) continue;
      let obj: any;
      try { obj = JSON.parse(raw); } catch { continue; }
      const val = obj?.worktree?.bgIsolation;
      if (typeof val === 'string') {
        if (val === 'none') return 'none';
        if (val === 'worktree') return 'worktree';
      }
    } catch (_) {
      // ignore and continue
    }
  }
  return undefined;
}

/**
 * Resolve approval input from pane text based on detected UI state.
 * Returns the keypress to send, or null if not in an approval state.
 */
export function getUiApprovalInput(
  paneText: string,
  action: 'approve' | 'reject',
  permissionMode: string,
): string | null {
  const state = detectUIState(paneText);
  if (state !== 'permission_prompt' && state !== 'plan_mode' && state !== 'bash_approval') {
    return null;
  }
  return resolveApprovalInput(paneText, action, permissionMode);
}
