type JsonObject = Record<string, unknown>;

export interface AcpCapturedFrame {
  direction: 'client_to_agent' | 'agent_to_client';
  message: JsonObject;
}

interface BaseNormalizedEvent {
  sessionId: string;
}

type AcpNormalizedEventBody =
  | (BaseNormalizedEvent & {
      type: 'text' | 'thinking';
      text: string;
      messageId?: string;
    })
  | (BaseNormalizedEvent & {
      type: 'tool_call';
      toolCallId: string;
      title: string;
      kind?: string;
      status?: string;
    })
  | (BaseNormalizedEvent & {
      type: 'tool_result';
      toolCallId: string;
      status?: string;
      text?: string;
    })
  | (BaseNormalizedEvent & {
      type: 'approval_request';
      requestId: number | string;
      toolCallId?: string;
      title?: string;
      options: NormalizedPermissionOption[];
    })
  | (BaseNormalizedEvent & {
      type: 'turn_complete';
      stopReason: string;
    })
  | (BaseNormalizedEvent & {
      type: 'unknown';
      acpUpdateType: string;
    });

export type AcpNormalizedEvent = AcpNormalizedEventBody & { sequence: number };

export interface NormalizedPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

interface PromptRequest {
  method: string;
  sessionId?: string;
}

export function normalizeAcpFrames(frames: readonly AcpCapturedFrame[]): AcpNormalizedEvent[] {
  const requests = new Map<number | string, PromptRequest>();
  const events: AcpNormalizedEvent[] = [];
  let currentSessionId: string | undefined;

  for (const frame of frames) {
    const { message } = frame;

    if (frame.direction === 'client_to_agent') {
      const id = message.id;
      const method = message.method;
      if ((typeof id === 'number' || typeof id === 'string') && typeof method === 'string') {
        requests.set(id, {
          method,
          sessionId: readSessionIdFromParams(message.params),
        });
      }
      continue;
    }

    const normalized = normalizeAgentFrame(message, requests, currentSessionId);
    if (normalized) {
      events.push({ ...normalized, sequence: events.length + 1 });
      currentSessionId = normalized.sessionId;
    }
  }

  return events;
}

function normalizeAgentFrame(
  message: JsonObject,
  requests: ReadonlyMap<number | string, PromptRequest>,
  currentSessionId: string | undefined
): AcpNormalizedEventBody | null {
  if (message.method === 'session/update') {
    return normalizeSessionUpdate(message.params);
  }

  if (message.method === 'session/request_permission') {
    return normalizeApprovalRequest(message.id, message.params);
  }

  const id = message.id;
  if (typeof id !== 'number' && typeof id !== 'string') return null;
  const request = requests.get(id);

  const result = message.result;
  if (!isJsonObject(result)) return null;
  const stopReason = result.stopReason;
  if (typeof stopReason !== 'string') return null;
  if (request && request.method !== 'session/prompt') return null;

  const sessionId = request?.sessionId ?? currentSessionId;
  if (!sessionId) return null;

  return {
    type: 'turn_complete',
    sessionId,
    stopReason,
  };
}

function normalizeSessionUpdate(params: unknown): AcpNormalizedEventBody | null {
  if (!isJsonObject(params)) return null;
  const sessionId = params.sessionId;
  const update = params.update;
  if (typeof sessionId !== 'string' || !isJsonObject(update)) return null;

  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return normalizeTextChunk('text', sessionId, update);
    case 'agent_thought_chunk':
      return normalizeTextChunk('thinking', sessionId, update);
    case 'tool_call':
      return normalizeToolCall(sessionId, update);
    case 'tool_call_update':
      return normalizeToolResult(sessionId, update);
    case 'available_commands_update':
    case 'current_mode_update':
    case 'config_option_update':
    case 'session_info_update':
    case 'usage_update':
    case 'plan':
    case 'user_message_chunk':
      return null;
    default:
      return typeof update.sessionUpdate === 'string'
        ? {
            type: 'unknown',
            sessionId,
            acpUpdateType: update.sessionUpdate,
          }
        : null;
  }
}

function normalizeTextChunk(
  type: 'text' | 'thinking',
  sessionId: string,
  update: JsonObject
): AcpNormalizedEventBody | null {
  const content = update.content;
  if (!isJsonObject(content) || content.type !== 'text' || typeof content.text !== 'string') {
    return null;
  }

  const event: AcpNormalizedEventBody = {
    type,
    sessionId,
    text: content.text,
  };

  if (typeof update.messageId === 'string') {
    return { ...event, messageId: update.messageId };
  }
  return event;
}

function normalizeToolCall(sessionId: string, update: JsonObject): AcpNormalizedEventBody | null {
  if (typeof update.toolCallId !== 'string' || typeof update.title !== 'string') return null;

  const event: AcpNormalizedEventBody = {
    type: 'tool_call',
    sessionId,
    toolCallId: update.toolCallId,
    title: update.title,
  };

  return {
    ...event,
    ...(typeof update.kind === 'string' ? { kind: update.kind } : {}),
    ...(typeof update.status === 'string' ? { status: update.status } : {}),
  };
}

function normalizeToolResult(sessionId: string, update: JsonObject): AcpNormalizedEventBody | null {
  if (typeof update.toolCallId !== 'string') return null;

  return {
    type: 'tool_result',
    sessionId,
    toolCallId: update.toolCallId,
    ...(typeof update.status === 'string' ? { status: update.status } : {}),
    ...normalizeToolContentText(update.content),
  };
}

function normalizeToolContentText(content: unknown): { text?: string } {
  if (!Array.isArray(content)) return {};

  for (const item of content) {
    if (!isJsonObject(item) || item.type !== 'content') continue;
    const block = item.content;
    if (isJsonObject(block) && block.type === 'text' && typeof block.text === 'string') {
      return { text: block.text };
    }
  }

  return {};
}

function normalizeApprovalRequest(id: unknown, params: unknown): AcpNormalizedEventBody | null {
  if ((typeof id !== 'number' && typeof id !== 'string') || !isJsonObject(params)) return null;

  const sessionId = params.sessionId;
  const toolCall = params.toolCall;
  const options = params.options;
  if (typeof sessionId !== 'string' || !isJsonObject(toolCall) || !Array.isArray(options)) {
    return null;
  }

  const normalizedOptions = options.flatMap(option => normalizePermissionOption(option));
  const event: AcpNormalizedEventBody = {
    type: 'approval_request',
    sessionId,
    requestId: id,
    options: normalizedOptions,
  };

  return {
    ...event,
    ...(typeof toolCall.toolCallId === 'string' ? { toolCallId: toolCall.toolCallId } : {}),
    ...(typeof toolCall.title === 'string' ? { title: toolCall.title } : {}),
  };
}

function normalizePermissionOption(option: unknown): NormalizedPermissionOption[] {
  if (!isJsonObject(option)) return [];
  const { optionId, name, kind } = option;
  if (typeof optionId !== 'string' || typeof name !== 'string' || typeof kind !== 'string') {
    return [];
  }
  return [{ optionId, name, kind }];
}

function readSessionIdFromParams(params: unknown): string | undefined {
  return isJsonObject(params) && typeof params.sessionId === 'string'
    ? params.sessionId
    : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
