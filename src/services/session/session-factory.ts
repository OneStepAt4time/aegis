import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { validateWorkdirPath } from '../../tenant-workdir.js';
import { sanitizeWindowName } from '../../validation.js';
import { ENV_DENYLIST, ENV_DANGEROUS_PREFIXES, ENV_NAME_RE, ENV_VALUE_MAX_BYTES, hasControlChars } from '../../validation.js';
import { activateBypassPermissions, neutralizeBypassPermissions, cleanupStaleSessionHooks } from '../../permission-guard.js';
import { writeHookSettingsFile } from '../../hook-settings.js';
import { getConfiguredBaseUrl } from '../../base-url.js';
import type { Config } from '../../config.js';
import type { SessionInfo } from '../../session.js';
import { computeStallThreshold } from '../../config.js';

async function detectModelFromSettings(workDir: string): Promise<string | undefined> {
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

async function detectIsolationMode(workDir: string): Promise<'worktree' | 'none' | undefined> {
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

export async function buildSessionInfo(id: string, opts: any, config: Config, existingSessions: SessionInfo[]): Promise<SessionInfo> {
  // Validate workdir path
  const workdirValidation = validateWorkdirPath(opts.tenantId, opts.workDir, config);
  if (!workdirValidation.allowed) {
    throw new Error(workdirValidation.reason ?? 'workDir is outside tenant root');
  }

  const candidateName = opts.name ? String(opts.name) : basename(opts.workDir || '') || `cc-${id.slice(0,8)}`;
  let displayName = sanitizeWindowName(candidateName);
  if (displayName.length > 200) displayName = displayName.slice(0, 200);
  const existing = existingSessions.filter(s => s.tenantId === opts.tenantId).map(s => s.displayName);
  if (existing.includes(displayName)) {
    let suffix = 1;
    const originalBase = displayName;
    while (existing.includes(displayName)) {
      const suffixStr = `-${suffix}`;
      const maxBaseLen = 200 - suffixStr.length;
      displayName = `${originalBase.slice(0, maxBaseLen)}${suffixStr}`;
      suffix++;
    }
  }

  const DANGEROUS_ENV_VARS = new Set(ENV_DENYLIST);
  const DANGEROUS_ENV_PREFIXES = ENV_DANGEROUS_PREFIXES;
  const mergedEnv: Record<string, string> = {};
  const allEnv = { ...config.defaultSessionEnv, ...opts.env };
  for (const [key, value] of Object.entries(allEnv)) {
    if (DANGEROUS_ENV_PREFIXES.some(prefix => key.startsWith(prefix))) {
      const matchedPrefix = DANGEROUS_ENV_PREFIXES.find(p => key.startsWith(p))!;
      throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variable prefix "${matchedPrefix}"`);
    }
    if (!ENV_NAME_RE.test(key)) {
      throw new Error(`Invalid env var name: "${key}" — must match /^[A-Z_][A-Z0-9_]*$/`);
    }
    if (DANGEROUS_ENV_VARS.has(key)) {
      throw new Error(`Forbidden env var: "${key}" — cannot override dangerous environment variables`);
    }
    if (/[\r\n]/.test(value)) {
      throw new Error(`Forbidden env var value for "${key}" — contains CR/LF characters`);
    }
    if (hasControlChars(value)) {
      throw new Error(`Forbidden env var value for "${key}" — contains control characters`);
    }
    if (Buffer.byteLength(value, 'utf-8') > ENV_VALUE_MAX_BYTES) {
      throw new Error(`Env var "${key}" value exceeds ${ENV_VALUE_MAX_BYTES} byte limit`);
    }
    mergedEnv[key] = value;
  }

  const effectivePermissionMode = opts.permissionMode
    ?? (opts.autoApprove === true ? 'bypassPermissions' : opts.autoApprove === false ? 'default' : undefined)
    ?? config.defaultPermissionMode
    ?? 'default';
  let settingsPatched = false;
  if (effectivePermissionMode === 'bypassPermissions') {
    settingsPatched = await activateBypassPermissions(opts.workDir);
  } else {
    settingsPatched = await neutralizeBypassPermissions(opts.workDir, effectivePermissionMode);
  }

  const hookSecret = randomBytes(32).toString('hex');

  const detectedIsolation = await detectIsolationMode(opts.workDir).catch(() => undefined);
  const detectedModel = await detectModelFromSettings(opts.workDir).catch(() => undefined);
  let isolationMode: 'worktree' | 'none' = detectedIsolation ?? 'worktree';

  const policy = opts.isolationPolicy ?? config.isolationPolicy;
  if (policy === 'enforce-worktree' && isolationMode === 'none') {
    throw new Error(
      `Session rejected: isolation policy is 'enforce-worktree' but CC settings have bgIsolation="none".`
    );
  }
  if (policy === 'enforce-direct') {
    isolationMode = 'none';
  }

  const now = Date.now();
  try {
    const activeIds = new Set(existingSessions.map(s => s.id));
    activeIds.add(id);
    if (activeIds.size > 0) {
      await cleanupStaleSessionHooks(opts.workDir, activeIds);
    }
  } catch (e) {
    // best-effort
  }

  let hookSettingsFile: string | undefined;
  try {
    const baseUrl = getConfiguredBaseUrl(config);
    hookSettingsFile = await writeHookSettingsFile(baseUrl, id, hookSecret, opts.workDir);
  } catch (e) {
    // non-fatal
  }

  const windowId = '';
  const finalName = displayName;

  let effectiveModel = opts.model || detectedModel;
  let effectiveEffort = opts.effort;
  if (opts.resumeSessionId && !opts.model) {
    const oldSession = existingSessions.find(s => s.id === opts.resumeSessionId);
    if (oldSession?.model) effectiveModel = oldSession.model;
    if (!opts.effort && oldSession?.effort) effectiveEffort = oldSession.effort;
  }

  const session: SessionInfo = {
    id,
    windowId,
    displayName: finalName,
    workDir: opts.workDir,
    claudeSessionId: undefined,
    byteOffset: 0,
    monitorOffset: 0,
    status: opts.initialStatus ?? 'pending',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    latestActivityText: 'Starting session',
    stallThresholdMs: opts.stallThresholdMs || computeStallThreshold(),
    permissionStallMs: opts.permissionStallMs || 5 * 60 * 1000,
    permissionMode: effectivePermissionMode,
    settingsPatched,
    hookSettingsFile,
    hookSecret,
    prd: opts.prd,
    ownerKeyId: opts.ownerKeyId ?? undefined,
    tenantId: opts.tenantId,
    model: effectiveModel,
    effort: effectiveEffort,
    runnerName: opts.runnerName,
    isolationMode: isolationMode,
    isolationPolicy: policy,
  } as SessionInfo;

  return session;
}
