type Platform = NodeJS.Platform;

const ACP_BIN_ENV_KEY = 'AEGIS_ACP_BIN';

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
  platform: Platform = process.platform
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  copyPlatformExecutionEnv(env, source, platform);
  applyEnvOverrides(env, overrides, platform);
  applyEnvOverrides(env, mappedProviderEnv, platform);
  env.NO_COLOR = overrides?.NO_COLOR ?? source.NO_COLOR ?? '1';
  return env;
}

function copyPlatformExecutionEnv(
  target: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  platform: Platform
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

  // Issue #3135: Pass through Anthropic/Claude env vars so the ACP child
  // process can authenticate. Without these, claude-agent-acp cannot find
  // API keys or credentials and silently fails.
  for (const key of Object.keys(source)) {
    if (key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_')) {
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
