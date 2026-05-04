#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const mode = process.env.FAKE_ACP_MODE ?? 'normal';
const anthAuthTokenKey = ['ANTHROPIC', 'AUTH', 'TOKEN'].join('_');
const openRouterApiKey = ['OPENROUTER', 'API', 'KEY'].join('_');
const unrelatedSecretKey = ['AEGIS', 'FAKE', 'UNRELATED', 'SECRET'].join('_');
const terminalExtensionMode = process.env.FAKE_ACP_TERMINAL_EXTENSION ?? '0';
if (mode === 'noisy-stdout') {
  process.stdout.write('this is not json\n');
}
if (mode === 'unicode-stderr') {
  process.stderr.write('🐉'.repeat(70_000));
}
process.stderr.write('fake claude-agent-acp fixture ready\n');
if (mode === 'unterminated-stdout-before-exit') {
  process.stdout.write('this is not terminated json');
  process.exit(45);
}
if (mode === 'exit-before-initialize') {
  process.stderr.write('fixture exiting before initialize\n');
  process.exit(42);
}

let pendingPrompt = null;
const pendingPermissionPrompts = new Map();
const approvalFixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'acp-approval-request.json'
);
const approvalFixture = JSON.parse(fs.readFileSync(approvalFixturePath, 'utf8'));
const terminalState = {
  terminalId: 'fixture-terminal',
  output: '',
  columns: 80,
  rows: 24,
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendBeforeExit(message, exitCode, afterSend) {
  process.stdout.write(`${JSON.stringify(message)}\n`, () => {
    afterSend?.();
    setImmediate(() => process.exit(exitCode));
  });
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function requestError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, data } });
}

function objectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).sort();
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) {
    handlePermissionResponse(message);
    return;
  }
  const { id, method, params } = message;
  if (method === undefined && id !== undefined) {
    return;
  }

  if (method === 'initialize') {
    if (mode === 'hang-initialize') {
      return;
    }
    const agentCapabilities = {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { http: true, sse: true },
      sessionCapabilities: { close: {}, resume: {}, list: {} },
    };
    if (terminalExtensionMode === '1') {
      agentCapabilities.terminalExtension = {
        inputEcho: true,
        resize: true,
        reconnect: true,
        debugOutput: true,
      };
    }
    if (terminalExtensionMode === 'partial') {
      agentCapabilities.terminalExtension = {
        inputEcho: true,
        resize: true,
        reconnect: true,
        debugOutput: false,
      };
    }
    respond(id, {
      protocolVersion: 1,
      agentCapabilities,
      agentInfo: {
        name: '@agentclientprotocol/claude-agent-acp',
        title: 'Fake Claude Agent',
        version: '0.0.0-fixture',
      },
      authMethods: [],
    });
    return;
  }

  if (method === 'session/new') {
    if (!params || typeof params.cwd !== 'string') {
      error(id, -32602, 'cwd is required');
      return;
    }
    if (mode === 'secret-error') {
      requestError(id, -32000, `provider rejected ${process.env[anthAuthTokenKey]}`, {
        [anthAuthTokenKey]: process.env[anthAuthTokenKey],
      });
      return;
    }
    respond(id, { sessionId: 'fixture-session' });
    setImmediate(() =>
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fixture-session',
          update: { sessionUpdate: 'available_commands_update', commands: [] },
        },
      })
    );
    setImmediate(() => {
      const meta = params._meta && typeof params._meta === 'object' ? params._meta : {};
      const aegisMeta = meta.aegis && typeof meta.aegis === 'object' ? meta.aegis : {};
      const claudeCode =
        meta.claudeCode && typeof meta.claudeCode === 'object' ? meta.claudeCode : {};
      const options =
        claudeCode.options && typeof claudeCode.options === 'object' ? claudeCode.options : {};
      const optionEnv = options.env && typeof options.env === 'object' ? options.env : {};
      const provider =
        typeof aegisMeta.modelProvider === 'string' ? aegisMeta.modelProvider : undefined;
      const model = typeof options.model === 'string' ? options.model : undefined;
      const optionEnvKeys = objectKeys(optionEnv);

      if (provider === undefined && model === undefined && optionEnvKeys.length === 0) {
        return;
      }

      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fixture-session',
          update: {
            sessionUpdate: 'acp_probe_passthrough',
            provider,
            model,
            optionEnvKeys,
            spawnEnvAuthTokenSeen:
              typeof optionEnv[anthAuthTokenKey] === 'string' &&
              process.env[anthAuthTokenKey] === optionEnv[anthAuthTokenKey],
            optionEnvAuthTokenSeen:
              typeof optionEnv[anthAuthTokenKey] === 'string' &&
              optionEnv[anthAuthTokenKey].length > 0,
            nativeOpenRouterKeySeen: Boolean(process.env[openRouterApiKey]),
            parentUnrelatedSecretSeen: Boolean(process.env[unrelatedSecretKey]),
          },
        },
      });
    });
    return;
  }

  if (method === 'session/resume') {
    if (!params || params.sessionId !== 'fixture-session') {
      error(id, -32602, 'known sessionId is required');
      return;
    }
    respond(id, {});
    return;
  }

  if (method === 'session/prompt') {
    const firstText = params.prompt && params.prompt[0] && params.prompt[0].text;
    if (firstText === 'emit-event-stream') {
      sendEventStream(params.sessionId);
      respond(id, { stopReason: 'end_turn' });
      return;
    }
    if (firstText === 'pollute-event-stream') {
      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'before pollution' },
          },
        },
      });
      process.stdout.write('this is not json during event streaming\n');
      return;
    }
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'fixture response' },
        },
      },
    });
    if (firstText === '') {
      respond(id, { stopReason: 'empty_prompt_seen' });
      return;
    }
    if (firstText === 'wait-for-cancel') {
      pendingPrompt = { id, sessionId: params.sessionId };
      return;
    }
    if (
      firstText === 'request-permission' ||
      firstText === 'request-permission-exit' ||
      firstText === 'request-permission-exit-unterminated' ||
      firstText === 'request-permission-exit-large-option' ||
      firstText === 'request-large-permission' ||
      firstText === 'request-metadata-permission' ||
      firstText === 'request-posix-settings-permission'
    ) {
      const permissionId = 'permission-1';
      const approvalParams =
        firstText === 'request-large-permission'
          ? {
              ...approvalFixture,
              toolCall: {
                ...approvalFixture.toolCall,
                rawInput: {
                  command: `echo secret fixture-command-token ${'x'.repeat(5_000)}`,
                  env: {
                    ANTHROPIC_API_KEY: 'placeholder-anthropic-key',
                  },
                },
              },
            }
          : firstText === 'request-metadata-permission'
            ? {
                ...approvalFixture,
                toolCall: {
                  ...approvalFixture.toolCall,
                  toolCallId: `tool-call secret fixture-tool-secret ${'z'.repeat(5_000)}`,
                  title: `Run secret fixture-title-secret ${'x'.repeat(5_000)} C:\\Users\\fixture\\.claude\\settings.local.json`,
                  kind: `execute secret fixture-kind-secret ${'k'.repeat(5_000)}`,
                  status: `pending secret fixture-status-secret ${'s'.repeat(5_000)}`,
                  rawInput: {
                    [`${['Bearer', ['sk', 'ant', 'fixture', 'key', 'secret'].join('-')].join(' ')} ${'b'.repeat(5_000)}`]:
                      'header value',
                    [`C:\\Users\\fixture\\.claude\\settings.local.json ${'p'.repeat(5_000)}`]:
                      'settings value',
                    [`api_key=fixture-key-secret ${'a'.repeat(5_000)}`]: 'api key value',
                    [`long-key-${'l'.repeat(5_000)}`]: 'long key value',
                  },
                },
                options: Array.from({ length: 30 }, (_, index) =>
                  index === 0
                    ? {
                        optionId: `allow-once secret fixture-option-id-secret ${'i'.repeat(5_000)}`,
                        name: `Allow api_key fixture-option-secret ${'n'.repeat(5_000)} C:\\Users\\fixture\\.claude\\settings.local.json`,
                        kind: 'allow_once',
                      }
                    : {
                        optionId: `option-${index}`,
                        name: `Option ${index}`,
                        kind: index % 2 === 0 ? 'allow_once' : 'reject_once',
                      }
                ),
              }
            : firstText === 'request-permission-exit-large-option'
              ? {
                  ...approvalFixture,
                  options: [
                    {
                      optionId: `allow-once-${'x'.repeat(1_000_000)}`,
                      name: 'Allow once with large id',
                      kind: 'allow_once',
                    },
                    ...approvalFixture.options.slice(1),
                  ],
                }
              : firstText === 'request-posix-settings-permission'
                ? {
                    ...approvalFixture,
                    toolCall: {
                      ...approvalFixture.toolCall,
                      rawInput: {
                        command: 'cat /Users/fixture/project/.claude/settings.local.json',
                      },
                    },
                  }
                : approvalFixture;
      pendingPermissionPrompts.set(permissionId, { promptId: id, sessionId: params.sessionId });
      const permissionMessage = {
        jsonrpc: '2.0',
        id: permissionId,
        method: 'session/request_permission',
        params: {
          ...approvalParams,
          sessionId:
            firstText === 'request-metadata-permission'
              ? `fixture-session secret fixture-session-secret ${'q'.repeat(5_000)}`
              : params.sessionId,
        },
      };
      if (
        firstText === 'request-permission-exit' ||
        firstText === 'request-permission-exit-unterminated' ||
        firstText === 'request-permission-exit-large-option'
      ) {
        sendBeforeExit(permissionMessage, 43, () => {
          if (firstText === 'request-permission-exit-unterminated') {
            process.stdout.write('unterminated residual approval output');
          }
        });
        return;
      }
      send(permissionMessage);
      return;
    }
    if (firstText === 'request-invalid-permission') {
      send({
        jsonrpc: '2.0',
        id: 'permission-1',
        method: 'session/request_permission',
        params: {
          sessionId: params.sessionId,
          toolCall: { toolCallId: 'tool-call-approval-1' },
          options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'bogus' }],
        },
      });
      return;
    }
    respond(id, { stopReason: 'end_turn' });
    return;
  }

  if (method === 'terminal/open') {
    if (!params || params.sessionId !== 'fixture-session') {
      error(id, -32602, 'known sessionId is required');
      return;
    }
    respond(id, { terminalId: terminalState.terminalId });
    return;
  }

  if (method === 'terminal/input') {
    if (
      !params ||
      params.sessionId !== 'fixture-session' ||
      params.terminalId !== terminalState.terminalId ||
      typeof params.data !== 'string'
    ) {
      error(id, -32602, 'sessionId, terminalId, and data are required');
      return;
    }
    respond(id, {});
    if (mode === 'exit-during-terminal-stream') {
      process.stderr.write('fixture exiting during terminal stream\n');
      setImmediate(() => process.exit(43));
      return;
    }
    if (mode === 'malformed-terminal-event') {
      send({
        jsonrpc: '2.0',
        method: 'terminal/event',
        params: {
          sessionId: params.sessionId,
          event: {
            kind: 'input_echo',
            terminalId: terminalState.terminalId,
            data: 42,
          },
        },
      });
      return;
    }
    terminalState.output += params.data;
    if (mode === 'wrong-terminal-event') {
      send({
        jsonrpc: '2.0',
        method: 'terminal/event',
        params: {
          sessionId: params.sessionId,
          event: {
            kind: 'input_echo',
            terminalId: 'other-terminal',
            data: params.data,
          },
        },
      });
      return;
    }
    if (mode !== 'exit-before-debug-output') {
      send({
        jsonrpc: '2.0',
        method: 'terminal/debug',
        params: {
          sessionId: mode === 'wrong-debug-session' ? 'other-session' : params.sessionId,
          terminalId: terminalState.terminalId,
          level: 'debug',
          message: 'fixture forwarded debug output',
        },
      });
    }
    send({
      jsonrpc: '2.0',
      method: 'terminal/event',
      params: {
        sessionId: params.sessionId,
        event: {
          kind: 'input_echo',
          terminalId: terminalState.terminalId,
          data: mode === 'wrong-input-echo' ? `${params.data}unexpected` : params.data,
        },
      },
    });
    return;
  }

  if (method === 'terminal/resize') {
    if (
      !params ||
      params.sessionId !== 'fixture-session' ||
      params.terminalId !== terminalState.terminalId ||
      typeof params.columns !== 'number' ||
      typeof params.rows !== 'number'
    ) {
      error(id, -32602, 'sessionId, terminalId, columns, and rows are required');
      return;
    }
    terminalState.columns = params.columns;
    terminalState.rows = params.rows;
    respond(id, {});
    send({
      jsonrpc: '2.0',
      method: 'terminal/event',
      params: {
        sessionId: params.sessionId,
        event: {
          kind: 'resize',
          terminalId: terminalState.terminalId,
          columns: mode === 'wrong-resize' ? terminalState.columns + 1 : terminalState.columns,
          rows: mode === 'wrong-resize' ? terminalState.rows + 1 : terminalState.rows,
        },
      },
    });
    return;
  }

  if (method === 'terminal/resubscribe') {
    if (
      !params ||
      params.sessionId !== 'fixture-session' ||
      params.terminalId !== terminalState.terminalId
    ) {
      error(id, -32602, 'known sessionId and terminalId are required');
      return;
    }
    respond(id, {});
    if (mode === 'exit-before-debug-output') {
      send({
        jsonrpc: '2.0',
        method: 'terminal/event',
        params: {
          sessionId: params.sessionId,
          event: {
            kind: 'reconnect_snapshot',
            terminalId: terminalState.terminalId,
            replayedOutput: terminalState.output,
            columns: terminalState.columns,
            rows: terminalState.rows,
          },
        },
      });
      process.stderr.write('fixture exiting before terminal debug output\n');
      setImmediate(() => process.exit(44));
      return;
    }
    send({
      jsonrpc: '2.0',
      method: 'terminal/event',
      params: {
        sessionId: params.sessionId,
        event: {
          kind: 'reconnect_snapshot',
          terminalId: terminalState.terminalId,
          replayedOutput:
            mode === 'missing-reconnect-output'
              ? ''
              : mode === 'stale-reconnect-output'
                ? 'old terminal output\n'
                : terminalState.output,
          columns: mode === 'stale-reconnect-dimensions' ? 80 : terminalState.columns,
          rows: mode === 'stale-reconnect-dimensions' ? 24 : terminalState.rows,
        },
      },
    });
    return;
  }

  if (method === 'terminal/close') {
    if (
      !params ||
      params.sessionId !== 'fixture-session' ||
      params.terminalId !== terminalState.terminalId
    ) {
      error(id, -32602, 'known sessionId and terminalId are required');
      return;
    }
    respond(id, {});
    return;
  }

  if (method === 'session/cancel') {
    if (pendingPrompt) {
      respond(pendingPrompt.id, { stopReason: 'cancelled' });
      pendingPrompt = null;
    }
    return;
  }

  if (method === 'session/close') {
    respond(id, {});
    return;
  }

  if (id !== undefined) {
    error(id, -32601, `Unknown method ${method}`);
  }
});

function handlePermissionResponse(message) {
  const pending = pendingPermissionPrompts.get(message.id);
  if (!pending) return;
  pendingPermissionPrompts.delete(message.id);

  if (Object.hasOwn(message, 'error')) {
    respond(pending.promptId, { stopReason: 'permission_error' });
    return;
  }

  const outcome = message.result?.outcome;
  if (outcome?.outcome === 'cancelled') {
    respond(pending.promptId, { stopReason: 'permission_cancelled' });
    return;
  }

  if (outcome?.outcome === 'selected' && outcome.optionId === 'allow-once') {
    respond(pending.promptId, { stopReason: 'permission_allowed' });
    return;
  }

  if (outcome?.outcome === 'selected' && outcome.optionId === 'reject-once') {
    respond(pending.promptId, { stopReason: 'permission_denied' });
    return;
  }

  respond(pending.promptId, { stopReason: 'permission_unknown' });
}

rl.on('close', () => process.exit(0));

function sendEventStream(sessionId) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello from ACP.' },
        messageId: '11111111-1111-4111-8111-111111111111',
      },
    },
  });
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'Need to inspect a file.' },
        messageId: '22222222-2222-4222-8222-222222222222',
      },
    },
  });
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-read-1',
        title: 'Read package metadata',
        kind: 'read',
        status: 'pending',
        rawInput: { path: 'package.json' },
      },
    },
  });
  send({
    jsonrpc: '2.0',
    id: 1001,
    method: 'session/request_permission',
    params: {
      sessionId,
      toolCall: {
        toolCallId: 'tool-edit-1',
        title: 'Edit package metadata',
        kind: 'edit',
        status: 'pending',
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-read-1',
        status: 'completed',
        content: [
          {
            type: 'content',
            content: { type: 'text', text: 'package name: @onestepat4time/aegis' },
          },
        ],
        rawOutput: { ok: true },
      },
    },
  });
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: { sessionUpdate: 'mystery_update', note: 'kept raw for ACP-011 handoff' },
    },
  });
}
