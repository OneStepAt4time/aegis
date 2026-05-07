import { describe, expect, it } from 'vitest';

import {
  mapAcpJsonRpcErrorResponseToEvent,
  mapAcpJsonRpcNotificationToEvent,
  mapAcpJsonRpcRequestToEvent,
  mapAcpJsonRpcSuccessResponseToEvent,
} from '../services/acp/event-mapper.js';
import type { AcpEventMapperContext } from '../services/acp/event-mapper.js';
import type {
  AcpJsonObject,
  AcpJsonRpcInboundRequest,
  AcpJsonRpcNotification,
} from '../services/acp/json-rpc-client.js';

const occurredAt = new Date('2026-01-02T03:04:05.000Z');
const context: AcpEventMapperContext = {
  sessionId: 'aegis-session-1',
  tenantId: 'tenant-1',
  ownerKeyId: 'owner-1',
  backendRunId: 'backend-run-1',
  occurredAt,
};

function notification(update: AcpJsonObject): AcpJsonRpcNotification {
  return {
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 'fixture-acp-session', update },
    raw: {
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId: 'fixture-acp-session', update },
    },
  };
}

describe('ACP event mapper', () => {
  it('maps text, thinking, tool, approval, usage, and turn completion into store-ready Aegis events', () => {
    const mapped = [
      mapAcpJsonRpcNotificationToEvent(
        notification({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello from ACP.' },
          messageId: 'message-1',
        }),
        context
      ),
      mapAcpJsonRpcNotificationToEvent(
        notification({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Need a plan.' },
          messageId: 'thought-1',
        }),
        context
      ),
      mapAcpJsonRpcNotificationToEvent(
        notification({
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-read-1',
          title: 'Read package metadata',
          kind: 'read',
          status: 'pending',
          rawInput: { path: 'package.json' },
        }),
        context
      ),
      mapAcpJsonRpcNotificationToEvent(
        notification({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-read-1',
          status: 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: 'package name: @onestepat4time/aegis' },
            },
          ],
          rawOutput: { ok: true },
        }),
        context
      ),
      mapAcpJsonRpcNotificationToEvent(
        notification({
          sessionUpdate: 'usage_update',
          usage: {
            input_tokens: 1200,
            outputTokens: 340,
            cache_creation_input_tokens: 128,
            cacheReadInputTokens: 512,
          },
          cost: { totalCostUsd: 0.012345, currency: 'USD' },
          model: 'claude-sonnet-4-6',
          provider: 'anthropic',
        }),
        context
      ),
      mapAcpJsonRpcRequestToEvent(
        {
          jsonrpc: '2.0',
          id: 1001,
          method: 'session/request_permission',
          params: {
            sessionId: 'fixture-acp-session',
            toolCall: {
              toolCallId: 'tool-edit-1',
              title: 'Edit package metadata',
              kind: 'edit',
              status: 'pending',
            },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          },
          raw: {
            jsonrpc: '2.0',
            id: 1001,
            method: 'session/request_permission',
            params: {
              sessionId: 'fixture-acp-session',
              toolCall: {
                toolCallId: 'tool-edit-1',
                title: 'Edit package metadata',
                kind: 'edit',
                status: 'pending',
              },
              options: [
                { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
                { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
              ],
            },
          },
        } satisfies AcpJsonRpcInboundRequest,
        context
      ),
      mapAcpJsonRpcSuccessResponseToEvent(
        {
          jsonrpc: '2.0',
          id: 'prompt-1',
          result: { stopReason: 'end_turn' },
          raw: { jsonrpc: '2.0', id: 'prompt-1', result: { stopReason: 'end_turn' } },
          request: { method: 'session/prompt' },
        },
        context
      ),
    ];

    expect(mapped).toEqual([
      {
        sessionId: 'aegis-session-1',
        tenantId: 'tenant-1',
        ownerKeyId: 'owner-1',
        backendRunId: 'backend-run-1',
        eventType: 'message.delta',
        occurredAt,
        payload: {
          schemaVersion: 1,
          text: 'Hello from ACP.',
          messageId: 'message-1',
          acp: expect.objectContaining({
            method: 'session/update',
            sessionId: 'fixture-acp-session',
            updateType: 'agent_message_chunk',
          }),
        },
      },
      expect.objectContaining({
        eventType: 'thinking.delta',
        payload: expect.objectContaining({ text: 'Need a plan.', messageId: 'thought-1' }),
      }),
      expect.objectContaining({
        eventType: 'tool.started',
        payload: expect.objectContaining({
          toolCallId: 'tool-read-1',
          title: 'Read package metadata',
          kind: 'read',
          status: 'pending',
        }),
      }),
      expect.objectContaining({
        eventType: 'tool.completed',
        payload: expect.objectContaining({
          toolCallId: 'tool-read-1',
          status: 'completed',
          text: 'package name: @onestepat4time/aegis',
        }),
      }),
      expect.objectContaining({
        eventType: 'usage.updated',
        payload: expect.objectContaining({
          usage: {
            inputTokens: 1200,
            outputTokens: 340,
            cacheCreationTokens: 128,
            cacheReadTokens: 512,
          },
          cost: { amountUsd: 0.012345, currency: 'USD' },
          model: 'claude-sonnet-4-6',
          provider: 'anthropic',
        }),
      }),
      expect.objectContaining({
        eventType: 'approval.requested',
        payload: expect.objectContaining({
          requestId: 1001,
          toolCall: expect.objectContaining({
            toolCallId: 'tool-edit-1',
            title: 'Edit package metadata',
          }),
          options: [
            { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
          ],
        }),
      }),
      expect.objectContaining({
        eventType: 'turn.completed',
        payload: expect.objectContaining({
          stopReason: 'end_turn',
          acp: expect.objectContaining({ requestMethod: 'session/prompt' }),
        }),
      }),
    ]);
  });

  it('stores unsupported and malformed ACP frames instead of silently dropping raw metadata', () => {
    const unsupported = mapAcpJsonRpcNotificationToEvent(
      notification({ sessionUpdate: 'mystery_update', note: 'kept for ACP-048' }),
      context
    );
    const malformed = mapAcpJsonRpcNotificationToEvent(
      {
        jsonrpc: '2.0',
        method: 'session/update',
        params: { sessionId: 'fixture-acp-session', update: { sessionUpdate: 'tool_call' } },
        raw: {
          jsonrpc: '2.0',
          method: 'session/update',
          params: { sessionId: 'fixture-acp-session', update: { sessionUpdate: 'tool_call' } },
        },
      },
      context
    );

    expect(unsupported).toMatchObject({
      eventType: 'acp.unsupported',
      payload: {
        schemaVersion: 1,
        reason: 'unsupported_session_update',
        acp: expect.objectContaining({
          method: 'session/update',
          updateType: 'mystery_update',
          raw: expect.objectContaining({
            params: expect.objectContaining({
              update: { sessionUpdate: 'mystery_update', note: 'kept for ACP-048' },
            }),
          }),
        }),
      },
    });
    expect(malformed).toMatchObject({
      eventType: 'acp.malformed',
      payload: expect.objectContaining({
        reason: 'malformed_tool_call',
        acp: expect.objectContaining({ updateType: 'tool_call' }),
      }),
    });
  });

  it('maps session lifecycle updates and JSON-RPC error responses without storing secret values', () => {
    const lifecycle = mapAcpJsonRpcNotificationToEvent(
      notification({
        sessionUpdate: 'session_info_update',
        cwd: 'D:\\aegis\\redacted-session',
        model: 'claude-sonnet-4-6',
      }),
      context
    );
    const error = mapAcpJsonRpcErrorResponseToEvent(
      {
        jsonrpc: '2.0',
        id: 'new-session-1',
        error: {
          code: -32000,
          message: 'provider rejected token',
          data: { ANTHROPIC_API_KEY: 'secret-value', retryable: false },
        },
        raw: {
          jsonrpc: '2.0',
          id: 'new-session-1',
          error: {
            code: -32000,
            message: 'provider rejected token',
            data: { ANTHROPIC_API_KEY: 'secret-value', retryable: false },
          },
        },
        request: { method: 'session/new' },
      },
      context
    );

    expect(lifecycle).toMatchObject({
      eventType: 'session.updated',
      payload: expect.objectContaining({
        updateType: 'session_info_update',
        data: expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      }),
    });
    expect(error).toMatchObject({
      eventType: 'session.error',
      payload: expect.objectContaining({
        code: -32000,
        message: 'provider rejected token',
        data: { ANTHROPIC_API_KEY: '[REDACTED]', retryable: false },
        acp: expect.objectContaining({
          requestMethod: 'session/new',
          raw: expect.objectContaining({
            error: expect.objectContaining({
              data: { ANTHROPIC_API_KEY: '[REDACTED]', retryable: false },
            }),
          }),
        }),
      }),
    });
  });
});
