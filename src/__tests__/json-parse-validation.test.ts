import { describe, it, expect } from 'vitest';
import {
  persistedStateSchema,
  sessionMapSchema,
  stopSignalsSchema,
} from '../validation.js';

// ── persistedStateSchema ────────────────────────────────────────

describe('persistedStateSchema', () => {
  const validSession = {
    id: 'abc-123',
    windowId: '@0',
    windowName: 'session-1',
    workDir: '/home/user/project',
    byteOffset: 0,
    monitorOffset: 0,
    status: 'idle',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    stallThresholdMs: 300_000,
    permissionMode: 'default',
  };

  it('accepts valid sessions record', () => {
    const result = persistedStateSchema.safeParse({ 'abc-123': validSession });
    expect(result.success).toBe(true);
  });

  it('accepts session with all optional fields', () => {
    const full = {
      ...validSession,
      claudeSessionId: '00000000-0000-0000-0000-000000000001',
      jsonlPath: '/tmp/test.jsonl',
      permissionStallMs: 300_000,
      settingsPatched: true,
      hookSettingsFile: '/tmp/hook.json',
      lastHookAt: Date.now(),
      activeSubagents: ['sub1'],
      permissionPromptAt: Date.now(),
      permissionRespondedAt: Date.now(),
      lastHookReceivedAt: Date.now(),
      lastHookEventAt: Date.now(),
      model: 'claude-sonnet-4-6',
      lastDeadAt: Date.now(),
      ccPid: 12345,
    };
    const result = persistedStateSchema.safeParse({ 'abc-123': full });
    expect(result.success).toBe(true);
  });

  it('accepts empty record', () => {
    const result = persistedStateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects session missing required id', () => {
    const { id: _unused, ...noId } = validSession;
    const result = persistedStateSchema.safeParse({ 'abc-123': noId });
    expect(result.success).toBe(false);
  });

  it('rejects session missing required windowId', () => {
    const { windowId: _unused, ...noWindow } = validSession;
    const result = persistedStateSchema.safeParse({ 'abc-123': noWindow });
    expect(result.success).toBe(false);
  });

  it('rejects session with wrong type for byteOffset', () => {
    const result = persistedStateSchema.safeParse({
      'abc-123': { ...validSession, byteOffset: 'not-a-number' },
    });
    expect(result.success).toBe(false);
  });

  // Issue #2634: circuit breaker + premature termination fields
  it('accepts session with circuit breaker fields (Issue #2518)', () => {
    const result = persistedStateSchema.safeParse({
      'abc-123': {
        ...validSession,
        hookFailureTimestamps: [Date.now() - 1000, Date.now()],
        circuitBreakerTripped: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts session with premature termination fields (Issue #2520)', () => {
    const result = persistedStateSchema.safeParse({
      'abc-123': {
        ...validSession,
        toolUseCount: 25,
        prematureTermination: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('preserves circuit breaker and premature termination fields through parse', () => {
    const input = {
      'abc-123': {
        ...validSession,
        hookFailureTimestamps: [1000, 2000],
        circuitBreakerTripped: true,
        toolUseCount: 10,
        prematureTermination: false,
      },
    };
    const result = persistedStateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const s = result.data['abc-123'];
      expect(s.hookFailureTimestamps).toEqual([1000, 2000]);
      expect(s.circuitBreakerTripped).toBe(true);
      expect(s.toolUseCount).toBe(10);
      expect(s.prematureTermination).toBe(false);
    }
  });

  it('rejects toolUseCount with negative value', () => {
    const result = persistedStateSchema.safeParse({
      'abc-123': { ...validSession, toolUseCount: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects toolUseCount with non-integer value', () => {
    const result = persistedStateSchema.safeParse({
      'abc-123': { ...validSession, toolUseCount: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

// ── sessionMapSchema ─────────────────────────────────────────────

describe('sessionMapSchema', () => {
  const validEntry = {
    session_id: '00000000-0000-0000-0000-000000000001',
    cwd: '/home/user/project',
    window_name: 'session-1',
    written_at: Date.now(),
  };

  it('accepts valid session map', () => {
    const result = sessionMapSchema.safeParse({ 'aegis:@1': validEntry });
    expect(result.success).toBe(true);
  });

  it('accepts entry with optional nullable fields as null', () => {
    const full = {
      ...validEntry,
      transcript_path: null,
      permission_mode: null,
      agent_id: null,
      source: null,
      agent_type: null,
      model: null,
    };
    const result = sessionMapSchema.safeParse({ 'aegis:@1': full });
    expect(result.success).toBe(true);
  });

  it('accepts entry with optional fields populated', () => {
    const full = {
      ...validEntry,
      transcript_path: '/tmp/transcript.jsonl',
      permission_mode: 'default',
      agent_id: 'agent-1',
      source: 'startup',
      agent_type: 'claude',
      model: 'claude-sonnet-4-6',
    };
    const result = sessionMapSchema.safeParse({ 'aegis:@1': full });
    expect(result.success).toBe(true);
  });

  it('accepts resilient pointer metadata fields', () => {
    const full = {
      ...validEntry,
      schema_version: 1,
      expires_at: Date.now() + 60_000,
    };
    const result = sessionMapSchema.safeParse({ 'aegis:@1': full });
    expect(result.success).toBe(true);
  });

  it('accepts empty record', () => {
    const result = sessionMapSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects entry missing session_id', () => {
    const { session_id: _unused, ...noId } = validEntry;
    const result = sessionMapSchema.safeParse({ 'aegis:@1': noId });
    expect(result.success).toBe(false);
  });

  it('rejects entry missing written_at', () => {
    const { written_at: _unused, ...noTs } = validEntry;
    const result = sessionMapSchema.safeParse({ 'aegis:@1': noTs });
    expect(result.success).toBe(false);
  });

  it('rejects entry with wrong type for written_at', () => {
    const result = sessionMapSchema.safeParse({
      'aegis:@1': { ...validEntry, written_at: 'not-a-number' },
    });
    expect(result.success).toBe(false);
  });
});

// ── stopSignalsSchema ────────────────────────────────────────────

describe('stopSignalsSchema', () => {
  const validSignal = {
    event: 'StopFailure',
    timestamp: Date.now(),
    stop_reason: 'rate_limit',
  };

  it('accepts valid stop signals', () => {
    const result = stopSignalsSchema.safeParse({
      '00000000-0000-0000-0000-000000000001': validSignal,
    });
    expect(result.success).toBe(true);
  });

  it('accepts signal with all optional fields', () => {
    const full = {
      ...validSignal,
      error: 'Rate limit exceeded',
      error_details: { retry_after: 60 },
      last_assistant_message: 'Working on it...',
      agent_id: 'agent-1',
    };
    const result = stopSignalsSchema.safeParse({
      '00000000-0000-0000-0000-000000000001': full,
    });
    expect(result.success).toBe(true);
  });

  it('accepts signal with only event', () => {
    const result = stopSignalsSchema.safeParse({
      'sid': { event: 'Stop' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty record', () => {
    const result = stopSignalsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects entry with wrong type for event', () => {
    const result = stopSignalsSchema.safeParse({
      'sid': { ...validSignal, event: 123 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects entry with wrong type for timestamp', () => {
    const result = stopSignalsSchema.safeParse({
      'sid': { ...validSignal, timestamp: 'not-a-number' },
    });
    expect(result.success).toBe(false);
  });
});
