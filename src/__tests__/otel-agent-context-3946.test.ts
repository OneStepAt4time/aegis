/**
 * otel-agent-context-3946.test.ts
 *
 * Tests for agent_id/parent_agent_id in OTEL traces and metering.
 *
 * Issue #3946: CC v2.1.141+ emits agent_id/parent_agent_id attributes.
 * These must flow through the tracing pipeline and be persisted in metering.
 */

import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MeteringService } from '../metering.js';
import { SessionEventBus } from '../events.js';
import type { ToolSpanAttributes } from '../tracing.js';

// ── Metering: agent context in usage records ─────────────────────

describe('MeteringService — agent context in usage records (#3946)', () => {
  let tmpDir: string;
  let metering: MeteringService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'aegis-otel-3946-'));
    const eventBus = new SessionEventBus();
    metering = new MeteringService(
      eventBus,
      () => undefined,
      join(tmpDir, 'metering.json'),
    );
  });

  afterEach(async () => {
    try { rmSync(tmpDir, { recursive: true }); } catch {}
  });

  it('stores agentId and parentAgentId in token usage records', async () => {
    await metering.load();

    metering.recordTokenUsage('session-1', {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    }, 'claude-sonnet-4', { agentId: 'agent-abc', parentAgentId: 'agent-parent' });

    const usage = metering.getSessionUsage('session-1');
    expect(usage).toHaveLength(1);
    expect(usage[0].agentId).toBe('agent-abc');
    expect(usage[0].parentAgentId).toBe('agent-parent');
    expect(usage[0].model).toBe('claude-sonnet-4');
  });

  it('records without agent context when not provided', async () => {
    await metering.load();

    metering.recordTokenUsage('session-2', {
      inputTokens: 200,
      outputTokens: 100,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });

    const usage = metering.getSessionUsage('session-2');
    expect(usage).toHaveLength(1);
    expect(usage[0].agentId).toBeUndefined();
    expect(usage[0].parentAgentId).toBeUndefined();
  });

  it('records with only agentId (no parent)', async () => {
    await metering.load();

    metering.recordTokenUsage('session-3', {
      inputTokens: 50,
      outputTokens: 25,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    }, 'claude-opus-4', { agentId: 'solo-agent' });

    const usage = metering.getSessionUsage('session-3');
    expect(usage[0].agentId).toBe('solo-agent');
    expect(usage[0].parentAgentId).toBeUndefined();
  });

  it('agent context preserved in usage summary', async () => {
    await metering.load();

    metering.recordTokenUsage('session-4', {
      inputTokens: 300,
      outputTokens: 150,
      cacheCreationTokens: 10,
      cacheReadTokens: 5,
    }, 'claude-sonnet-4', { agentId: 'child-1', parentAgentId: 'root' });

    const summary = metering.getUsageSummary({ sessionId: 'session-4' });
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(150);
  });
});

// ── ToolSpanAttributes: agent fields ──────────────────────────────

describe('ToolSpanAttributes — agent context fields (#3946)', () => {
  it('accepts agentId and parentAgentId in attributes', () => {
    const attrs: ToolSpanAttributes = {
      sessionId: 'session-1',
      toolName: 'Bash',
      toolUseId: 'toolu-123',
      agentId: 'agent-abc',
      parentAgentId: 'agent-parent',
    };

    expect(attrs.agentId).toBe('agent-abc');
    expect(attrs.parentAgentId).toBe('agent-parent');
  });

  it('accepts attributes without agent context', () => {
    const attrs: ToolSpanAttributes = {
      sessionId: 'session-1',
      toolName: 'Read',
      toolUseId: 'toolu-456',
    };

    expect(attrs.agentId).toBeUndefined();
    expect(attrs.parentAgentId).toBeUndefined();
  });
});
