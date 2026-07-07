import { describe, expect, it } from 'vitest';

import { buildAcpSpawnEnv } from '../acp-spawn-env.js';

describe('ACP spawn environment', () => {
  it('lets Windows overrides replace existing execution keys case-insensitively', () => {
    const env = buildAcpSpawnEnv(
      { Path: 'D:\\override\\bin' },
      {},
      {
        PATH: 'D:\\source\\bin',
        SystemRoot: 'C:\\Windows',
      },
      'win32'
    );

    expect(env.Path).toBe('D:\\override\\bin');
    expect(env.PATH).toBeUndefined();
  });

  it('passes through default ANTHROPIC_/CLAUDE_ auth prefixes on non-Windows', () => {
    const env = buildAcpSpawnEnv({}, {}, {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-1',
      CLAUDE_CONFIG: 'x',
      KIMI_API_KEY: 'should-not-leak',
    }, 'linux');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-1');
    expect(env.CLAUDE_CONFIG).toBe('x');
    expect(env.KIMI_API_KEY).toBeUndefined();
  });

  it('Phase 3.6: passes through custom auth prefixes (Kimi) on non-Windows', () => {
    const env = buildAcpSpawnEnv({}, {}, {
      PATH: '/usr/bin',
      KIMI_API_KEY: 'kimi-1',
      MOONSHOT_TOKEN: 'ms-1',
      ANTHROPIC_API_KEY: 'should-not-leak',
    }, 'linux', undefined, undefined, ['KIMI_', 'MOONSHOT_']);
    expect(env.KIMI_API_KEY).toBe('kimi-1');
    expect(env.MOONSHOT_TOKEN).toBe('ms-1');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('does NOT pass through auth-prefix env on Windows (auth flows via providerEnv)', () => {
    // Characterizes the Windows branch: copyPlatformExecutionEnv copies only
    // execution env (Path/SystemRoot/...), NOT the auth-prefix loop. Auth on
    // Windows reaches the child via mappedProviderEnv (applyEnvOverrides).
    const env = buildAcpSpawnEnv({}, {}, {
      Path: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      ANTHROPIC_API_KEY: 'sk-1',
    }, 'win32');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.Path).toBe('C:\\bin');
  });
});
