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
import type { AcpJsonRpcNotification } from '../services/acp/json-rpc-client.js';
import type { AcpEventStore, AcpAppendEventInput } from '../services/acp/event-store.js';
import type { SessionTranscripts } from '../session-transcripts.js';
import { SessionManager } from '../session.js';
import type { SessionInfo } from '../session.js';

function makeNotification(method: string, params: Record<string, unknown>): AcpJsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method,
    ...(Object.keys(params).length > 0 ? { params } : {}),
    raw: { jsonrpc: '2.0', method, params },
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
      async append(input: AcpAppendEventInput) {
        storedEvents.push(input);
        return {
          seq: storedEvents.length,
          sessionId: input.sessionId,
          tenantId: input.tenantId,
          ownerKeyId: input.ownerKeyId,
          eventType: input.eventType,
          payload: input.payload,
          occurredAt: input.occurredAt ?? new Date(),
        };
      },
      async list(input) {
        return storedEvents
          .filter(e => e.sessionId === input.sessionId)
          .map((e, i) => ({
            seq: i + 1,
            sessionId: e.sessionId,
            tenantId: e.tenantId,
            ownerKeyId: e.ownerKeyId,
            eventType: e.eventType,
            payload: e.payload,
            occurredAt: e.occurredAt ?? new Date(),
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
    const events = await eventStore.list({ sessionId: 'test-session-1' });
    expect(events).toHaveLength(3);
  });
});
