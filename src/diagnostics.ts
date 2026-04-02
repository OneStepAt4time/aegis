/**
 * diagnostics.ts - no-PII diagnostics event stream with bounded in-memory buffer.
 */

import { EventEmitter } from 'node:events';

export type DiagnosticsLevel = 'info' | 'warn' | 'error';

export interface DiagnosticsEvent {
  event: string;
  level: DiagnosticsLevel;
  component: string;
  operation: string;
  sessionId?: string;
  errorCode?: string;
  timestamp: string;
  attributes: Record<string, unknown>;
}

export const DEFAULT_DIAGNOSTICS_BUFFER_SIZE = 100;
const MAX_DIAGNOSTICS_STRING_LENGTH = 200;
const MAX_SANITIZE_DEPTH = 4;

const FORBIDDEN_KEY_FRAGMENTS = [
  'token',
  'password',
  'secret',
  'authorization',
  'cookie',
  'auth',
  'api_key',
  'apikey',
  'prompt',
  'transcript',
  'payload',
  'workdir',
];

function isForbiddenAttribute(key: string): boolean {
  const normalized = key.toLowerCase();
  return FORBIDDEN_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_SANITIZE_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') {
    return value.length > MAX_DIAGNOSTICS_STRING_LENGTH
      ? `${value.slice(0, MAX_DIAGNOSTICS_STRING_LENGTH)}...`
      : value;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const sanitizedObject: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isForbiddenAttribute(key)) continue;
      sanitizedObject[key] = sanitizeValue(nested, depth + 1);
    }
    return sanitizedObject;
  }
  if (value === undefined) return undefined;
  return String(value);
}

export function sanitizeDiagnosticsAttributes(attributes: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!attributes) return {};
  const sanitized = sanitizeValue(attributes);
  return (typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized))
    ? (sanitized as Record<string, unknown>)
    : {};
}

function sanitizeDiagnosticsEvent(event: DiagnosticsEvent): DiagnosticsEvent {
  return {
    ...event,
    attributes: sanitizeDiagnosticsAttributes(event.attributes),
  };
}

export class DiagnosticsBus {
  private readonly emitter = new EventEmitter();
  private readonly buffer: DiagnosticsEvent[] = [];

  constructor(private readonly maxEntries: number = DEFAULT_DIAGNOSTICS_BUFFER_SIZE) {}

  emit(event: DiagnosticsEvent): void {
    const sanitizedEvent = sanitizeDiagnosticsEvent(event);
    this.buffer.push(sanitizedEvent);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
    this.emitter.emit('event', sanitizedEvent);
  }

  subscribe(handler: (event: DiagnosticsEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  getRecent(limit = this.maxEntries): DiagnosticsEvent[] {
    if (limit <= 0) return [];
    return this.buffer.slice(-Math.min(limit, this.maxEntries));
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

export const diagnosticsBus = new DiagnosticsBus();
