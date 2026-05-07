import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runAcpTerminalExtensionProbe } from '../acp-terminal-extension-probe.js';

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

describe('acp terminal extension probe', () => {
  it('verifies input echo, resize, reconnect/resubscribe, and debug-output forwarding', async () => {
    const result = await runAcpTerminalExtensionProbe({
      ...nodeFixtureOptions({ FAKE_ACP_TERMINAL_EXTENSION: '1' }),
      input: 'aegis typed input\n',
      resize: { columns: 132, rows: 41 },
    });

    expect(result.capabilities).toEqual({
      inputEcho: true,
      resize: true,
      reconnect: true,
      debugOutput: true,
    });
    expect(result.sessionId).toBe('fixture-session');
    expect(result.terminalId).toBe('fixture-terminal');
    expect(result.inputEcho).toEqual({
      terminalId: 'fixture-terminal',
      data: 'aegis typed input\n',
    });
    expect(result.resize).toEqual({
      terminalId: 'fixture-terminal',
      columns: 132,
      rows: 41,
    });
    expect(result.reconnect).toEqual({
      terminalId: 'fixture-terminal',
      replayedOutput: 'aegis typed input\n',
      columns: 132,
      rows: 41,
    });
    expect(result.debug).toEqual([
      {
        terminalId: 'fixture-terminal',
        level: 'debug',
        message: 'fixture forwarded debug output',
      },
    ]);
    expect(result.exit.code).toBe(0);
  });

  it('classifies agents that do not advertise the terminal extension', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({ FAKE_ACP_TERMINAL_EXTENSION: 'unsupported' }),
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal extension is not supported',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
      }),
    });
  });

  it('classifies agents that only advertise partial terminal extension support', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({ FAKE_ACP_TERMINAL_EXTENSION: 'partial' }),
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal extension is not supported',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
      }),
    });
  });

  it('classifies malformed terminal extension events', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'malformed-terminal-event',
        }),
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'input_echo',
      }),
    });
  });

  it('classifies terminal events for a different terminal as malformed', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'wrong-terminal-event',
        }),
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedTerminalId: 'fixture-terminal',
        actualTerminalId: 'other-terminal',
      }),
    });
  });

  it('classifies input echo data that does not match the requested input', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'wrong-input-echo',
        }),
        input: 'echo me exactly\n',
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'input_echo',
        expectedData: 'echo me exactly\n',
        actualData: 'echo me exactly\nunexpected',
      }),
    });
  });

  it('classifies resize events that do not match the requested dimensions', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'wrong-resize',
        }),
        resize: { columns: 144, rows: 55 },
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'resize',
        expectedColumns: 144,
        actualColumns: 145,
        expectedRows: 55,
        actualRows: 56,
      }),
    });
  });

  it('classifies reconnect snapshots missing previously echoed terminal output', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'missing-reconnect-output',
        }),
        input: 'must replay this input\n',
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'reconnect_snapshot',
        expectedReplayedOutputIncludes: 'must replay this input\n',
        actualReplayedOutput: '',
      }),
    });
  });

  it('classifies reconnect snapshots that replay stale terminal output', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'stale-reconnect-output',
        }),
        input: 'new terminal input\n',
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'reconnect_snapshot',
        expectedReplayedOutputIncludes: 'new terminal input\n',
        actualReplayedOutput: 'old terminal output\n',
      }),
    });
  });

  it('classifies reconnect snapshots that use stale terminal dimensions', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'stale-reconnect-dimensions',
        }),
        resize: { columns: 151, rows: 47 },
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'reconnect_snapshot',
        expectedColumns: 151,
        actualColumns: 80,
        expectedRows: 47,
        actualRows: 24,
      }),
    });
  });

  it('classifies terminal debug output for a different session as malformed', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'wrong-debug-session',
        }),
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal debug output was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedSessionId: 'fixture-session',
        actualSessionId: 'other-session',
      }),
    });
  });

  it('classifies child exit while waiting for terminal debug output', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'exit-before-debug-output',
        }),
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      message: 'ACP child process exited before terminal debug output',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        code: 44,
      }),
    });
  });

  it('classifies child exit during the terminal stream', async () => {
    await expect(
      runAcpTerminalExtensionProbe({
        ...nodeFixtureOptions({
          FAKE_ACP_TERMINAL_EXTENSION: '1',
          FAKE_ACP_MODE: 'exit-during-terminal-stream',
        }),
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      message: 'ACP child process exited during terminal stream',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedKind: 'input_echo',
        code: 43,
      }),
    });
  });
});
