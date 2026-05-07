import { describe, expect, it } from 'vitest';

import {
  type AcpBackendClient,
  type AcpChildProcessExitEvent,
  type AcpJsonRpcId,
  type AcpJsonRpcInboundRequest,
  type AcpJsonRpcNotification,
  type AcpJsonRpcResponseError,
  type AcpJsonRpcRequestOptions,
  type AcpJsonRpcSuccess,
  type AcpJsonValue,
  type AcpSessionRecord,
  type AcpSessionScope,
} from '../services/acp/index.js';
import {
  ACP_TERMINAL_BRIDGE_UNVERIFIED_CASES,
  AcpTerminalBridge,
  type AcpTerminalBridgeEvent,
} from '../services/acp/terminal-bridge.js';

const scope: AcpSessionScope = {
  tenantId: 'tenant-a',
  ownerKeyId: 'owner-a',
};

describe('AcpTerminalBridge', () => {
  it('opens the verified ACP terminal extension and forwards input without legacy contracts', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));

    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });
    await bridge.sendInput({ ...scope, sessionId: 'session-1', terminalId: terminal.terminalId, data: 'hello\n' });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'input_echo',
      terminalId: 'terminal-1',
      data: 'hello\n',
    }));

    expect(terminal).toEqual({ sessionId: 'session-1', acpSessionId: 'acp-session-1', terminalId: 'terminal-1' });
    expect(client.requests).toEqual([
      { method: 'terminal/open', params: { sessionId: 'acp-session-1' } },
      {
        method: 'terminal/input',
        params: { sessionId: 'acp-session-1', terminalId: 'terminal-1', data: 'hello\n' },
      },
    ]);
    expect(events).toEqual([
      {
        type: 'terminal.output',
        sessionId: 'session-1',
        acpSessionId: 'acp-session-1',
        terminalId: 'terminal-1',
        data: 'hello\n',
        source: 'input_echo',
      },
    ]);
    expect(JSON.stringify([...client.requests, ...events])).not.toMatch(/pane|windowId|windowName/i);
  });

  it('forwards resize requests and emits verified resize events', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));

    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });
    await bridge.resizeTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      columns: 132,
      rows: 41,
    });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 132,
      rows: 41,
    }));

    expect(client.requests.at(-1)).toEqual({
      method: 'terminal/resize',
      params: { sessionId: 'acp-session-1', terminalId: 'terminal-1', columns: 132, rows: 41 },
    });
    expect(events.at(-1)).toEqual({
      type: 'terminal.resize',
      sessionId: 'session-1',
      acpSessionId: 'acp-session-1',
      terminalId: 'terminal-1',
      columns: 132,
      rows: 41,
    });
  });

  it('resubscribes reconnecting observers and returns the verified bootstrap snapshot', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));

    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });
    client.onRequestMethod('terminal/resubscribe', () => {
      client.emitNotification(terminalEvent('acp-session-1', {
        kind: 'reconnect_snapshot',
        terminalId: 'terminal-1',
        replayedOutput: 'hello\n',
        columns: 132,
        rows: 41,
      }));
    });

    await expect(
      bridge.reconnectTerminal({
        ...scope,
        sessionId: 'session-1',
        terminalId: terminal.terminalId,
      })
    ).resolves.toEqual({
      type: 'terminal.snapshot',
      sessionId: 'session-1',
      acpSessionId: 'acp-session-1',
      terminalId: 'terminal-1',
      replayedOutput: 'hello\n',
      columns: 132,
      rows: 41,
    });
    expect(client.requests.at(-1)).toEqual({
      method: 'terminal/resubscribe',
      params: { sessionId: 'acp-session-1', terminalId: 'terminal-1' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'terminal.snapshot', replayedOutput: 'hello\n' });
  });

  it('rejects pending reconnect snapshots when the terminal closes', async () => {
    const { bridge } = createBridge({ eventTimeoutMs: 20 });
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    const snapshot = bridge.reconnectTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
    });
    await bridge.closeTerminal({ ...scope, sessionId: 'session-1', terminalId: terminal.terminalId });

    await expect(snapshot).rejects.toMatchObject({
      message: 'ACP terminal closed before reconnect snapshot',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        terminalId: 'terminal-1',
      }),
    });
  });

  it('keeps terminal debug output separate from raw terminal output', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));

    await bridge.openTerminal({ ...scope, sessionId: 'session-1' });
    client.emitNotification({
      jsonrpc: '2.0',
      method: 'terminal/debug',
      params: {
        sessionId: 'acp-session-1',
        terminalId: 'terminal-1',
        level: 'debug',
        message: 'fixture forwarded debug output',
      },
      raw: {
        jsonrpc: '2.0',
        method: 'terminal/debug',
        params: {
          sessionId: 'acp-session-1',
          terminalId: 'terminal-1',
          level: 'debug',
          message: 'fixture forwarded debug output',
        },
      },
    });

    expect(events).toEqual([
      {
        type: 'terminal.debug',
        sessionId: 'session-1',
        acpSessionId: 'acp-session-1',
        terminalId: 'terminal-1',
        level: 'debug',
        message: 'fixture forwarded debug output',
      },
    ]);
    expect(events.some(event => event.type === 'terminal.output')).toBe(false);
  });

  it('propagates ACP request failures and malformed terminal events', async () => {
    const { bridge, client } = createBridge();
    const errors: Error[] = [];
    bridge.onError(error => errors.push(error));
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    const remoteFailure = new Error('agent rejected terminal input');
    client.rejectNextRequest(remoteFailure);
    await expect(
      bridge.sendInput({ ...scope, sessionId: 'session-1', terminalId: terminal.terminalId, data: 'blocked' })
    ).rejects.toBe(remoteFailure);

    client.onRequestMethod('terminal/resubscribe', () => {
      client.emitNotification(terminalEvent('acp-session-1', {
        kind: 'reconnect_snapshot',
        terminalId: 'other-terminal',
        replayedOutput: '',
        columns: 80,
        rows: 24,
      }));
    });

    await expect(
      bridge.reconnectTerminal({
        ...scope,
        sessionId: 'session-1',
        terminalId: terminal.terminalId,
      })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        parityArea: 'terminal-extension',
        expectedTerminalId: 'terminal-1',
        actualTerminalId: 'other-terminal',
      }),
    });
    expect(errors).toHaveLength(1);
  });

  it('classifies input echo and resize events that do not match forwarded actions', async () => {
    const { bridge, client } = createBridge();
    const errors: Error[] = [];
    bridge.onError(error => errors.push(error));
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    await bridge.sendInput({ ...scope, sessionId: 'session-1', terminalId: terminal.terminalId, data: 'exact\n' });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'input_echo',
      terminalId: 'terminal-1',
      data: 'exact\nunexpected',
    }));
    await bridge.resizeTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      columns: 144,
      rows: 55,
    });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 145,
      rows: 56,
    }));

    expect(errors).toEqual([
      expect.objectContaining({
        message: 'ACP terminal event was malformed',
        details: expect.objectContaining({
          expectedKind: 'input_echo',
          expectedData: 'exact\n',
          actualData: 'exact\nunexpected',
        }),
      }),
      expect.objectContaining({
        message: 'ACP terminal event was malformed',
        details: expect.objectContaining({
          expectedKind: 'resize',
          expectedColumns: 144,
          actualColumns: 145,
          expectedRows: 55,
          actualRows: 56,
        }),
      }),
    ]);
  });

  it('classifies input echo events that have no forwarded input action', async () => {
    const { bridge, client } = createBridge();
    const errors: Error[] = [];
    bridge.onError(error => errors.push(error));
    await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'input_echo',
      terminalId: 'terminal-1',
      data: 'unsolicited\n',
    }));

    expect(errors).toEqual([
      expect.objectContaining({
        message: 'ACP terminal event was malformed',
        details: expect.objectContaining({
          expectedKind: 'input_echo',
          actualData: 'unsolicited\n',
        }),
      }),
    ]);
  });

  it('keeps pending input validation intact when a later identical input request fails', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    await bridge.sendInput({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      data: 'same\n',
    });
    client.rejectNextRequest(new Error('second input failed'));
    await expect(
      bridge.sendInput({
        ...scope,
        sessionId: 'session-1',
        terminalId: terminal.terminalId,
        data: 'same\n',
      })
    ).rejects.toThrow('second input failed');

    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'input_echo',
      terminalId: 'terminal-1',
      data: 'same\n',
    }));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'terminal.output',
        data: 'same\n',
      }),
    ]);
  });

  it('validates concurrent resize acknowledgements in request order', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    await bridge.resizeTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      columns: 100,
      rows: 30,
    });
    await bridge.resizeTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      columns: 120,
      rows: 40,
    });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 100,
      rows: 30,
    }));
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 120,
      rows: 40,
    }));

    expect(events.filter(event => event.type === 'terminal.resize')).toEqual([
      expect.objectContaining({ columns: 100, rows: 30 }),
      expect.objectContaining({ columns: 120, rows: 40 }),
    ]);
  });

  it('keeps pending resize validation intact when a later identical resize request fails', async () => {
    const { bridge, client } = createBridge();
    const events: AcpTerminalBridgeEvent[] = [];
    bridge.onEvent(event => events.push(event));
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    await bridge.resizeTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      columns: 111,
      rows: 33,
    });
    client.rejectNextRequest(new Error('second resize failed'));
    await expect(
      bridge.resizeTerminal({
        ...scope,
        sessionId: 'session-1',
        terminalId: terminal.terminalId,
        columns: 111,
        rows: 33,
      })
    ).rejects.toThrow('second resize failed');

    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 111,
      rows: 33,
    }));

    expect(events).toEqual([
      expect.objectContaining({
        type: 'terminal.resize',
        columns: 111,
        rows: 33,
      }),
    ]);
  });

  it('classifies resize events that have no forwarded resize action', async () => {
    const { bridge, client } = createBridge();
    const errors: Error[] = [];
    bridge.onError(error => errors.push(error));
    await bridge.openTerminal({ ...scope, sessionId: 'session-1' });

    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 99,
      rows: 31,
    }));

    expect(errors).toEqual([
      expect.objectContaining({
        message: 'ACP terminal event was malformed',
        details: expect.objectContaining({
          expectedKind: 'resize',
          actualColumns: 99,
          actualRows: 31,
        }),
      }),
    ]);
  });

  it('classifies reconnect snapshots with stale terminal replay or dimensions', async () => {
    const { bridge, client } = createBridge();
    const terminal = await bridge.openTerminal({ ...scope, sessionId: 'session-1' });
    await bridge.sendInput({ ...scope, sessionId: 'session-1', terminalId: terminal.terminalId, data: 'must replay\n' });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'input_echo',
      terminalId: 'terminal-1',
      data: 'must replay\n',
    }));
    await bridge.resizeTerminal({
      ...scope,
      sessionId: 'session-1',
      terminalId: terminal.terminalId,
      columns: 151,
      rows: 47,
    });
    client.emitNotification(terminalEvent('acp-session-1', {
      kind: 'resize',
      terminalId: 'terminal-1',
      columns: 151,
      rows: 47,
    }));
    client.onRequestMethod('terminal/resubscribe', () => {
      client.emitNotification(terminalEvent('acp-session-1', {
        kind: 'reconnect_snapshot',
        terminalId: 'terminal-1',
        replayedOutput: 'old terminal output\n',
        columns: 80,
        rows: 24,
      }));
    });

    await expect(
      bridge.reconnectTerminal({ ...scope, sessionId: 'session-1', terminalId: terminal.terminalId })
    ).rejects.toMatchObject({
      message: 'ACP terminal event was malformed',
      details: expect.objectContaining({
        expectedKind: 'reconnect_snapshot',
        expectedReplayedOutputIncludes: 'must replay\n',
        actualReplayedOutput: 'old terminal output\n',
        expectedColumns: 151,
        actualColumns: 80,
        expectedRows: 47,
        actualRows: 24,
      }),
    });
  });

  it('fails closed when the ACP runtime does not advertise the verified terminal extension', async () => {
    const { bridge } = createBridge({
      agentCapabilities: {
        terminalExtension: {
          inputEcho: true,
          resize: true,
          reconnect: true,
          debugOutput: false,
        },
      },
    });

    await expect(bridge.openTerminal({ ...scope, sessionId: 'session-1' })).rejects.toMatchObject({
      message: 'ACP terminal extension is not supported',
      details: expect.objectContaining({ parityArea: 'terminal-extension' }),
    });
  });

  it('documents unsupported ACP-048 golden coverage instead of guessing terminal wire behavior', () => {
    expect(ACP_TERMINAL_BRIDGE_UNVERIFIED_CASES).toEqual([
      'real claude-agent-acp terminal extension wire compatibility',
      'durable terminal frame replay after Aegis process restart',
      'public REST, MCP, SDK, and dashboard terminal contracts',
    ]);
  });
});

interface CreateBridgeOptions {
  agentCapabilities?: AcpJsonValue;
  eventTimeoutMs?: number;
}

function createBridge(options: CreateBridgeOptions = {}): {
  bridge: AcpTerminalBridge;
  client: FakeBackendClient;
} {
  const client = new FakeBackendClient();
  client.setResult('terminal/open', { terminalId: 'terminal-1' });
  client.setResult('terminal/input', {});
  client.setResult('terminal/resize', {});
  client.setResult('terminal/resubscribe', {});
  const agentCapabilities =
    options.agentCapabilities ??
    {
      terminalExtension: {
        inputEcho: true,
        resize: true,
        reconnect: true,
        debugOutput: true,
      },
    };
  const bridge = new AcpTerminalBridge({
    sessionResolver: {
      async getSession(sessionId: string, requestedScope: AcpSessionScope): Promise<AcpSessionRecord> {
        expect(sessionId).toBe('session-1');
        expect(requestedScope).toEqual(scope);
        return {
          id: 'session-1',
          tenantId: 'tenant-a',
          ownerKeyId: 'owner-a',
          conversationId: 'conversation-1',
          transcriptId: 'transcript-1',
          acpAgentSessionId: 'acp-session-1',
          status: 'idle',
          createdAt: 1,
          updatedAt: 1,
        };
      },
    },
    runtimeResolver: {
      getRuntime(sessionId: string) {
        expect(sessionId).toBe('session-1');
        return { client, agentCapabilities };
      },
    },
    eventTimeoutMs: options.eventTimeoutMs,
  });
  return { bridge, client };
}

function terminalEvent(
  sessionId: string,
  event: Record<string, AcpJsonValue>
): AcpJsonRpcNotification {
  const params = { sessionId, event };
  return {
    jsonrpc: '2.0',
    method: 'terminal/event',
    params,
    raw: { jsonrpc: '2.0', method: 'terminal/event', params },
  };
}

class FakeBackendClient implements AcpBackendClient {
  readonly requests: { method: string; params: AcpJsonValue | undefined }[] = [];
  private readonly notifications = new Set<(notification: AcpJsonRpcNotification) => void>();
  private readonly inboundRequests = new Set<(request: AcpJsonRpcInboundRequest) => void>();
  private readonly exits = new Set<(event: AcpChildProcessExitEvent) => void>();
  private readonly errors = new Set<(error: Error) => void>();
  private readonly results = new Map<string, AcpJsonValue>();
  private readonly methodHandlers = new Map<string, () => void | Promise<void>>();
  private nextError: Error | undefined;

  setResult(method: string, result: AcpJsonValue): void {
    this.results.set(method, result);
  }

  rejectNextRequest(error: Error): void {
    this.nextError = error;
  }

  onRequestMethod(method: string, handler: () => void | Promise<void>): void {
    this.methodHandlers.set(method, handler);
  }

  async start(): Promise<void> {}

  async request<T = AcpJsonValue>(
    method: string,
    params?: AcpJsonValue,
    _options?: AcpJsonRpcRequestOptions
  ): Promise<AcpJsonRpcSuccess<T>> {
    this.requests.push({ method, params });
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = undefined;
      throw error;
    }
    await this.methodHandlers.get(method)?.();
    const result = this.results.get(method);
    return { jsonrpc: '2.0', id: `${method}-request`, result: result as T };
  }

  async notify(_method: string, _params?: AcpJsonValue): Promise<void> {}

  async shutdown(): Promise<AcpChildProcessExitEvent> {
    return { code: 0, signal: null, expected: true, escalated: false };
  }

  onNotification(listener: (notification: AcpJsonRpcNotification) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  onRequest(listener: (request: AcpJsonRpcInboundRequest) => void): () => void {
    this.inboundRequests.add(listener);
    return () => this.inboundRequests.delete(listener);
  }

  onExit(listener: (exit: AcpChildProcessExitEvent) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errors.add(listener);
    return () => this.errors.delete(listener);
  }

  async respond(_id: AcpJsonRpcId, _result: AcpJsonValue): Promise<void> {}
  async respondWithError(_id: AcpJsonRpcId, _error: AcpJsonRpcResponseError): Promise<void> {}

  emitNotification(notification: AcpJsonRpcNotification): void {
    for (const listener of this.notifications) listener(notification);
  }
}
