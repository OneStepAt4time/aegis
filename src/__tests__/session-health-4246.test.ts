import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionInfo } from '../session-types.js';

vi.mock('../transcript.js', () => ({
  readNewEntries: vi.fn(),
}));
import { readNewEntries } from '../transcript.js';
const mockReadNewEntries = vi.mocked(readNewEntries);

import { computeLatencyMetrics, buildSessionHealth, checkWaitingForInput } from '../services/session/session-health.js';

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'sess-1',
    status: 'idle',
    workDir: '/tmp/wd',
    byteOffset: 0,
    monitorOffset: 0,
    createdAt: Date.now() - 10000,
    lastActivity: Date.now() - 1000,
    stallThresholdMs: 120000,
    permissionStallMs: 300000,
    permissionMode: 'default',
    settingsPatched: false,
    ownerKeyId: 'k',
    tenantId: '_system',
    runnerName: 'claude',
    isolationMode: 'worktree',
    isolationPolicy: 'respect-cc',
    ...overrides,
  } as SessionInfo;
}

describe('computeLatencyMetrics', () => {
  it('returns null for falsy session', () => {
    // @ts-expect-error - pass null to ensure graceful handling
    expect(computeLatencyMetrics(null)).toBeNull();
  });

  it('computes metrics when all timestamps present', () => {
    const now = Date.now();
    const session = makeSession({ lastHookReceivedAt: now, lastHookEventAt: now - 50, permissionPromptAt: now - 200, permissionRespondedAt: now - 100 });
    const m = computeLatencyMetrics(session);
    expect(m).not.toBeNull();
    expect(m!.hook_latency_ms).toBe(50);
    expect(m!.state_change_detection_ms).toBe(50);
    expect(m!.permission_response_ms).toBe(100);
  });

  it('returns null for negative hook latency (clock skew)', () => {
    const now = Date.now();
    const session = makeSession({ lastHookReceivedAt: now - 100, lastHookEventAt: now });
    const m = computeLatencyMetrics(session);
    expect(m).not.toBeNull();
    expect(m!.hook_latency_ms).toBeNull();
    expect(m!.state_change_detection_ms).toBeNull();
  });

  it('handles partial fields gracefully', () => {
    const now = Date.now();
    const session = makeSession({ lastHookReceivedAt: now, lastHookEventAt: now - 30 });
    const m = computeLatencyMetrics(session);
    expect(m).not.toBeNull();
    expect(m!.hook_latency_ms).toBe(30);
    expect(m!.permission_response_ms).toBeNull();
  });
});

describe('buildSessionHealth', () => {
  it('reports working as claudeRunning', () => {
    const s = makeSession({ status: 'working', jsonlPath: '/tmp/j' });
    const h = buildSessionHealth(s);
    expect(h.alive).toBe(true);
    expect(h.claudeRunning).toBe(true);
    expect(h.hasTranscript).toBe(true);
    expect(h.actionHints).toBeUndefined();
  });

  it('includes actionHints for permission_prompt', () => {
    const s = makeSession({ status: 'permission_prompt', id: 'abc123' });
    const h = buildSessionHealth(s);
    expect(h.actionHints).toBeDefined();
    expect(h.actionHints!.approve.url).toContain('/v1/sessions/abc123/approve');
  });

  it('idle -> not running', () => {
    const s = makeSession({ status: 'idle' });
    const h = buildSessionHealth(s);
    expect(h.claudeRunning).toBe(false);
  });
});

describe('checkWaitingForInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false when no jsonlPath', async () => {
    const s = makeSession();
    // remove jsonlPath
    // @ts-expect-error - remove required field for test
    delete s.jsonlPath;
    const r = await checkWaitingForInput(s);
    expect(r).toBe(false);
  });

  it('returns true for text-only assistant message', async () => {
    const s = makeSession({ jsonlPath: '/tmp/j' });
    mockReadNewEntries.mockResolvedValue({ raw: [{ type: 'assistant', message: { role: 'assistant', content: 'hello' } }], entries: [], newOffset: 0 });
    const r = await checkWaitingForInput(s);
    expect(r).toBe(true);
  });

  it('returns false for tool_use content', async () => {
    const s = makeSession({ jsonlPath: '/tmp/j' });
    mockReadNewEntries.mockResolvedValue({ raw: [{ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use' }] } }], entries: [], newOffset: 0 });
    const r = await checkWaitingForInput(s);
    expect(r).toBe(false);
  });

  it('returns false for empty transcript', async () => {
    const s = makeSession({ jsonlPath: '/tmp/j' });
    mockReadNewEntries.mockResolvedValue({ raw: [], entries: [], newOffset: 0 });
    const r = await checkWaitingForInput(s);
    expect(r).toBe(false);
  });

  it('returns false when readNewEntries throws', async () => {
    const s = makeSession({ jsonlPath: '/tmp/j' });
    mockReadNewEntries.mockRejectedValue(new Error('enoent'));
    const r = await checkWaitingForInput(s);
    expect(r).toBe(false);
  });
});
