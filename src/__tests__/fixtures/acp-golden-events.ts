import type {
  AcpEventMapperContext,
  AcpJsonRpcErrorObject,
  AcpJsonRpcErrorResponseEvent,
  AcpJsonRpcSuccessResponseEvent,
} from '../../services/acp/event-mapper.js';
import type {
  AcpJsonObject,
  AcpJsonRpcId,
  AcpJsonRpcInboundRequest,
  AcpJsonRpcNotification,
  AcpJsonValue,
} from '../../services/acp/json-rpc-client.js';

export type AcpGoldenEventFrame =
  | { kind: 'notification'; frame: AcpJsonRpcNotification }
  | { kind: 'inboundRequest'; frame: AcpJsonRpcInboundRequest }
  | { kind: 'successResponse'; frame: AcpJsonRpcSuccessResponseEvent }
  | { kind: 'errorResponse'; frame: AcpJsonRpcErrorResponseEvent };

export const acpGoldenEventMapperContext: AcpEventMapperContext = {
  sessionId: 'aegis-session-golden',
  tenantId: 'tenant-golden',
  ownerKeyId: 'owner-golden',
  backendRunId: 'backend-run-golden',
  occurredAt: new Date('2026-01-02T03:04:05.000Z'),
};

const acpSessionId = 'acp-session-golden';

export const acpGoldenEventFrames: AcpGoldenEventFrame[] = [
  sessionUpdate({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'Hello from the ACP boundary.' },
    messageId: 'message-golden-1',
  }),
  sessionUpdate({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Need to inspect the queue contract.' },
    messageId: 'thought-golden-1',
  }),
  sessionUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tool-golden-read',
    title: 'Read package metadata',
    kind: 'read',
    status: 'pending',
    rawInput: {
      path: 'package.json',
      ANTHROPIC_API_KEY: 'fixture-secret-key',
      token_usage: 'sk-ant-raw-token-usage-secret',
      tokenUsage: null,
      promptTokens: 'Bearer prompt-token-secret',
      nested: {
        authorizationHeader: 'Bearer fixture-token',
        cookie: 'session=fixture-cookie',
      },
    },
  }),
  sessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tool-golden-read',
    status: 'completed',
    content: [
      {
        type: 'content',
        content: { type: 'text', text: 'package name: @onestepat4time/aegis' },
      },
    ],
    rawOutput: {
      ok: true,
      credential: 'fixture-output-secret',
    },
  }),
  sessionUpdate({
    sessionUpdate: 'usage_update',
    token_usage: {
      inputTokens: -1,
      promptTokens: 1200,
      completion_tokens: 340,
      cache_creation_tokens: 128,
      cache_read_input_tokens: 512,
      note: 'sk-secret-inside-token-usage',
      noteCount: 12345,
      nested: [
        'Bearer nested-token-secret',
        42,
        { outputTokens: 7, completionTokens: 'not-number', otherCount: 9 },
      ],
    },
    cost_usage: { total_cost_usd: 0.012345, currencyCode: 'USD' },
    model_id: 'claude-sonnet-4-6',
    provider_id: 'anthropic',
  }),
  sessionUpdate({
    sessionUpdate: 'session_info_update',
    cwd: 'D:\\aegis\\redacted-session',
    model: 'claude-sonnet-4-6',
    oauthToken: 'fixture-session-info-token',
  }),
  inboundRequest(
    1001,
    'session/request_permission',
    {
      sessionId: acpSessionId,
      toolCall: {
        toolCallId: 'tool-golden-edit',
        title: 'Edit package metadata',
        kind: 'edit',
        status: 'pending',
        rawInput: {
          command: 'node -e "console.log(process.env.ANTHROPIC_API_KEY)"',
          env: {
            ANTHROPIC_API_KEY: 'fixture-approval-secret',
            PATH: 'C:\\Windows\\System32',
          },
        },
      },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    },
  ),
  successResponse('prompt-golden-1', 'session/prompt', {
    stopReason: 'end_turn',
    extra: 'ignored by mapper but retained in raw ACP metadata',
  }),
  errorResponse(
    'new-session-golden-1',
    'session/new',
    {
      code: -32000,
      message: 'provider rejected credentials',
      data: { ANTHROPIC_API_KEY: 'fixture-error-secret', retryable: false },
    },
  ),
  sessionUpdate({
    sessionUpdate: 'mystery_update',
    note: 'kept raw for schema drift analysis',
  }),
  notification('session/unknown_notification', { sessionId: acpSessionId, ignored: true }),
  inboundRequest('unsupported-request-golden-1', 'session/unsupported_request', {
    sessionId: acpSessionId,
  }),
  successResponse('unsupported-success-golden-1', 'session/new', { sessionId: acpSessionId }),
  sessionUpdate({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'image', url: 'https://example.invalid/image.png' },
  }),
  notification('session/update', { sessionId: acpSessionId }),
  notification('session/update', { sessionId: acpSessionId, update: { note: 'missing type' } }),
  sessionUpdate({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'image', url: 'https://example.invalid/thought.png' },
  }),
  sessionUpdate({
    sessionUpdate: 'tool_call',
    title: 'Missing tool call id',
  }),
  sessionUpdate({
    sessionUpdate: 'tool_call_update',
    status: 'completed',
  }),
  sessionUpdate({
    sessionUpdate: 'usage_update',
    cost: { totalCostUsd: 0.5, currency: 'USD' },
  }),
  inboundRequest(1002, 'session/request_permission', { sessionId: acpSessionId }),
];

function sessionUpdate(update: AcpJsonObject): AcpGoldenEventFrame {
  return notification('session/update', { sessionId: acpSessionId, update });
}

function notification(method: string, params: AcpJsonValue): AcpGoldenEventFrame {
  const raw: AcpJsonObject = { jsonrpc: '2.0', method, params };
  return {
    kind: 'notification',
    frame: {
      jsonrpc: '2.0',
      method,
      params,
      raw,
    },
  };
}

function inboundRequest(
  id: AcpJsonRpcId,
  method: string,
  params: AcpJsonValue
): AcpGoldenEventFrame {
  const raw: AcpJsonObject = { jsonrpc: '2.0', id, method, params };
  return {
    kind: 'inboundRequest',
    frame: {
      jsonrpc: '2.0',
      id,
      method,
      params,
      raw,
    },
  };
}

function successResponse(
  id: AcpJsonRpcId,
  requestMethod: string,
  result: AcpJsonValue
): AcpGoldenEventFrame {
  const raw: AcpJsonObject = { jsonrpc: '2.0', id, result };
  return {
    kind: 'successResponse',
    frame: {
      jsonrpc: '2.0',
      id,
      result,
      raw,
      request: { method: requestMethod },
    },
  };
}

function errorResponse(
  id: AcpJsonRpcId,
  requestMethod: string,
  error: AcpJsonRpcErrorObject
): AcpGoldenEventFrame {
  const raw: AcpJsonObject = {
    jsonrpc: '2.0',
    id,
    error: cleanErrorObject(error),
  };
  return {
    kind: 'errorResponse',
    frame: {
      jsonrpc: '2.0',
      id,
      error,
      raw,
      request: { method: requestMethod },
    },
  };
}

function cleanErrorObject(error: AcpJsonRpcErrorObject): AcpJsonObject {
  const output: AcpJsonObject = {};
  if (error.code !== undefined) output.code = error.code;
  if (error.message !== undefined) output.message = error.message;
  if (error.data !== undefined) output.data = error.data;
  return output;
}
