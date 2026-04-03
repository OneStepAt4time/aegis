export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  error: string;
}

interface NormalizeApiErrorInput {
  payload: unknown;
  statusCode: number;
  requestId: string;
  contentType?: string;
}

function defaultErrorMessage(statusCode: number): string {
  if (statusCode >= 500) return 'Internal server error';
  if (statusCode === 404) return 'Not found';
  if (statusCode === 401) return 'Unauthorized';
  if (statusCode === 403) return 'Forbidden';
  if (statusCode === 429) return 'Rate limit exceeded';
  return 'Request failed';
}

function mapStatusToCode(statusCode: number): string {
  if (statusCode === 400) return 'VALIDATION_ERROR';
  if (statusCode === 401) return 'UNAUTHORIZED';
  if (statusCode === 403) return 'FORBIDDEN';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode === 501) return 'NOT_IMPLEMENTED';
  if (statusCode >= 500) return 'INTERNAL_ERROR';
  return `HTTP_${statusCode}`;
}

function parseJsonObjectString(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function isJsonContentType(contentType?: string): boolean {
  return typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');
}

export function normalizeApiErrorPayload(input: NormalizeApiErrorInput): unknown {
  const { payload, statusCode, requestId, contentType } = input;
  if (statusCode < 400) return payload;
  if (typeof contentType === 'string' && contentType.includes('text/event-stream')) return payload;

  let source: Record<string, unknown> | null = null;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && !(payload instanceof Buffer)) {
    source = payload as Record<string, unknown>;
  } else if (typeof payload === 'string' && isJsonContentType(contentType)) {
    source = parseJsonObjectString(payload);
  }

  if (!source) return payload;

  const legacyError = typeof source.error === 'string' ? source.error : undefined;
  const sourceMessage = typeof source.message === 'string' ? source.message : undefined;
  const message = sourceMessage ?? legacyError ?? defaultErrorMessage(statusCode);
  const code = typeof source.code === 'string' ? source.code : mapStatusToCode(statusCode);
  const envelope: ApiErrorEnvelope = {
    code,
    message,
    requestId,
    error: legacyError ?? message,
  };

  if (source.details !== undefined) {
    envelope.details = source.details;
  }

  if (typeof payload === 'string') {
    return JSON.stringify(envelope);
  }

  return envelope;
}
