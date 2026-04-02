/**
 * logger.ts - structured logger that also emits sanitized diagnostics events.
 */

import {
  diagnosticsBus,
  type DiagnosticsBus,
  sanitizeDiagnosticsAttributes,
  type DiagnosticsLevel,
} from './diagnostics.js';

export interface LogContext {
  component: string;
  operation: string;
  sessionId?: string;
  errorCode?: string;
  attributes?: Record<string, unknown>;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: DiagnosticsLevel;
  component: string;
  operation: string;
  sessionId?: string;
  errorCode?: string;
  attributes: Record<string, unknown>;
}

export interface StructuredLogSink {
  info?: (record: StructuredLogRecord) => void;
  warn?: (record: StructuredLogRecord) => void;
  error?: (record: StructuredLogRecord) => void;
}

const defaultSink: Required<StructuredLogSink> = {
  info: (record) => console.log(JSON.stringify(record)),
  warn: (record) => console.warn(JSON.stringify(record)),
  error: (record) => console.error(JSON.stringify(record)),
};

let sink: StructuredLogSink = defaultSink;

export function setStructuredLogSink(nextSink: StructuredLogSink): void {
  sink = {
    info: nextSink.info ?? defaultSink.info,
    warn: nextSink.warn ?? defaultSink.warn,
    error: nextSink.error ?? defaultSink.error,
  };
}

export class StructuredLogger {
  constructor(private readonly bus: DiagnosticsBus = diagnosticsBus) {}

  info(ctx: LogContext): void {
    this.log('info', ctx);
  }

  warn(ctx: LogContext): void {
    this.log('warn', ctx);
  }

  error(ctx: LogContext): void {
    this.log('error', ctx);
  }

  private log(level: DiagnosticsLevel, ctx: LogContext): void {
    const timestamp = new Date().toISOString();
    const attributes = sanitizeDiagnosticsAttributes(ctx.attributes);
    const record: StructuredLogRecord = {
      timestamp,
      level,
      component: ctx.component,
      operation: ctx.operation,
      sessionId: ctx.sessionId,
      errorCode: ctx.errorCode,
      attributes,
    };

    if (level === 'error') {
      sink.error?.(record);
    } else if (level === 'warn') {
      sink.warn?.(record);
    } else {
      sink.info?.(record);
    }

    this.bus.emit({
      event: `${ctx.component}.${ctx.operation}`,
      level,
      component: ctx.component,
      operation: ctx.operation,
      sessionId: ctx.sessionId,
      errorCode: ctx.errorCode,
      timestamp,
      attributes,
    });
  }
}

export const logger = new StructuredLogger();
