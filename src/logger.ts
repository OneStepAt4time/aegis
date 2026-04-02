/**
 * logger.ts — structured logger that also emits sanitized diagnostics events.
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

interface StructuredLogRecord {
  timestamp: string;
  level: DiagnosticsLevel;
  component: string;
  operation: string;
  sessionId?: string;
  errorCode?: string;
  attributes: Record<string, unknown>;
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

    const payload = JSON.stringify(record);
    if (level === 'error') {
      console.error(payload);
    } else if (level === 'warn') {
      console.warn(payload);
    } else {
      console.log(payload);
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
