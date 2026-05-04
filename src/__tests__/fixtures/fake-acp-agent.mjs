#!/usr/bin/env node
import readline from 'node:readline';

const mode = process.env.FAKE_ACP_MODE ?? 'normal';
const anthAuthTokenKey = ['ANTHROPIC', 'AUTH', 'TOKEN'].join('_');
const openRouterApiKey = ['OPENROUTER', 'API', 'KEY'].join('_');
if (mode === 'noisy-stdout') {
  process.stdout.write('this is not json\n');
}
if (mode === 'unicode-stderr') {
  process.stderr.write('🐉'.repeat(70_000));
}
process.stderr.write('fake claude-agent-acp fixture ready\n');
if (mode === 'exit-before-initialize') {
  process.stderr.write('fixture exiting before initialize\n');
  process.exit(42);
}

let pendingPrompt = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
  const { id, method, params } = message;

  if (method === 'initialize') {
    if (mode === 'hang-initialize') {
      return;
    }
    respond(id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, embeddedContext: true },
        mcpCapabilities: { http: true, sse: true },
        sessionCapabilities: { close: {}, resume: {}, list: {} },
      },
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

      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: 'fixture-session',
          update: {
            sessionUpdate: 'acp_probe_passthrough',
            provider: aegisMeta.modelProvider,
            model: options.model,
            optionEnvKeys: objectKeys(optionEnv),
            spawnEnvAuthTokenSeen: process.env[anthAuthTokenKey] === optionEnv[anthAuthTokenKey],
            optionEnvAuthTokenSeen:
              typeof optionEnv[anthAuthTokenKey] === 'string' &&
              optionEnv[anthAuthTokenKey].length > 0,
            nativeOpenRouterKeySeen: Boolean(process.env[openRouterApiKey]),
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
    const firstText = params.prompt && params.prompt[0] && params.prompt[0].text;
    if (firstText === '') {
      respond(id, { stopReason: 'empty_prompt_seen' });
      return;
    }
    if (firstText === 'wait-for-cancel') {
      pendingPrompt = { id, sessionId: params.sessionId };
      return;
    }
    respond(id, { stopReason: 'end_turn' });
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

rl.on('close', () => process.exit(0));
