import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type AcpCapturedFrame,
  AcpProtocolError,
  REDACTED_ACP_VALUE,
  resolveAcpCommand,
  runAcpLifecycleProbe,
  type AcpLifecycleProbeResult,
  type JsonObject,
} from '../acp-lifecycle-probe.js';
import { normalizeAcpFrames } from '../acp-event-stream.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-agent.mjs');
const anthAuthTokenKey = ['ANTHROPIC', 'AUTH', 'TOKEN'].join('_');
const anthBaseUrlKey = ['ANTHROPIC', 'BASE', 'URL'].join('_');
const anthDefaultModelKey = ['ANTHROPIC', 'DEFAULT', 'MODEL'].join('_');
const anthFastModelKey = ['ANTHROPIC', 'DEFAULT', 'FAST', 'MODEL'].join('_');
const apiTimeoutKey = ['API', 'TIMEOUT', 'MS'].join('_');
const eventStreamFixtureDir = path.join(
  process.cwd(),
  'src',
  '__tests__',
  'fixtures',
  'acp-event-stream'
);
const rawEventFixturePath = path.join(eventStreamFixtureDir, 'event-stream.raw.ndjson');
const normalizedEventFixturePath = path.join(eventStreamFixtureDir, 'event-stream.normalized.json');

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

function readJsonFixture(pathname: string): unknown {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

function readNdjsonFixture(pathname: string): Record<string, unknown>[] {
  return fs
    .readFileSync(pathname, 'utf8')
    .trim()
    .split('\n')
    .map(line => {
      const parsed: unknown = JSON.parse(line);
      if (!isJsonObject(parsed)) throw new Error(`Fixture line is not a JSON object: ${line}`);
      return parsed;
    });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventStreamMessages(frames: readonly AcpCapturedFrame[]): unknown[] {
  return frames
    .filter(frame => {
      if (frame.direction !== 'agent_to_client') return false;
      const message = frame.message;
      if (message.method === 'session/request_permission') return true;
      if (message.method === 'session/update') {
        const params = message.params;
        if (!isJsonObject(params)) return false;
        const update = params.update;
        if (!isJsonObject(update)) return false;
        return (
          update.sessionUpdate === 'agent_message_chunk' ||
          update.sessionUpdate === 'agent_thought_chunk' ||
          update.sessionUpdate === 'tool_call' ||
          update.sessionUpdate === 'tool_call_update' ||
          update.sessionUpdate === 'mystery_update'
        );
      }
      const result = message.result;
      return (
        typeof message.id === 'number' &&
        result !== undefined &&
        isJsonObject(result) &&
        result.stopReason === 'end_turn'
      );
    })
    .map(frame => frame.message);
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

  it('does not emit passthrough probe updates when no provider, model, or env metadata is present', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
    });

    expect(
      result.notifications.some(notification => {
        const update = notification.params?.update;
        return isJsonObject(update) && update.sessionUpdate === 'acp_probe_passthrough';
      })
    ).toBe(false);
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

  it('rejects unterminated non-JSON stdout when the child exits', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions({ FAKE_ACP_MODE: 'unterminated-stdout-before-exit' }),
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      message: 'ACP stdout ended with an unterminated line',
      details: expect.objectContaining({
        line: 'this is not terminated json',
        method: 'initialize',
      }),
    });
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

  it('does not expose raw initialize payloads when request writes fail', async () => {
    const secretMarker = 'fixture-request-write-secret';

    let caught: unknown;
    try {
      await runAcpLifecycleProbe({
        ...nodeFixtureOptions({ FAKE_ACP_MODE: 'exit-before-initialize' }),
        clientCapabilities: {
          secretMarker,
          padding: 'x'.repeat(1_000_000),
        },
        timeoutMs: 1_000,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AcpProtocolError);
    expect(JSON.stringify(caught)).not.toContain(secretMarker);
    expect(JSON.stringify(caught)).not.toContain('padding');
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

  it('passes Anthropic mapped provider environment into both the ACP child process and Claude options', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions({
        OPENROUTER_API_KEY: undefined,
        AEGIS_FAKE_UNRELATED_SECRET: undefined,
      }),
      model: 'claude-sonnet-4-6',
      modelProvider: 'anthropic',
      providerEnv: {
        [anthBaseUrlKey]: 'https://api.anthropic.test',
        [anthAuthTokenKey]: 'synthetic-anthropic-token',
        [anthDefaultModelKey]: 'claude-sonnet-4-6',
        [anthFastModelKey]: 'claude-haiku-4-5',
        [apiTimeoutKey]: '45000',
      },
    });

    const passthrough = findProbePassthrough(result);

    expect(result.modelPassthrough).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      env: {
        [anthAuthTokenKey]: REDACTED_ACP_VALUE,
        [anthBaseUrlKey]: 'https://api.anthropic.test',
        [anthDefaultModelKey]: 'claude-sonnet-4-6',
        [anthFastModelKey]: 'claude-haiku-4-5',
        [apiTimeoutKey]: '45000',
      },
      envKeys: [
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
        'ANTHROPIC_DEFAULT_FAST_MODEL',
        'ANTHROPIC_DEFAULT_MODEL',
        'API_TIMEOUT_MS',
      ],
    });
    expect(passthrough.provider).toBe('anthropic');
    expect(passthrough.model).toBe('claude-sonnet-4-6');
    expect(passthrough.optionEnvKeys).toEqual([
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_DEFAULT_FAST_MODEL',
      'ANTHROPIC_DEFAULT_MODEL',
      'API_TIMEOUT_MS',
    ]);
    expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
    expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
    expect(passthrough.nativeOpenRouterKeySeen).toBe(false);
    expect(passthrough.parentUnrelatedSecretSeen).toBe(false);
  });

  it('does not inherit parent provider-native or unrelated secret environment into the ACP child process', async () => {
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const previousUnrelatedSecret = process.env.AEGIS_FAKE_UNRELATED_SECRET;
    process.env.OPENROUTER_API_KEY = 'synthetic-parent-openrouter-secret';
    process.env.AEGIS_FAKE_UNRELATED_SECRET = 'synthetic-parent-unrelated-secret';

    try {
      const result = await runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        modelProvider: 'openrouter',
        providerEnv: {
          [anthAuthTokenKey]: 'synthetic-mapped-openrouter-token',
        },
      });

      const passthrough = findProbePassthrough(result);

      expect(passthrough.spawnEnvAuthTokenSeen).toBe(true);
      expect(passthrough.optionEnvAuthTokenSeen).toBe(true);
      expect(passthrough.nativeOpenRouterKeySeen).toBe(false);
      expect(passthrough.parentUnrelatedSecretSeen).toBe(false);
      expect(passthrough.optionEnvKeys).toEqual(['ANTHROPIC_AUTH_TOKEN']);
    } finally {
      if (previousOpenRouterKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      }
      if (previousUnrelatedSecret === undefined) {
        delete process.env.AEGIS_FAKE_UNRELATED_SECRET;
      } else {
        process.env.AEGIS_FAKE_UNRELATED_SECRET = previousUnrelatedSecret;
      }
    }
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

  it('surfaces ACP approval requests as structured data and sends an explicit allow response', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'request-permission',
      approvalDecision: { outcome: 'selected', optionKind: 'allow_once' },
    });

    expect(result.prompt?.result.stopReason).toBe('permission_allowed');
    expect(result.approvalRequests).toHaveLength(1);
    expect(result.approvalRequests[0]).toMatchObject({
      requestId: 'permission-1',
      sessionId: 'fixture-session',
      state: 'responded',
      toolCall: {
        toolCallId: 'tool-call-approval-1',
        title: 'Run shell command',
        kind: 'execute',
        rawInput: {
          command: expect.stringContaining('[REDACTED_PATH]'),
          env: {
            ANTHROPIC_API_KEY: '[REDACTED]',
            AEGIS_AUTH_TOKEN: '[REDACTED]',
            PATH: 'C:\\Windows\\System32',
          },
        },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Deny', kind: 'reject_once' },
      ],
      response: {
        outcome: {
          outcome: 'selected',
          optionId: 'allow-once',
        },
      },
    });
    expect(JSON.stringify(result.approvalRequests)).not.toContain('placeholder-anthropic-key');
    expect(JSON.stringify(result.approvalRequests)).not.toContain('fixture-token');
    expect(JSON.stringify(result.approvalRequests)).not.toContain('settings.local.json');
  });

  it('sends an explicit deny response for ACP approval requests', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'request-permission',
      approvalDecision: { outcome: 'selected', optionKind: 'reject_once' },
    });

    expect(result.prompt?.result.stopReason).toBe('permission_denied');
    expect(result.approvalRequests[0]?.response).toEqual({
      outcome: {
        outcome: 'selected',
        optionId: 'reject-once',
      },
    });
  });

  it('bounds long ACP approval command details before surfacing structured requests', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'request-large-permission',
      approvalDecision: { outcome: 'selected', optionKind: 'allow_once' },
    });

    const rawInput = result.approvalRequests[0]?.toolCall.rawInput;
    expect(rawInput).toMatchObject({
      command: expect.stringContaining('[TRUNCATED]'),
      env: {
        ANTHROPIC_API_KEY: '[REDACTED]',
      },
    });
    const command =
      rawInput && typeof rawInput === 'object' && 'command' in rawInput ? rawInput.command : '';
    expect(
      typeof command === 'string' ? Buffer.byteLength(command, 'utf8') : 0
    ).toBeLessThanOrEqual(2_048);
    expect(typeof command === 'string' ? command : '').not.toContain('fixture-command-token');
  });

  it('bounds and redacts ACP approval metadata before surfacing structured requests', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'request-metadata-permission',
      approvalDecision: { outcome: 'selected', optionKind: 'allow_once' },
    });

    const request = result.approvalRequests[0];
    expect(request?.options).toHaveLength(25);
    expect(Buffer.byteLength(request?.sessionId ?? '', 'utf8')).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(request?.toolCall.toolCallId ?? '', 'utf8')).toBeLessThanOrEqual(
      2_048
    );
    expect(Buffer.byteLength(request?.toolCall.title ?? '', 'utf8')).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(request?.toolCall.kind ?? '', 'utf8')).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(request?.toolCall.status ?? '', 'utf8')).toBeLessThanOrEqual(2_048);
    expect(Buffer.byteLength(request?.options[0]?.optionId ?? '', 'utf8')).toBeLessThanOrEqual(
      2_048
    );
    expect(Buffer.byteLength(request?.options[0]?.name ?? '', 'utf8')).toBeLessThanOrEqual(2_048);
    expect(JSON.stringify(request)).not.toContain('fixture-session-secret');
    expect(JSON.stringify(request)).not.toContain('fixture-tool-secret');
    expect(JSON.stringify(request)).not.toContain('fixture-title-secret');
    expect(JSON.stringify(request)).not.toContain('fixture-kind-secret');
    expect(JSON.stringify(request)).not.toContain('fixture-status-secret');
    expect(JSON.stringify(request)).not.toContain('fixture-option-id-secret');
    expect(JSON.stringify(request)).not.toContain('fixture-option-secret');
    expect(JSON.stringify(request)).not.toContain('settings.local.json');
    expect(request?.sessionId).toContain('[REDACTED]');
    expect(request?.toolCall.toolCallId).toContain('[REDACTED]');
    expect(request?.toolCall.title).toContain('[REDACTED]');
    expect(request?.toolCall.kind).toContain('[REDACTED]');
    expect(request?.toolCall.status).toContain('[REDACTED]');
    expect(request?.options[0]?.optionId).toContain('[REDACTED]');
    expect(request?.options[0]?.name).toContain('[REDACTED]');
  });

  it('redacts POSIX settings.local.json paths in ACP approval command details', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'request-posix-settings-permission',
      approvalDecision: { outcome: 'selected', optionKind: 'allow_once' },
    });

    expect(result.approvalRequests[0]?.toolCall.rawInput).toMatchObject({
      command: 'cat [REDACTED_PATH]',
    });
    expect(JSON.stringify(result.approvalRequests)).not.toContain('settings.local.json');
  });

  it('resolves a pending ACP approval request with cancelled outcome when the prompt is cancelled', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'request-permission',
      cancelAfterApprovalRequest: true,
    });

    expect(result.cancelSent).toBe(true);
    expect(result.prompt?.result.stopReason).toBe('permission_cancelled');
    expect(result.approvalRequests[0]).toMatchObject({
      state: 'responded',
      response: {
        outcome: {
          outcome: 'cancelled',
        },
      },
    });
  });

  it('rejects ACP approval requests when the child exits before the response write is accepted', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        prompt: 'request-permission-exit-large-option',
        approvalDecision: { outcome: 'selected', optionKind: 'allow_once' },
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      message: 'ACP approval response write failed',
      details: expect.objectContaining({
        method: 'session/request_permission',
        requestId: 'permission-1',
        approvalRequest: expect.objectContaining({
          requestId: 'permission-1',
          state: 'rejected',
          rejectionReason: 'write_failed',
        }),
      }),
    });
  });

  it('rejects pending ACP approval requests when the child exits before a response', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        prompt: 'request-permission-exit',
      })
    ).rejects.toMatchObject({
      message: 'ACP child process exited before response',
      details: expect.objectContaining({
        method: 'session/prompt',
        code: 43,
        pendingApprovals: [
          expect.objectContaining({
            requestId: 'permission-1',
            state: 'rejected',
            rejectionReason: 'child_exit',
          }),
        ],
      }),
    });
  });

  it('rejects pending ACP approval requests when the waiting prompt times out', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        prompt: 'request-permission',
        timeoutMs: 500,
      })
    ).rejects.toMatchObject({
      message: 'ACP request timed out',
      details: expect.objectContaining({
        method: 'session/prompt',
        timeoutMs: 500,
        pendingApprovals: [
          expect.objectContaining({
            requestId: 'permission-1',
            state: 'rejected',
            rejectionReason: 'request_timeout',
          }),
        ],
      }),
    });
  });

  it('surfaces malformed ACP approval requests as protocol errors', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        prompt: 'request-invalid-permission',
      })
    ).rejects.toMatchObject({
      message: 'ACP permission option kind is unsupported',
      details: expect.objectContaining({
        method: 'session/request_permission',
        optionId: 'allow-once',
        kind: 'bogus',
      }),
    });
  });

  it('bounds captured stderr by UTF-8 bytes for multi-byte output', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions({ FAKE_ACP_MODE: 'unicode-stderr' }),
    });

    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(result.exit.code).toBe(0);
  });

  it('captures the deterministic ACP event stream raw fixture', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'emit-event-stream',
      sessionCwd: 'D:\\aegis\\redacted-session',
    });

    expect(eventStreamMessages(result.frames)).toEqual(readNdjsonFixture(rawEventFixturePath));
    expect(result.prompt?.result.stopReason).toBe('end_turn');
  });

  it('normalizes ACP event stream fixtures into stable Aegis spike events', async () => {
    const result = await runAcpLifecycleProbe({
      ...nodeFixtureOptions(),
      prompt: 'emit-event-stream',
      sessionCwd: 'D:\\aegis\\redacted-session',
    });

    expect(result.normalizedEvents).toEqual(readJsonFixture(normalizedEventFixturePath));
  });

  it('normalizes the committed raw ACP fixture into the committed event fixture', () => {
    const rawFrames: AcpCapturedFrame[] = readNdjsonFixture(rawEventFixturePath).map(message => ({
      direction: 'agent_to_client',
      message,
    }));

    expect(normalizeAcpFrames(rawFrames)).toEqual(readJsonFixture(normalizedEventFixturePath));
  });

  it('rejects stdout protocol pollution after event streaming has started', async () => {
    await expect(
      runAcpLifecycleProbe({
        ...nodeFixtureOptions(),
        prompt: 'pollute-event-stream',
      })
    ).rejects.toMatchObject({
      message: 'ACP stdout contained a non-JSON line',
      details: expect.objectContaining({
        method: 'session/prompt',
        id: 3,
      }),
    });
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
