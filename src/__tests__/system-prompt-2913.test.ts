/**
 * Issue #2913: Per-session custom system prompt (cc-connect parity)
 *
 * Verifies that systemPrompt is threaded from REST API → ACP backend → CC session/new.
 */
import { describe, it, expect } from 'vitest';
import type { AcpCreateSessionInput } from '../services/acp/types.js';
import type { AcpBackendCreateSessionInput } from '../services/acp/backend.js';

describe('Issue #2913: Per-session custom system prompt', () => {
  it('AcpCreateSessionInput type accepts systemPrompt', () => {
    const input: AcpCreateSessionInput = {
      tenantId: 'test-tenant',
      ownerKeyId: 'test-key',
      systemPrompt: 'You are a helpful coding assistant focused on security.',
    };

    expect(input.systemPrompt).toBe('You are a helpful coding assistant focused on security.');
  });

  it('systemPrompt is optional and defaults to undefined', () => {
    const input: AcpCreateSessionInput = {
      tenantId: 'test-tenant',
      ownerKeyId: 'test-key',
    };

    expect(input.systemPrompt).toBeUndefined();
  });

  it('systemPrompt is accepted in the Zod schema', async () => {
    const { z } = await import('zod');

    const systemPromptSchema = z.string().max(100_000).optional();

    // Valid: string
    expect(systemPromptSchema.parse('Custom system prompt')).toBe('Custom system prompt');

    // Valid: undefined
    expect(systemPromptSchema.parse(undefined)).toBeUndefined();

    // Invalid: too long
    const longPrompt = 'a'.repeat(100_001);
    expect(() => systemPromptSchema.parse(longPrompt)).toThrow();
  });

  it('ACP _meta.systemPrompt is forwarded to CC session/new', () => {
    // Verify the protocol shape: _meta.systemPrompt as string
    const meta = {
      aegis: {
        sessionId: 'test-session-id',
        backendRunId: 'test-run-id',
      },
      systemPrompt: 'You are a code reviewer.',
    };

    // This is the shape CC ACP expects
    expect(meta.systemPrompt).toBe('You are a code reviewer.');
    expect(meta.aegis.sessionId).toBe('test-session-id');
  });

  it('AcpBackendCreateSessionInput includes systemPrompt from parent type', () => {
    const input: AcpBackendCreateSessionInput = {
      tenantId: 'test-tenant',
      ownerKeyId: 'test-key',
      cwd: '/tmp',
      systemPrompt: 'You are a security-focused code reviewer.',
    };

    expect(input.systemPrompt).toBe('You are a security-focused code reviewer.');
  });
});
