import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type AcpCapturedFrame,
  AcpProtocolError,
  resolveAcpCommand,
  runAcpLifecycleProbe,
} from '../acp-lifecycle-probe.js';
import { normalizeAcpFrames } from '../acp-event-stream.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-agent.mjs');
const eventStreamFixtureDir = path.join(
  process.cwd(),
  'src',
  '__tests__',
  'fixtures',
  'acp-event-stream'
);
const rawEventFixturePath = path.join(eventStreamFixtureDir, 'event-stream.raw.ndjson');
const normalizedEventFixturePath = path.join(eventStreamFixtureDir, 'event-stream.normalized.json');

function nodeFixtureOptions(extraEnv: Record<string, string> = {}) {
  return {
    command: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    sessionCwd: process.cwd(),
    env: extraEnv,
    timeoutMs: 2_000,
  };
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
