/**
 * api/acp-timeline-client.ts — API client for ACP operator timeline.
 *
 * Calls POST /v1/sessions/:id/events/replay and maps raw event store
 * records into the AcpTimelineEvent shape expected by OperatorTimeline.
 */

import { getAuthHeaders } from './client.js';
import type { AcpTimelineEvent, AcpTimelineCategory } from '../types/acp-timeline';

const BASE_URL = import.meta.env.VITE_AEGIS_URL ?? '';

const JSON_HEADERS = { ...getAuthHeaders({ 'Content-Type': 'application/json' }) };

/** Raw event record from the replay endpoint. */
interface RawEventRecord {
  eventId: string;
  eventSeq: number;
  eventType: string;
  occurredAt: string;
  payload?: unknown;
  tenantId?: string;
  ownerKeyId?: string;
}

interface ReplayResponse {
  events: RawEventRecord[];
  count: number;
}

/** Map eventType to timeline category. */
function mapEventTypeToCategory(eventType: string): AcpTimelineCategory {
  if (eventType.startsWith('driver.')) return 'driver';
  if (eventType.startsWith('message.') || eventType.startsWith('prompt.')) return 'prompt';
  if (eventType.startsWith('tool.')) return 'tool';
  if (eventType.startsWith('action.')) return 'tool';
  if (eventType.startsWith('permission.')) return 'approval';
  if (eventType.startsWith('session.')) return 'session';
  if (eventType.startsWith('intervention.')) return 'intervention';
  if (eventType.startsWith('backend.') || eventType.startsWith('runtime.')) return 'system';
  if (eventType.startsWith('protocol.') || eventType.startsWith('error.')) return 'error';
  return 'system';
}

/** Build a human-readable description from event type and payload. */
function buildDescription(eventType: string, payload: unknown): string {
  const p = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  switch (eventType) {
    case 'driver.claimed': return `Driver claimed${p.subscriberId ? ` by ${String(p.subscriberId)}` : ''}`;
    case 'driver.released': return 'Driver released';
    case 'driver.transferred': return `Driver transferred${p.toSubscriberId ? ` to ${String(p.toSubscriberId)}` : ''}`;
    case 'driver.revoked': return 'Driver revoked';
    case 'message.sent': return 'Message sent';
    case 'message.received': return 'Assistant response received';
    case 'tool.invoked': return `Tool invoked: ${p.toolName ?? 'unknown'}`;
    case 'tool.result': return `Tool result: ${p.toolName ?? 'unknown'}`;
    case 'action.dispatched': return 'Action dispatched';
    case 'action.completed': return 'Action completed';
    case 'action.failed': return `Action failed${p.error ? `: ${String(p.error)}` : ''}`;
    case 'permission.requested': return `Approval requested${p.toolName ? ` for ${String(p.toolName)}` : ''}`;
    case 'permission.granted': return 'Approval granted';
    case 'permission.denied': return 'Approval denied';
    case 'session.created': return 'Session created';
    case 'session.started': return 'Session started';
    case 'session.ended': return 'Session ended';
    case 'session.paused': return `Session paused${p.reason ? `: ${String(p.reason)}` : ''}`;
    case 'session.resumed': return 'Session resumed';
    case 'intervention.started': return 'Intervention started';
    case 'intervention.completed': return 'Intervention completed';
    case 'backend.restart': return 'Backend restarted';
    case 'runtime.exit': return `Runtime exited${p.code !== undefined ? ` (code ${String(p.code)})` : ''}`;
    case 'protocol.error': return `Protocol error${p.message ? `: ${String(p.message)}` : ''}`;
    default: return eventType;
  }
}

/** Build structured details from event type and payload. */
function buildDetails(eventType: string, payload: unknown): AcpTimelineEvent['details'] {
  const p = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
  const details: NonNullable<AcpTimelineEvent['details']> = {};

  if (eventType.startsWith('driver.')) {
    details.driverAction = eventType.split('.')[1] as 'claimed' | 'released' | 'transferred' | 'revoked';
    if (p.fromSubscriberId) details.driverFrom = String(p.fromSubscriberId);
    if (p.toSubscriberId) details.driverTo = String(p.toSubscriberId);
    if (p.subscriberId) details.driverFrom = String(p.subscriberId);
  }

  if (eventType.startsWith('tool.')) {
    if (p.toolName) details.toolName = String(p.toolName);
    if (p.status) details.toolStatus = p.status as 'started' | 'completed' | 'failed' | 'cancelled';
    if (p.durationMs !== undefined) details.durationMs = Number(p.durationMs);
  }

  if (eventType.startsWith('permission.')) {
    if (p.approvalId) details.approvalId = String(p.approvalId);
    if (p.decision) details.approvalDecision = p.decision as 'approved' | 'rejected' | 'timed_out';
  }

  if (eventType.startsWith('session.')) {
    if (p.fromStatus) details.sessionFrom = String(p.fromStatus);
    if (p.toStatus) details.sessionTo = String(p.toStatus);
  }

  if (eventType.startsWith('protocol.') || eventType.startsWith('error.')) {
    if (p.code) details.errorCode = String(p.code);
    if (p.message) details.errorMessage = String(p.message);
  }

  if (p.tokenUsage && typeof p.tokenUsage === 'object') {
    const tu = p.tokenUsage as Record<string, unknown>;
    details.tokenUsage = {
      input: Number(tu.input ?? 0),
      output: Number(tu.output ?? 0),
      total: Number(tu.total ?? 0),
    };
  }

  return Object.keys(details).length > 0 ? details : undefined;
}

/** Map a raw event record to an AcpTimelineEvent. */
function mapRecordToTimelineEvent(record: RawEventRecord): AcpTimelineEvent {
  const category = mapEventTypeToCategory(record.eventType);
  const description = buildDescription(record.eventType, record.payload);
  const details = buildDetails(record.eventType, record.payload);
  const payload = typeof record.payload === 'object' && record.payload !== null
    ? record.payload as Record<string, unknown>
    : {};

  return {
    id: record.eventId,
    timestamp: record.occurredAt,
    category,
    description,
    actor: payload.actor as string | undefined ?? payload.subscriberId as string | undefined,
    tenant: record.tenantId,
    details,
  };
}

/** Replay events from the durable event store for a session. */
export async function replaySessionEvents(
  sessionId: string,
  options: { afterSeq?: number; limit?: number } = {},
  signal?: AbortSignal,
): Promise<AcpTimelineEvent[]> {
  const res = await fetch(`${BASE_URL}/v1/sessions/${encodeURIComponent(sessionId)}/events/replay`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      afterSeq: options.afterSeq ?? 0,
      limit: options.limit ?? 100,
    }),
    credentials: 'include',
    signal,
  });
  if (res.status === 501) {
    // Event store not configured — return empty timeline
    return [];
  }
  if (!res.ok) throw new Error(`Failed to replay events: ${res.status}`);
  const data = (await res.json()) as ReplayResponse;
  return (data.events ?? []).map(mapRecordToTimelineEvent);
}
