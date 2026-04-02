/**
 * diagnostics.ts — no-PII diagnostics event stream with bounded in-memory buffer.
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

const FORBIDDEN_KEYS = new Set([
  'token',
  'password',
  'secret',
  'authorization',
  'workdir',
  'prompt',
]);

function isForbiddenAttribute(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase());
}

export function sanitizeDiagnosticsAttributes(attributes: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!attributes) return {};
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (isForbiddenAttribute(key)) continue;
    if (typeof value === 'string') {
      sanitized[key] = value.length > 200 ? `${value.slice(0, 200)}...` : value;
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export class DiagnosticsBus {
  private readonly emitter = new EventEmitter();
  private readonly buffer: DiagnosticsEvent[] = [];

  constructor(private readonly maxEntries: number = 200) {}

  emit(event: DiagnosticsEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.splice(0, this.buffer.length - this.maxEntries);
    }
    this.emitter.emit('event', event);
  }

  subscribe(handler: (event: DiagnosticsEvent) => void): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  getRecent(): DiagnosticsEvent[] {
    return [...this.buffer];
  }

  clear(): void {
    this.buffer.length = 0;
  }
}

export const diagnosticsBus = new DiagnosticsBus();
