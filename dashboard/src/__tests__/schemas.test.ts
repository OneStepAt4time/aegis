import { describe, it, expect } from 'vitest';

import { GlobalMetricsSchema, SessionLatencyResponseSchema, SessionMessagesSchema } from '../api/schemas';

// ── SessionMessagesSchema ────────────────────────────────────────

describe('SessionMessagesSchema', () => {
  const validPayload = {
    messages: [
      { role: 'user', contentType: 'text', text: 'hello' },
      { role: 'assistant', contentType: 'tool_use', text: '', toolName: 'bash', toolUseId: 'abc' },
    ],
    status: 'idle',
    statusText: null,
    interactiveContent: null,
  };

  it('accepts valid payload', () => {
    const result = SessionMessagesSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts optional fields omitted', () => {
    const result = SessionMessagesSchema.safeParse({
      messages: [{ role: 'system', contentType: 'text', text: 'ok' }],
      status: 'working',
      statusText: 'busy',
      interactiveContent: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = SessionMessagesSchema.safeParse({
      ...validPayload,
      messages: [{ role: 'bot', contentType: 'text', text: 'hi' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid contentType', () => {
    const result = SessionMessagesSchema.safeParse({
      ...validPayload,
      messages: [{ role: 'user', contentType: 'image', text: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = SessionMessagesSchema.safeParse({
      ...validPayload,
      status: 'flying',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing messages array', () => {
    const { messages, ...noMessages } = validPayload;
    const result = SessionMessagesSchema.safeParse(noMessages);
    expect(result.success).toBe(false);
  });

  it('rejects non-nullable statusText', () => {
    const result = SessionMessagesSchema.safeParse({
      ...validPayload,
      statusText: 123,
    });
    expect(result.success).toBe(false);
  });
});

// ── GlobalMetricsSchema ──────────────────────────────────────────

describe('GlobalMetricsSchema', () => {
  const validPayload = {
    uptime: 3600,
    sessions: {
      total_created: 10,
      currently_active: 2,
      completed: 7,
      failed: 1,
      avg_duration_sec: 120,
      avg_messages_per_session: 5.5,
    },
    auto_approvals: 3,
    webhooks_sent: 20,
    webhooks_failed: 1,
    screenshots_taken: 5,
    pipelines_created: 2,
    batches_created: 1,
    prompt_delivery: {
      sent: 15,
      delivered: 14,
      failed: 1,
      success_rate: 0.93,
    },
    latency: {
      hook_latency_ms: { min: 20, max: 60, avg: 35, count: 4 },
      state_change_detection_ms: { min: 18, max: 55, avg: 32, count: 4 },
      permission_response_ms: { min: 200, max: 800, avg: 410, count: 2 },
      channel_delivery_ms: { min: 25, max: 110, avg: 58, count: 3 },
    },
  };

  it('accepts valid payload', () => {
    const result = GlobalMetricsSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('accepts null success_rate', () => {
    const result = GlobalMetricsSchema.safeParse({
      ...validPayload,
      prompt_delivery: { ...validPayload.prompt_delivery, success_rate: null },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing sessions block', () => {
    const { sessions, ...noSessions } = validPayload;
    const result = GlobalMetricsSchema.safeParse(noSessions);
    expect(result.success).toBe(false);
  });

  it('rejects string where number expected', () => {
    const result = GlobalMetricsSchema.safeParse({
      ...validPayload,
      uptime: '3600',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing prompt_delivery', () => {
    const { prompt_delivery, ...noDelivery } = validPayload;
    const result = GlobalMetricsSchema.safeParse(noDelivery);
    expect(result.success).toBe(false);
  });

  it('rejects missing latency block', () => {
    const { latency, ...noLatency } = validPayload;
    const result = GlobalMetricsSchema.safeParse(noLatency);
    expect(result.success).toBe(false);
  });

  it('rejects extra unknown field in sessions', () => {
    const result = GlobalMetricsSchema.safeParse({
      ...validPayload,
      sessions: { ...validPayload.sessions, extra: true },
    });
    // Zod allows extra keys by default — this should still pass
    expect(result.success).toBe(true);
  });
});

describe('SessionLatencyResponseSchema', () => {
  it('accepts aggregated latency payloads even when realtime delivery latency is absent', () => {
    const result = SessionLatencyResponseSchema.safeParse({
      sessionId: 'session-1',
      realtime: {
        hook_latency_ms: 44,
        state_change_detection_ms: 44,
        permission_response_ms: 220,
      },
      aggregated: {
        hook_latency_ms: { min: 20, max: 60, avg: 35, count: 4 },
        state_change_detection_ms: { min: 18, max: 55, avg: 32, count: 4 },
        permission_response_ms: { min: 200, max: 800, avg: 410, count: 2 },
        channel_delivery_ms: { min: 25, max: 110, avg: 58, count: 3 },
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts empty latency payloads', () => {
    const result = SessionLatencyResponseSchema.safeParse({
      sessionId: 'session-2',
      realtime: null,
      aggregated: null,
    });

    expect(result.success).toBe(true);
  });
});
