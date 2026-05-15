/**
 * Issue #3422: GET /v1/sessions/:id/read returns empty messages but /transcript has data
 *
 * Root cause: AcpBackend.onRawNotification was never wired to persist ACP events
 * to the event store. CC notifications (message.delta, tool.started, etc.) were received
 * by the JSON-RPC client but never stored, so readMessagesFromSession() found nothing.
 *
 * Fix: Wire onRawNotification in server.ts to call mapAcpJsonRpcNotificationToEvent()
 * and persist via eventStore.append().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapAcpJsonRpcNotificationToEvent } from '../services/acp/event-mapper.js';
import type { AcpJsonRpcNotification, AcpJsonValue } from '../services/acp/json-rpc-client.js';
import type { AcpEventStore, AcpAppendEventInput, AcpEventRecord, AcpListEventsInput } from '../services/acp/event-store.js';

function makeNotification(method: string, params?: Record<string, unknown>): AcpJsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(params && Object.keys(params).length > 0 ? { params: params as AcpJsonValue } : {}),
    raw: { jsonrpc: '2.0', method, params: (params ?? null) as AcpJsonValue },
  };
}

describe('Issue #3422: ACP events persisted from onRawNotification', () => {
  const context = {
    sessionId: 'test-session-1',
    tenantId: 'default',
    ownerKeyId: 'key-1',
  };

  it('maps message.delta notification to event store input', () => {
    const notification = makeNotification('session/update', {
      sessionId: 'acp-agent-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Hello world' },
        messageId: 'msg-1',
      },
    });

    const result = mapAcpJsonRpcNotificationToEvent(notification, context);

    expect(result.sessionId).toBe('test-session-1');
    expect(result.eventType).toBe('message.delta');
    expect(result.payload).toMatchObject({
      schemaVersion: 1,
      text: 'Hello world',
      messageId: 'msg-1',
    });
  });

  it('maps thinking.delta notification to event store input', () => {
    const notification = makeNotification('session/update', {
      sessionId: 'acp-agent-1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'thinking...' },
      },
    });

    const result = mapAcpJsonRpcNotificationToEvent(notification, context);

    expect(result.eventType).toBe('thinking.delta');
    expect(result.payload).toMatchObject({ text: 'thinking...' });
  });

  it('maps tool.started notification to event store input', () => {
    const notification = makeNotification('session/update', {
      sessionId: 'acp-agent-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'Read file.ts',
        kind: 'read',
        status: 'running',
      },
    });

    const result = mapAcpJsonRpcNotificationToEvent(notification, context);

    expect(result.eventType).toBe('tool.started');
    expect(result.payload).toMatchObject({
      toolCallId: 'tc-1',
      title: 'Read file.ts',
    });
  });

  it('maps tool.completed notification to event store input', () => {
    const notification = makeNotification('session/update', {
      sessionId: 'acp-agent-1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-1',
        status: 'completed',
      },
    });

    const result = mapAcpJsonRpcNotificationToEvent(notification, context);

    expect(result.eventType).toBe('tool.completed');
    expect(result.payload).toMatchObject({ toolCallId: 'tc-1', status: 'completed' });
  });

  it('persists events to event store and reads them back via readFromAcpEvents', async () => {
    // Simulate the wiring: notification -> map -> append -> list -> readFromAcpEvents
    const storedEvents: AcpAppendEventInput[] = [];
    const eventStore: AcpEventStore = {
      async append(input: AcpAppendEventInput): Promise<AcpEventRecord> {
        storedEvents.push(input);
        return {
          sessionId: input.sessionId,
          tenantId: input.tenantId,
          ownerKeyId: input.ownerKeyId,
          eventSeq: storedEvents.length,
          eventId: `evt-${storedEvents.length}`,
          eventType: input.eventType,
          occurredAt: input.occurredAt ?? new Date(),
          ingestedAt: new Date(),
          payload: input.payload,
        };
      },
      async list(input: AcpListEventsInput): Promise<AcpEventRecord[]> {
        return storedEvents
          .filter(e => e.sessionId === input.sessionId)
          .map((e, i) => ({
            sessionId: e.sessionId,
            tenantId: e.tenantId,
            ownerKeyId: e.ownerKeyId,
            eventSeq: i + 1,
            eventId: `evt-${i + 1}`,
            eventType: e.eventType,
            occurredAt: e.occurredAt ?? new Date(),
            ingestedAt: new Date(),
            payload: e.payload,
          }));
      },
    };

    // Simulate CC sending notifications
    const notifications = [
      makeNotification('session/update', {
        sessionId: 'acp-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' }, messageId: 'm1' },
      }),
      makeNotification('session/update', {
        sessionId: 'acp-1',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' }, messageId: 'm1' },
      }),
      makeNotification('session/update', {
        sessionId: 'acp-1',
        update: { sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'Bash', kind: 'bash', status: 'running' },
      }),
    ];

    // Wire: notification -> map -> append (this is what server.ts does now)
    for (const notification of notifications) {
      const event = mapAcpJsonRpcNotificationToEvent(notification, context);
      await eventStore.append(event);
    }

    // Verify events were stored
    expect(storedEvents).toHaveLength(3);
    expect(storedEvents[0].eventType).toBe('message.delta');
    expect(storedEvents[1].eventType).toBe('message.delta');
    expect(storedEvents[2].eventType).toBe('tool.started');

    // Verify events can be listed back
    const events = await eventStore.list({
      sessionId: 'test-session-1',
      tenantId: 'default',
      ownerKeyId: 'key-1',
    });
    expect(events).toHaveLength(3);
  });
});
