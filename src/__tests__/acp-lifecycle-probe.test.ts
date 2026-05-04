import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AcpProtocolError,
  REDACTED_ACP_VALUE,
  resolveAcpCommand,
  runAcpLifecycleProbe,
  type AcpLifecycleProbeResult,
  type JsonObject,
} from '../acp-lifecycle-probe.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-agent.mjs');
const anthAuthTokenKey = ['ANTHROPIC', 'AUTH', 'TOKEN'].join('_');
const anthBaseUrlKey = ['ANTHROPIC', 'BASE', 'URL'].join('_');
const anthDefaultModelKey = ['ANTHROPIC', 'DEFAULT', 'MODEL'].join('_');
const anthFastModelKey = ['ANTHROPIC', 'DEFAULT', 'FAST', 'MODEL'].join('_');
const apiTimeoutKey = ['API', 'TIMEOUT', 'MS'].join('_');

function nodeFixtureOptions(extraEnv: Record<string, string | undefined> = {}) {
  return {
    command: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    sessionCwd: process.cwd(),
    env: extraEnv,
    timeoutMs: 2_000,
  };
}

function findProbePassthrough(result: AcpLifecycleProbeResult): JsonObject {
  for (const notification of result.notifications) {
    const update = notification.params?.update;
    if (isJsonObject(update) && update.sessionUpdate === 'acp_probe_passthrough') {
      return update;
    }
  }
  throw new Error('fake ACP agent did not report passthrough metadata');
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('acp lifecycle probe', () => {
  it('initializes, creates, prompts, closes, and drains an NDJSON ACP child process', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'hello fixture',
      closeSession: true,
    });

    expect(result.initialize.result.protocolVersion).toBe(1);
    expect(result.initialize.result.agentInfo.name).toBe('@agentclientprotocol/claude-agent-acp');
    expect(result.sessionId).toBe('fixture-session');
    expect(result.prompt?.result.stopReason).toBe('end_turn');
    expect(result.close?.result).toEqual({});
    expect(result.notifications.some(message => message.method === 'session/update')).toBe(true);
    expect(result.stderr).toContain('fake claude-agent-acp fixture ready');
    expect(result.exit.code).toBe(0);
  });

  it('sends session/cancel and observes a cancelled prompt response', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'wait-for-cancel',
      cancelAfterFirstUpdate: true,
    });

    expect(result.cancelSent).toBe(true);
    expect(result.prompt?.result.stopReason).toBe('cancelled');
    expect(result.exit.code).toBe(0);
  });

  it('can resume the created ACP session before shutdown', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      resumeSession: true,
    });

    expect(result.resume?.result).toEqual({});
    expect(result.exit.code).toBe(0);
  });

  it('rejects non-JSON stdout because ACP stdout is reserved for framed protocol messages', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions({ FAKE_ACP_MODE: 'noisy-stdout' }),
        prompt: 'hello fixture',
      })
    ).rejects.toBeInstanceOf(AcpProtocolError);
  });

  it('classifies child exit before initialize as an ACP child process exit', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions({ FAKE_ACP_MODE: 'exit-before-initialize' }),
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      message: 'ACP child process exited before response',
      details: expect.objectContaining({
        method: 'initialize',
        code: 42,
      }),
    });
  });

  it('classifies request timeouts with method and id details', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions({ FAKE_ACP_MODE: 'hang-initialize' }),
        timeoutMs: 50,
      })
    ).rejects.toMatchObject({
      message: 'ACP request timed out',
      details: expect.objectContaining({
        method: 'initialize',
        id: 1,
        timeoutMs: 50,
      }),
    });
  });

  it('preserves an explicit empty prompt instead of treating it as no prompt', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: '',
    });

    expect(result.prompt?.result.stopReason).toBe('empty_prompt_seen');
  });

  it('passes explicit model selection and provider metadata to session/new without prompting', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: undefined,
      model: 'claude-sonnet-4-6',
      modelProvider: 'anthropic',
    });

    const passthrough = findProbePassthrough(result);

    expect(result.modelPassthrough).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      env: {},
      envKeys: [],
    });
    expect(passthrough.provider).toBe('anthropic');
    expect(passthrough.model).toBe('claude-sonnet-4-6');
    expect(passthrough.optionEnvKeys).toEqual([]);
    expect(result.prompt).toBeUndefined();
  });

  it('passes only allowlisted provider environment into the ACP child process and Claude options', async () => {
    const secretToken = 'openrouter-secret-for-redaction';
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions({ OPENROUTER_API_KEY: undefined }),
      modelProvider: 'openrouter',
      providerEnv: {
        [anthBaseUrlKey]: 'https://openrouter.ai/api/v1',
        [anthAuthTokenKey]: secretToken,
        [anthDefaultModelKey]: 'openai/gpt-4.1-mini',
        [anthFastModelKey]: 'openai/gpt-4.1-mini',
        [apiTimeoutKey]: '60000',
      },
    });

    const passthrough = findProbePassthrough(result);

    expect(result.modelPassthrough.provider).toBe('openrouter');
    expect(result.modelPassthrough.env).toEqual({
      [anthBaseUrlKey]: 'https://openrouter.ai/api/v1',
      [anthAuthTokenKey]: REDACTED_ACP_VALUE,
      [anthDefaultModelKey]: 'openai/gpt-4.1-mini',
      [anthFastModelKey]: 'openai/gpt-4.1-mini',
      [apiTimeoutKey]: '60000',
    });
    expect(JSON.stringify(result.modelPassthrough)).not.toContain(secretToken);
    expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
    expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
    expect(passthrough.nativeOpenRouterKeySeen).toBe(false);
    expect(passthrough.optionEnvKeys).toEqual([
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_DEFAULT_FAST_MODEL',
      'ANTHROPIC_DEFAULT_MODEL',
      'API_TIMEOUT_MS',
    ]);
  });

  it('covers a second mapped BYO provider with deterministic fake-agent evidence', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      model: 'qwen2.5-coder:7b',
      modelProvider: 'ollama',
      providerEnv: {
        [anthBaseUrlKey]: 'http://127.0.0.1:11434/v1',
        [anthAuthTokenKey]: 'ollama-local',
        [anthDefaultModelKey]: 'qwen2.5-coder:7b',
        [anthFastModelKey]: 'qwen2.5-coder:7b',
        [apiTimeoutKey]: '180000',
      },
    });

    const passthrough = findProbePassthrough(result);

    expect(result.modelPassthrough.provider).toBe('ollama');
    expect(result.modelPassthrough.model).toBe('qwen2.5-coder:7b');
    expect(passthrough.provider).toBe('ollama');
    expect(passthrough.model).toBe('qwen2.5-coder:7b');
    expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
    expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
  });

  it('redacts sensitive provider values from protocol error details', async () => {
    const secretToken = 'secret-that-must-not-leak';

    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions({ FAKE_ACP_MODE: 'secret-error' }),
        modelProvider: 'openrouter',
        providerEnv: {
          [anthAuthTokenKey]: secretToken,
        },
      })
    ).rejects.toMatchObject({
      message: 'ACP request failed',
      details: {
        error: {
          message: `provider rejected ${REDACTED_ACP_VALUE}`,
          data: {
            [anthAuthTokenKey]: REDACTED_ACP_VALUE,
          },
        },
      },
    });
  });

  it('validates unsupported or empty model and provider passthrough inputs', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        model: '   ',
      })
    ).rejects.toThrow('ACP model must be a non-empty string');

    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        modelProvider: 'unsupported-provider',
      })
    ).rejects.toThrow('Unsupported ACP model provider: unsupported-provider');

    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        modelProvider: '   ',
      })
    ).rejects.toThrow('ACP model provider must be a non-empty string');

    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        modelProvider: 'openrouter',
        providerEnv: {
          OPENROUTER_API_KEY: 'provider-native-secret',
        },
      })
    ).rejects.toThrow('Provider env OPENROUTER_API_KEY is not allowlisted for openrouter');

    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        modelProvider: 'openrouter',
        providerEnv: {
          [anthDefaultModelKey]: '   ',
        },
      })
    ).rejects.toThrow(`Provider env ${anthDefaultModelKey} must be a non-empty string`);
  });

  it('bounds captured stderr by UTF-8 bytes for multi-byte output', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions({ FAKE_ACP_MODE: 'unicode-stderr' }),
    });

    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(result.exit.code).toBe(0);
  });

  it('resolves explicit, environment, local package, and npm fallback commands', () => {
    expect(
      resolveAcpCommand({
        explicitCommand: 'D:\\tools\\claude-agent-acp.cmd',
        platform: 'win32',
        env: {},
        cwd: 'D:\\repo',
        fileExists: () => false,
      })
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"D:\\tools\\claude-agent-acp.cmd"'],
      source: 'explicit',
    });

    expect(
      resolveAcpCommand({
        platform: 'win32',
        env: { AEGIS_ACP_BIN: 'C:\\Program Files\\ACP\\claude-agent-acp.cmd' },
        cwd: 'D:\\repo',
        fileExists: () => false,
      })
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"C:\\Program Files\\ACP\\claude-agent-acp.cmd"'],
      source: 'AEGIS_ACP_BIN',
    });

    expect(
      resolveAcpCommand({
        platform: 'win32',
        env: {},
        cwd: 'D:\\repo',
        fileExists: candidate => candidate.endsWith('node_modules\\.bin\\claude-agent-acp.cmd'),
      })
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"D:\\repo\\node_modules\\.bin\\claude-agent-acp.cmd"'],
      source: 'local-package-bin',
    });

    expect(
      resolveAcpCommand({
        platform: 'win32',
        env: {},
        cwd: 'D:\\repo',
        fileExists: () => false,
      })
    ).toEqual({
      command: 'cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'npm.cmd exec --yes --package=@agentclientprotocol/claude-agent-acp -- claude-agent-acp',
      ],
      source: 'npm-exec',
    });
  });
});
