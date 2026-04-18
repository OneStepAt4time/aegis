import { describe, it, expect } from 'vitest';

import { SessionInfoSchema, SessionMessagesSchema, GlobalMetricsSchema } from '../api/schemas';

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

describe('SessionInfoSchema', () => {
  const validPayload = {
    id: 'sess-1',
    windowId: '@1',
    windowName: 'Mobile dashboard pass',
    workDir: 'D:\\src\\aegis\\dashboard',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'permission_prompt',
    createdAt: 1,
    lastActivity: 2,
    stallThresholdMs: 300000,
    permissionMode: 'default',
    permissionPromptAt: 3,
    pendingPermission: {
      toolName: 'Bash',
      prompt: 'npm run deploy',
      startedAt: 3,
      timeoutMs: 10000,
      expiresAt: 10003,
      remainingMs: 9000,
    },
    pendingQuestion: {
      toolUseId: 'tool-1',
      content: 'What label should we use?',
      options: ['Ship it', 'Revise copy'],
      since: 4,
    },
  };

  it('accepts pending interaction metadata', () => {
    const result = SessionInfoSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it('rejects malformed pending permission metadata', () => {
    const result = SessionInfoSchema.safeParse({
      ...validPayload,
      pendingPermission: {
        ...validPayload.pendingPermission,
        expiresAt: 'soon',
      },
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
      hook_latency_ms: { min: 1, max: 7, avg: 3, count: 5 },
      state_change_detection_ms: { min: 2, max: 9, avg: 4, count: 5 },
      permission_response_ms: { min: 10, max: 40, avg: 22, count: 3 },
      channel_delivery_ms: { min: 3, max: 18, avg: 8, count: 5 },
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
