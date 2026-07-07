type Platform = NodeJS.Platform;

const ACP_BIN_ENV_KEY = 'AEGIS_ACP_BIN';
const AEGIS_AUTH_TOKEN_KEY = 'AEGIS_AUTH_TOKEN';
const AEGIS_SESSION_ID_KEY = 'AEGIS_SESSION_ID';
const AEGIS_BASE_URL_KEY = 'AEGIS_BASE_URL';
const AEGIS_STATE_DIR_KEY = 'AEGIS_STATE_DIR';
const AEGIS_PERMISSION_MODE_KEY = 'AEGIS_PERMISSION_MODE';

/**
 * Default auth env-var prefixes passed through to the ACP child process
 * (Claude Code). Non-default runners (Kimi: KIMI_/MOONSHOT_, etc.) override
 * this via buildAcpSpawnEnv's `authEnvPrefixes` arg.
 */
const DEFAULT_AUTH_PREFIXES = ['ANTHROPIC_', 'CLAUDE_'];

export function buildAcpResolveEnv(
  overrides: Record<string, string | undefined> | undefined,
  source: NodeJS.ProcessEnv = process.env
): Record<string, string | undefined> {
  return {
    [ACP_BIN_ENV_KEY]: hasOwnEnvKey(overrides, ACP_BIN_ENV_KEY)
      ? overrides?.[ACP_BIN_ENV_KEY]
      : source[ACP_BIN_ENV_KEY],
  };
}

export function buildAcpSpawnEnv(
  overrides: Record<string, string | undefined> | undefined,
  mappedProviderEnv: Record<string, string> = {},
  source: NodeJS.ProcessEnv = process.env,
  platform: Platform = process.platform,
  sessionId?: string,
  permissionMode?: string,
  authEnvPrefixes: readonly string[] = DEFAULT_AUTH_PREFIXES
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  copyPlatformExecutionEnv(env, source, platform, authEnvPrefixes);
  applyEnvOverrides(env, overrides, platform);
  applyEnvOverrides(env, mappedProviderEnv, platform);
  env.NO_COLOR = overrides?.NO_COLOR ?? source.NO_COLOR ?? '1';
  applyAegisRequiredEnv(env, source, sessionId, permissionMode);
  return env;
}

/**
 * Issue #4524: Inject Aegis-required environment variables into child process env.
 * Sets AEGIS_AUTH_TOKEN, AEGIS_SESSION_ID, AEGIS_BASE_URL, AEGIS_STATE_DIR
 * from the provider environment when available.
 */
export function applyAegisRequiredEnv(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv = process.env,
  sessionId?: string,
  permissionMode?: string
): void {
  if (source[AEGIS_AUTH_TOKEN_KEY] !== undefined) {
    target[AEGIS_AUTH_TOKEN_KEY] = source[AEGIS_AUTH_TOKEN_KEY];
  }
  if (sessionId !== undefined) {
    target[AEGIS_SESSION_ID_KEY] = sessionId;
  }
  if (source[AEGIS_BASE_URL_KEY] !== undefined) {
    target[AEGIS_BASE_URL_KEY] = source[AEGIS_BASE_URL_KEY];
  }
  if (source[AEGIS_STATE_DIR_KEY] !== undefined) {
    target[AEGIS_STATE_DIR_KEY] = source[AEGIS_STATE_DIR_KEY];
  }
  if (permissionMode !== undefined) {
    target[AEGIS_PERMISSION_MODE_KEY] = permissionMode;
  }
}

function copyPlatformExecutionEnv(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  platform: Platform,
  authEnvPrefixes: readonly string[] = DEFAULT_AUTH_PREFIXES
): void {
  if (platform === 'win32') {
    copyCaseInsensitiveEnvKey(target, source, 'Path');
    for (const key of ['SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) {
      copyCaseInsensitiveEnvKey(target, source, key);
    }
    return;
  }

  // Core execution env
  for (const key of ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'HOME', 'USER', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE']) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }

  // Issue #3135: Pass through auth env vars so the ACP child process can
  // authenticate. Default prefixes are Anthropic/Claude (claude-agent-acp);
  // non-default runners (Kimi, etc.) override via authEnvPrefixes. Without
  // these, the child cannot find API keys/credentials and silently fails.
  for (const key of Object.keys(source)) {
    if (authEnvPrefixes.some(prefix => key.startsWith(prefix))) {
      target[key] = source[key];
    }
  }
}

function copyCaseInsensitiveEnvKey(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  canonicalKey: string
): void {
  const key = Object.keys(source).find(
    candidate => candidate.toLowerCase() === canonicalKey.toLowerCase()
  );
  if (!key) return;
  const value = source[key];
  if (value !== undefined) {
    target[key] = value;
  }
}

function applyEnvOverrides(
  target: NodeJS.ProcessEnv,
  overrides: Record<string, string | undefined> | undefined,
  platform: Platform
): void {
  if (!overrides) return;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      deleteEnvKey(target, key, platform);
      continue;
    }
    if (platform === 'win32') {
      deleteEnvKey(target, key, platform);
    }
    target[key] = value;
  }
}

function deleteEnvKey(target: NodeJS.ProcessEnv, key: string, platform: Platform): void {
  delete target[key];
  if (platform !== 'win32') return;
  for (const candidate of Object.keys(target)) {
    if (candidate.toLowerCase() === key.toLowerCase()) {
      delete target[candidate];
    }
  }
}

function hasOwnEnvKey(
  env: Record<string, string | undefined> | undefined,
  key: string
): boolean {
  return env !== undefined && Object.hasOwn(env, key);
}
