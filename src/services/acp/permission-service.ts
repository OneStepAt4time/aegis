function requireNewSessionResponse(
  message: JsonRpcSuccess<unknown>
): JsonRpcSuccess<AcpNewSessionResult> {
  const result = requireObject(message.result, 'session/new result');
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      sessionId: requireString(result.sessionId, 'session/new sessionId'),
    },
  };
}

function requirePromptResponse(message: JsonRpcSuccess<unknown>): JsonRpcSuccess<AcpPromptResult> {
  const result = requireObject(message.result, 'session/prompt result');
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: {
      stopReason: requireString(result.stopReason, 'session/prompt stopReason'),
    },
  };
}

function requireObjectResponse(message: JsonRpcSuccess<unknown>): JsonRpcSuccess<JsonObject> {
  return {
    jsonrpc: '2.0',
    id: message.id,
    result: requireObject(message.result, 'JSON-RPC result'),
  };
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new AcpProtocolError(`${label} must be an object`, { value });
  }
  return value;
}

function normalizeApprovalRequest(id: JsonRpcId, params: unknown): NormalizedApprovalRequest {
  const request = requireObject(params, 'session/request_permission params');
  const optionsValue = request.options;
  if (!Array.isArray(optionsValue)) {
    throw new AcpProtocolError('ACP permission request options must be an array', {
      method: 'session/request_permission',
    });
  }
  const rawSessionId = requireString(request.sessionId, 'session/request_permission sessionId');
  const normalizedOptions = optionsValue.map(normalizePermissionOption);

  return {
    request: {
      requestId: id,
      sessionId: redactApprovalString(rawSessionId),
      toolCall: normalizeApprovalToolCall(request.toolCall),
      options: normalizedOptions.slice(0, APPROVAL_ARRAY_LIMIT_ITEMS).map(option => option.surface),
      state: 'pending',
    },
    rawSessionId,
    responseOptions: normalizedOptions.map(option => option.response),
  };
}

function normalizePermissionOption(value: unknown): {
  surface: AcpPermissionOption;
  response: AcpPermissionOption;
} {
  const option = requireObject(value, 'session/request_permission option');
  const optionId = requireString(option.optionId, 'session/request_permission option.optionId');
  const kind = requireString(option.kind, 'session/request_permission option.kind');
  if (!isPermissionOptionKind(kind)) {
    throw new AcpProtocolError('ACP permission option kind is unsupported', {
      method: 'session/request_permission',
      optionId,
      kind,
    });
  }
  return {
    surface: {
      optionId: redactApprovalString(optionId),
      name: redactApprovalString(
        requireString(option.name, 'session/request_permission option.name')
      ),
      kind,
    },
    response: {
      optionId,
      name: requireString(option.name, 'session/request_permission option.name'),
      kind,
    },
  };
}

function normalizeApprovalToolCall(value: unknown): AcpApprovalToolCall {
  const toolCall = requireObject(value, 'session/request_permission toolCall');
  return {
    toolCallId: redactApprovalString(
      requireString(toolCall.toolCallId, 'session/request_permission toolCall.toolCallId')
    ),
    title: optionalRedactedStringOrNull(
      toolCall.title,
      'session/request_permission toolCall.title'
    ),
    kind: optionalRedactedStringOrNull(toolCall.kind, 'session/request_permission toolCall.kind'),
    status: optionalRedactedStringOrNull(
      toolCall.status,
      'session/request_permission toolCall.status'
    ),
    rawInput:
      toolCall.rawInput === undefined
        ? undefined
        : sanitizeAcpApprovalValue(toolCall.rawInput, undefined),
    rawOutput:
      toolCall.rawOutput === undefined
        ? undefined
        : sanitizeAcpApprovalValue(toolCall.rawOutput, undefined),
    locations:
      toolCall.locations === undefined
        ? undefined
        : sanitizeAcpApprovalValue(toolCall.locations, undefined),
    content:
      toolCall.content === undefined
        ? undefined
        : sanitizeAcpApprovalValue(toolCall.content, undefined),
  };
}

function approvalResponseFromDecision(
  request: AcpApprovalRequest,
  decision: AcpApprovalDecision,
  responseOptions: readonly AcpPermissionOption[] = request.options
): AcpApprovalResponse {
  if (decision.outcome === 'cancelled') return { outcome: { outcome: 'cancelled' } };

  const selectedOption =
    'optionId' in decision
      ? findResponseOptionById(request.options, responseOptions, decision.optionId)
      : responseOptions.find(option => option.kind === decision.optionKind);
  if (!selectedOption) {
    throw new AcpProtocolError('ACP permission decision did not match an available option', {
      method: 'session/request_permission',
      requestId: request.requestId,
      decision,
    });
  }

  return { outcome: { outcome: 'selected', optionId: selectedOption.optionId } };
}

function findResponseOptionById(
  surfaceOptions: readonly AcpPermissionOption[],
  responseOptions: readonly AcpPermissionOption[],
  optionId: string
): AcpPermissionOption | undefined {
  const directMatch = responseOptions.find(option => option.optionId === optionId);
  if (directMatch) return directMatch;
  const surfaceIndex = surfaceOptions.findIndex(option => option.optionId === optionId);
  return surfaceIndex === -1 ? undefined : responseOptions[surfaceIndex];
}

function surfaceApprovalResponse(response: AcpApprovalResponse): AcpApprovalResponse {
  if (response.outcome.outcome === 'cancelled') return response;
  return {
    outcome: {
      outcome: 'selected',
      optionId: redactApprovalString(response.outcome.optionId),
    },
  };
}

function summarizeOutboundMessage(message: JsonObject): JsonObject {
  return {
    jsonrpc: message.jsonrpc === '2.0' ? '2.0' : undefined,
    id: isJsonRpcId(message.id) ? message.id : undefined,
    method: typeof message.method === 'string' ? message.method : undefined,
    hasResult: Object.hasOwn(message, 'result'),
    hasError: Object.hasOwn(message, 'error'),
  };
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AcpProtocolError(`${label} must be an array`, { value });
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new AcpProtocolError(`${label} must be a string`, { value });
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function optionalStringOrNull(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requireString(value, label);
}

function optionalRedactedStringOrNull(value: unknown, label: string): string | undefined {
  const stringValue = optionalStringOrNull(value, label);
  return stringValue === undefined ? undefined : redactApprovalString(stringValue);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new AcpProtocolError(`${label} must be a number`, { value });
  }
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string' || value === null;
}

function isPermissionOptionKind(value: string): value is AcpPermissionOptionKind {
  return (
    value === 'allow_once' ||
    value === 'allow_always' ||
    value === 'reject_once' ||
    value === 'reject_always'
  );
}

function sanitizeAcpApprovalValue(value: unknown, key: string | undefined): unknown {
  if (key && isSensitiveApprovalKey(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactApprovalString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, APPROVAL_ARRAY_LIMIT_ITEMS)
      .map(item => sanitizeAcpApprovalValue(item, undefined));
    if (value.length > APPROVAL_ARRAY_LIMIT_ITEMS) sanitized.push('[TRUNCATED_ITEMS]');
    return sanitized;
  }
  if (isJsonObject(value)) {
    const entries = Object.entries(value).slice(0, APPROVAL_OBJECT_LIMIT_KEYS);
    const sanitized: JsonObject = {};
    const usedKeys = new Set<string>();
    for (const [entryKey, entryValue] of entries) {
      const sanitizedKey = uniqueJsonObjectKey(redactApprovalString(entryKey), usedKeys);
      sanitized[sanitizedKey] = sanitizeAcpApprovalValue(entryValue, entryKey);
    }
    if (Object.keys(value).length > APPROVAL_OBJECT_LIMIT_KEYS) {
      sanitized.__truncatedKeys = Object.keys(value).length - APPROVAL_OBJECT_LIMIT_KEYS;
    }
    return sanitized;
  }
  return String(value);
}

function toAcpProtocolError(
  error: unknown,
  message: string,
  details: JsonObject = {}
): AcpProtocolError {
  if (error instanceof AcpProtocolError) {
    return new AcpProtocolError(error.message, { ...details, ...error.details });
  }
  return new AcpProtocolError(message, {
    ...details,
    message: error instanceof Error ? error.message : String(error),
  });
}

function isSensitiveApprovalKey(key: string): boolean {
  return /(authorization|cookie|api[_-]?key|auth[_-]?token|token|secret|password|credential)/i.test(
    key
  );
}

function redactApprovalString(value: string): string {
  const boundedValue = truncateUtf8(value, APPROVAL_STRING_LIMIT_BYTES);
  const withoutSettingsPath = boundedValue.replace(
    /[^\s'"]*settings\.local\.json/gi,
    '[REDACTED_PATH]'
  );
  const withoutSecretTokens = withoutSettingsPath.replace(
    /\bsk-(?:ant|live|test|proj)-[A-Za-z0-9_-]+\b/g,
    '[REDACTED]'
  );
  const withoutBearer = withoutSecretTokens.replace(
    /\b(Bearer|token|api[_-]?key|secret)\s+['"]?[^'",\s]+/gi,
    '$1 [REDACTED]'
  );
  const withoutAssignments = withoutBearer.replace(
    /\b((?:authorization|token|api[_-]?key|secret)\s*[:=]\s*)['"]?[^'",\s]+/gi,
    '$1[REDACTED]'
  );
  return truncateUtf8(withoutAssignments, APPROVAL_STRING_LIMIT_BYTES);
}

function uniqueJsonObjectKey(candidate: string, usedKeys: Set<string>): string {
  if (!usedKeys.has(candidate)) {
    usedKeys.add(candidate);
    return candidate;
  }

  let index = 2;
  while (true) {
    const suffix = `#${index}`;
    const key = truncateUtf8(candidate, APPROVAL_STRING_LIMIT_BYTES - Buffer.byteLength(suffix));
    const uniqueKey = `${key}${suffix}`;
    if (!usedKeys.has(uniqueKey)) {
      usedKeys.add(uniqueKey);
      return uniqueKey;
    }
    index += 1;
  }
}

function appendLimited(current: string, chunk: string, limitBytes: number): string {
  const combined = Buffer.from(`${current}${chunk}`, 'utf8');
  if (combined.length <= limitBytes) return combined.toString('utf8');

  let start = combined.length - limitBytes;
  while (start < combined.length && (combined[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return combined.subarray(start).toString('utf8');
}

function truncateUtf8(value: string, limitBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= limitBytes) return value;

  const suffix = '…[TRUNCATED]';
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  let end = Math.max(0, limitBytes - suffixBytes);
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return `${encoded.subarray(0, end).toString('utf8')}${suffix}`;
}
