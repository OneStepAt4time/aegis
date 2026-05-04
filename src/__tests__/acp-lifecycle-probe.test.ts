import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AcpProtocolError,
  resolveAcpCommand,
  runAcpLifecycleProbe,
} from '../acp-lifecycle-probe.js';

const fixturePath = path.join(process.cwd(), 'src', '__tests__', 'fixtures', 'fake-acp-agent.mjs');

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
