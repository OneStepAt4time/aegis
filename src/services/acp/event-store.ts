import type { AcpSessionScope } from './types.js';

export type AcpEventJsonValue =
  | string
  | number
  | boolean
  | null
  | AcpEventJsonValue[]
  | { [key: string]: AcpEventJsonValue };

/**
 * JSON payload stored with an ACP event.
 *
 * Callers must provide payloads that are already redacted and bounded. The event
 * store preserves the payload as durable history; it does not inspect or redact
 * protocol-specific content.
 */
export type AcpEventPayload = AcpEventJsonValue;

export interface AcpEventRecord extends AcpSessionScope {
  sessionId: string;
  eventSeq: number;
  eventId: string;
  backendRunId?: string;
  eventType: string;
  occurredAt: Date;
  ingestedAt: Date;
  payload: AcpEventPayload;
  payloadRef?: string;
}

export interface AcpAppendEventInput extends AcpSessionScope {
  sessionId: string;
  backendRunId?: string;
  eventType: string;
  occurredAt?: Date;
  payload: AcpEventPayload;
  payloadRef?: string;
}

export interface AcpListEventsInput extends AcpSessionScope {
  sessionId: string;
  afterEventSeq?: number;
  limit?: number;
}

export interface AcpEventStore {
  append(input: AcpAppendEventInput): Promise<AcpEventRecord>;
  list(input: AcpListEventsInput): Promise<AcpEventRecord[]>;
}
