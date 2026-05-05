import type { AcpAppendEventInput, AcpEventJsonValue, AcpEventPayload } from './event-store.js';
import type {
  AcpJsonObject,
  AcpJsonRpcId,
  AcpJsonRpcInboundRequest,
  AcpJsonRpcNotification,
  AcpJsonValue,
} from './json-rpc-client.js';
import type { AcpSessionScope } from './types.js';

export interface AcpEventMapperContext extends AcpSessionScope {
  sessionId: string;
  backendRunId?: string;
  occurredAt?: Date;
}

export interface AcpJsonRpcSuccessResponseEvent {
  jsonrpc: '2.0';
  id: AcpJsonRpcId;
  result: AcpJsonValue;
  raw: AcpJsonObject;
  request?: AcpJsonRpcRequestContext;
}

export interface AcpJsonRpcErrorResponseEvent {
  jsonrpc: '2.0';
  id: AcpJsonRpcId;
  error: AcpJsonRpcErrorObject;
  raw: AcpJsonObject;
  request?: AcpJsonRpcRequestContext;
}

export interface AcpJsonRpcRequestContext {
  method: string;
}

export interface AcpJsonRpcErrorObject {
  code?: number;
  message?: string;
  data?: AcpJsonValue;
}

type JsonObject = Record<string, unknown>;

const SENSITIVE_KEY_RE =
  /(token|secret|password|api[_-]?key|authorization|cookie|credential|session[_-]?key)/i;

export function mapAcpJsonRpcNotificationToEvent(
  notification: AcpJsonRpcNotification,
  context: AcpEventMapperContext
): AcpAppendEventInput {
  if (notification.method !== 'session/update') {
    return unsupportedEvent(context, 'unsupported_notification', {
      method: notification.method,
      raw: notification.raw,
    });
  }

  const params = asObject(notification.params);
  const update = asObject(params?.update);
  const acpSessionId = readString(params?.sessionId);
  if (params === undefined || update === undefined) {
    return malformedEvent(context, 'malformed_session_update', {
      method: notification.method,
      sessionId: acpSessionId,
      raw: notification.raw,
    });
  }

  const updateType = readString(update.sessionUpdate);
  if (updateType === undefined) {
    return malformedEvent(context, 'missing_session_update_type', {
      method: notification.method,
      sessionId: acpSessionId,
      raw: notification.raw,
    });
  }

  const acp = acpMetadata({
    method: notification.method,
    sessionId: acpSessionId,
    updateType,
    raw: notification.raw,
  });

  switch (updateType) {
    case 'agent_message_chunk':
      return mapTextDelta(context, 'message.delta', update, acp, 'malformed_agent_message_chunk');
    case 'agent_thought_chunk':
      return mapTextDelta(context, 'thinking.delta', update, acp, 'malformed_agent_thought_chunk');
    case 'tool_call':
      return mapToolStarted(context, update, acp);
    case 'tool_call_update':
      return mapToolCompleted(context, update, acp);
    case 'usage_update':
      return mapUsageUpdated(context, update, acp);
    case 'session_info_update':
      return storeEvent(context, 'session.updated', {
        schemaVersion: 1,
        updateType,
        data: objectWithout(update, 'sessionUpdate'),
        acp,
      });
    default:
      // ACP-043 keeps unverified runtime shapes for ACP-048 golden contract coverage.
      return unsupportedEvent(context, 'unsupported_session_update', {
        method: notification.method,
        sessionId: acpSessionId,
        updateType,
        raw: notification.raw,
      });
  }
}

export function mapAcpJsonRpcRequestToEvent(
  request: AcpJsonRpcInboundRequest,
  context: AcpEventMapperContext
): AcpAppendEventInput {
  if (request.method !== 'session/request_permission') {
    return unsupportedEvent(context, 'unsupported_inbound_request', {
      method: request.method,
      requestId: request.id,
      raw: request.raw,
    });
  }

  const params = asObject(request.params);
  const toolCall = asObject(params?.toolCall);
  const options = Array.isArray(params?.options) ? params.options : undefined;
  const acpSessionId = readString(params?.sessionId);
  if (params === undefined || toolCall === undefined || options === undefined) {
    return malformedEvent(context, 'malformed_permission_request', {
      method: request.method,
      requestId: request.id,
      sessionId: acpSessionId,
      raw: request.raw,
    });
  }

  return storeEvent(context, 'approval.requested', {
    schemaVersion: 1,
    requestId: normalizeJsonRpcId(request.id) ?? null,
    toolCall: cleanObject({
      toolCallId: readString(toolCall.toolCallId),
      title: readString(toolCall.title),
      kind: readString(toolCall.kind),
      status: readString(toolCall.status),
    }),
    options: options.flatMap(option => normalizePermissionOption(option)),
    acp: acpMetadata({
      method: request.method,
      requestId: request.id,
      sessionId: acpSessionId,
      raw: request.raw,
    }),
  });
}

export function mapAcpJsonRpcSuccessResponseToEvent(
  response: AcpJsonRpcSuccessResponseEvent,
  context: AcpEventMapperContext
): AcpAppendEventInput {
  const result = asObject(response.result);
  const stopReason = readString(result?.stopReason);
  if (response.request?.method === 'session/prompt' && stopReason !== undefined) {
    return storeEvent(context, 'turn.completed', {
      schemaVersion: 1,
      stopReason,
      acp: acpMetadata({
        requestId: response.id,
        requestMethod: response.request.method,
        raw: response.raw,
      }),
    });
  }

  return unsupportedEvent(context, 'unsupported_success_response', {
    requestId: response.id,
    requestMethod: response.request?.method,
    raw: response.raw,
  });
}

export function mapAcpJsonRpcErrorResponseToEvent(
  response: AcpJsonRpcErrorResponseEvent,
  context: AcpEventMapperContext
): AcpAppendEventInput {
  return storeEvent(context, 'session.error', {
    schemaVersion: 1,
    ...cleanObject({
      code: typeof response.error.code === 'number' ? response.error.code : undefined,
      message: readString(response.error.message) ?? 'ACP JSON-RPC request failed',
      data:
        response.error.data === undefined ? undefined : redactEventJsonValue(response.error.data),
    }),
    acp: acpMetadata({
      requestId: response.id,
      requestMethod: response.request?.method,
      raw: response.raw,
    }),
  });
}

function mapTextDelta(
  context: AcpEventMapperContext,
  eventType: 'message.delta' | 'thinking.delta',
  update: JsonObject,
  acp: AcpEventJsonValue,
  malformedReason: string
): AcpAppendEventInput {
  const content = asObject(update.content);
  const text = content?.type === 'text' ? readString(content.text) : undefined;
  if (text === undefined) {
    return malformedEvent(context, malformedReason, {
      updateType: readString(update.sessionUpdate),
      raw: acpRawObject(acp),
    });
  }

  return storeEvent(context, eventType, {
    schemaVersion: 1,
    text,
    ...cleanObject({ messageId: readString(update.messageId) }),
    acp,
  });
}

function mapToolStarted(
  context: AcpEventMapperContext,
  update: JsonObject,
  acp: AcpEventJsonValue
): AcpAppendEventInput {
  const toolCallId = readString(update.toolCallId);
  const title = readString(update.title);
  if (toolCallId === undefined || title === undefined) {
    return malformedEvent(context, 'malformed_tool_call', {
      updateType: readString(update.sessionUpdate),
      raw: acpRawObject(acp),
    });
  }

  return storeEvent(context, 'tool.started', {
    schemaVersion: 1,
    toolCallId,
    title,
    ...cleanObject({
      kind: readString(update.kind),
      status: readString(update.status),
      input: update.rawInput === undefined ? undefined : redactEventJsonValue(update.rawInput),
    }),
    acp,
  });
}

function mapToolCompleted(
  context: AcpEventMapperContext,
  update: JsonObject,
  acp: AcpEventJsonValue
): AcpAppendEventInput {
  const toolCallId = readString(update.toolCallId);
  if (toolCallId === undefined) {
    return malformedEvent(context, 'malformed_tool_call_update', {
      updateType: readString(update.sessionUpdate),
      raw: acpRawObject(acp),
    });
  }

  return storeEvent(context, 'tool.completed', {
    schemaVersion: 1,
    toolCallId,
    ...cleanObject({
      status: readString(update.status),
      text: readToolText(update.content),
      output: update.rawOutput === undefined ? undefined : redactEventJsonValue(update.rawOutput),
    }),
    acp,
  });
}

function mapUsageUpdated(
  context: AcpEventMapperContext,
  update: JsonObject,
  acp: AcpEventJsonValue
): AcpAppendEventInput {
  const usage = normalizeTokenUsage(update);
  if (usage === undefined) {
    return malformedEvent(context, 'malformed_usage_update', {
      updateType: readString(update.sessionUpdate),
      raw: acpRawObject(acp),
    });
  }

  return storeEvent(context, 'usage.updated', {
    schemaVersion: 1,
    usage,
    ...cleanObject({
      cost: normalizeUsageCost(update),
      model: readStringFromObjects([update], ['model', 'modelId', 'model_id']),
      provider: readStringFromObjects([update], ['provider', 'providerId', 'provider_id']),
    }),
    acp,
  });
}

function normalizeTokenUsage(update: JsonObject): AcpEventJsonValue | undefined {
  const sources = [
    asObject(update.usage),
    asObject(update.tokenUsage),
    asObject(update.token_usage),
    update,
  ].filter(isDefined);
  const inputTokens = readNumberFromObjects(sources, [
    'inputTokens',
    'input_tokens',
    'promptTokens',
    'prompt_tokens',
  ]);
  const outputTokens = readNumberFromObjects(sources, [
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
  ]);
  const cacheCreationTokens = readNumberFromObjects(sources, [
    'cacheCreationInputTokens',
    'cache_creation_input_tokens',
    'cacheCreationTokens',
    'cache_creation_tokens',
  ]);
  const cacheReadTokens = readNumberFromObjects(sources, [
    'cacheReadInputTokens',
    'cache_read_input_tokens',
    'cacheReadTokens',
    'cache_read_tokens',
  ]);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cacheCreationTokens === undefined &&
    cacheReadTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    cacheCreationTokens: cacheCreationTokens ?? 0,
    cacheReadTokens: cacheReadTokens ?? 0,
  };
}

function normalizeUsageCost(update: JsonObject): AcpEventJsonValue | undefined {
  const sources = [
    asObject(update.cost),
    asObject(update.costUsage),
    asObject(update.cost_usage),
    update,
  ].filter(isDefined);
  const amountUsd = readNumberFromObjects(sources, [
    'amountUsd',
    'amount_usd',
    'costUsd',
    'cost_usd',
    'totalCostUsd',
    'total_cost_usd',
  ]);
  const currency = readStringFromObjects(sources, ['currency', 'currencyCode', 'currency_code']);

  if (amountUsd === undefined && currency === undefined) return undefined;
  return cleanObject({ amountUsd, currency });
}

function readToolText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    const wrapper = asObject(item);
    if (wrapper?.type !== 'content') continue;
    const block = asObject(wrapper.content);
    if (block?.type === 'text') {
      const text = readString(block.text);
      if (text !== undefined) return text;
    }
  }
  return undefined;
}

function normalizePermissionOption(option: unknown): AcpEventJsonValue[] {
  const object = asObject(option);
  if (object === undefined) return [];
  const optionId = readString(object.optionId);
  const name = readString(object.name);
  const kind = readString(object.kind);
  if (optionId === undefined || name === undefined || kind === undefined) return [];
  return [{ optionId, name, kind }];
}

function unsupportedEvent(
  context: AcpEventMapperContext,
  reason: string,
  metadata: AcpMetadataInput
): AcpAppendEventInput {
  return storeEvent(context, 'acp.unsupported', {
    schemaVersion: 1,
    reason,
    acp: acpMetadata(metadata),
  });
}

function malformedEvent(
  context: AcpEventMapperContext,
  reason: string,
  metadata: AcpMetadataInput
): AcpAppendEventInput {
  return storeEvent(context, 'acp.malformed', {
    schemaVersion: 1,
    reason,
    acp: acpMetadata(metadata),
  });
}

function storeEvent(
  context: AcpEventMapperContext,
  eventType: string,
  payload: AcpEventPayload
): AcpAppendEventInput {
  return {
    sessionId: context.sessionId,
    tenantId: context.tenantId,
    ownerKeyId: context.ownerKeyId,
    ...(context.backendRunId !== undefined ? { backendRunId: context.backendRunId } : {}),
    eventType,
    ...(context.occurredAt !== undefined ? { occurredAt: context.occurredAt } : {}),
    payload,
  };
}

interface AcpMetadataInput {
  method?: string;
  requestId?: AcpJsonRpcId;
  requestMethod?: string;
  sessionId?: string;
  updateType?: string;
  raw?: unknown;
}

function acpMetadata(input: AcpMetadataInput): AcpEventJsonValue {
  return cleanObject({
    method: input.method,
    requestId: normalizeJsonRpcId(input.requestId),
    requestMethod: input.requestMethod,
    sessionId: input.sessionId,
    updateType: input.updateType,
    raw: input.raw === undefined ? undefined : redactEventJsonValue(input.raw),
  });
}

function acpRawObject(acp: AcpEventJsonValue): AcpEventJsonValue | undefined {
  const object = asObject(acp);
  return object?.raw === undefined ? undefined : redactEventJsonValue(object.raw);
}

function normalizeJsonRpcId(id: AcpJsonRpcId | undefined): AcpEventJsonValue | undefined {
  if (typeof id === 'string' || typeof id === 'number' || id === null) return id;
  return undefined;
}

function objectWithout(object: JsonObject, excludedKey: string): Record<string, AcpEventJsonValue> {
  const output: Record<string, AcpEventJsonValue> = {};
  for (const [key, value] of Object.entries(object)) {
    if (key === excludedKey || value === undefined) continue;
    output[key] = redactEventJsonValue(value, key);
  }
  return output;
}

function cleanObject(values: Record<string, unknown>): Record<string, AcpEventJsonValue> {
  const output: Record<string, AcpEventJsonValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    output[key] = redactEventJsonValue(value, key);
  }
  return output;
}

function redactEventJsonValue(value: unknown, key?: string): AcpEventJsonValue {
  if (key !== undefined && SENSITIVE_KEY_RE.test(key) && value !== undefined && value !== null) {
    return '[REDACTED]';
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(item => redactEventJsonValue(item));
  if (isPlainObject(value)) {
    const output: Record<string, AcpEventJsonValue> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childValue === undefined) continue;
      output[childKey] = redactEventJsonValue(childValue, childKey);
    }
    return output;
  }
  return null;
}

function readNumberFromObjects(
  sources: readonly JsonObject[],
  keys: readonly string[]
): number | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    }
  }
  return undefined;
}

function readStringFromObjects(
  sources: readonly JsonObject[],
  keys: readonly string[]
): string | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = readString(source[key]);
      if (value !== undefined) return value;
    }
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asObject(value: unknown): JsonObject | undefined {
  return isPlainObject(value) ? value : undefined;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
