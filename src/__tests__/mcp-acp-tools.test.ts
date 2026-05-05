/**
 * mcp-acp-tools.test.ts — Tests for ACP-native MCP tools (ACP-065).
 *
 * Tests validation schemas for the new acp_* tools:
 * - acp_send_prompt
 * - acp_respond_approval
 * - acp_pause_session
 * - acp_resume_session
 * - acp_cancel_session
 * - acp_claim_driver
 * - acp_release_driver
 * - acp_transfer_driver
 * - acp_get_events
 * - acp_get_chat
 * - acp_get_timeline
 * - acp_get_terminal_debug
 */

import { describe, it, expect } from 'vitest';
import {
  acpSendPromptSchema,
  acpRespondApprovalSchema,
  acpPauseSessionSchema,
  acpResumeSessionSchema,
  acpCancelSessionSchema,
  acpClaimDriverSchema,
  acpReleaseDriverSchema,
  acpTransferDriverSchema,
  acpGetEventsSchema,
  acpGetChatSchema,
  acpGetTimelineSchema,
  acpGetTerminalDebugSchema,
} from '../validation.js';
import { z } from 'zod';

describe('ACP-native MCP tool validation schemas (ACP-065)', () => {
  const validSessionId = '12345678-1234-1234-1234-123456789012';
  const validKeyId = '87654321-4321-4321-4321-210987654321';

  describe('acpSendPromptSchema', () => {
    it('validates valid send prompt request', () => {
      const data = {
        sessionId: validSessionId,
        prompt: 'test prompt',
      };
      const result = acpSendPromptSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects missing sessionId', () => {
      const data = { prompt: 'test prompt' };
      const result = acpSendPromptSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects missing prompt', () => {
      const data = { sessionId: validSessionId };
      const result = acpSendPromptSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid sessionId format', () => {
      const data = { sessionId: 'not-a-uuid', prompt: 'test' };
      const result = acpSendPromptSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects empty prompt', () => {
      const data = { sessionId: validSessionId, prompt: '' };
      const result = acpSendPromptSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpRespondApprovalSchema', () => {
    it('validates valid approval response', () => {
      const data = {
        sessionId: validSessionId,
        approved: true,
      };
      const result = acpRespondApprovalSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates rejection with reason', () => {
      const data = {
        sessionId: validSessionId,
        approved: false,
        reason: 'Unsafe operation',
      };
      const result = acpRespondApprovalSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('requires approved field', () => {
      const data = { sessionId: validSessionId };
      const result = acpRespondApprovalSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpPauseSessionSchema', () => {
    it('validates valid pause request', () => {
      const data = { sessionId: validSessionId };
      const result = acpPauseSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates pause with reason', () => {
      const data = { sessionId: validSessionId, reason: 'Manual intervention' };
      const result = acpPauseSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects invalid sessionId', () => {
      const data = { sessionId: 'invalid' };
      const result = acpPauseSessionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpResumeSessionSchema', () => {
    it('validates valid resume request', () => {
      const data = { sessionId: validSessionId };
      const result = acpResumeSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('requires sessionId', () => {
      const data = {};
      const result = acpResumeSessionSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpCancelSessionSchema', () => {
    it('validates valid cancel request', () => {
      const data = { sessionId: validSessionId };
      const result = acpCancelSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates cancel with force flag', () => {
      const data = { sessionId: validSessionId, force: true };
      const result = acpCancelSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates graceful cancel', () => {
      const data = { sessionId: validSessionId, force: false };
      const result = acpCancelSessionSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('acpClaimDriverSchema', () => {
    it('validates valid claim driver request', () => {
      const data = { sessionId: validSessionId };
      const result = acpClaimDriverSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates claim driver with TTL', () => {
      const data = { sessionId: validSessionId, ttlSeconds: 3600 };
      const result = acpClaimDriverSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects zero TTL', () => {
      const data = { sessionId: validSessionId, ttlSeconds: 0 };
      const result = acpClaimDriverSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects negative TTL', () => {
      const data = { sessionId: validSessionId, ttlSeconds: -100 };
      const result = acpClaimDriverSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpReleaseDriverSchema', () => {
    it('validates valid release driver request', () => {
      const data = { sessionId: validSessionId };
      const result = acpReleaseDriverSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('requires sessionId', () => {
      const data = {};
      const result = acpReleaseDriverSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpTransferDriverSchema', () => {
    it('validates valid transfer driver request', () => {
      const data = { sessionId: validSessionId, targetKeyId: validKeyId };
      const result = acpTransferDriverSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('requires sessionId', () => {
      const data = { targetKeyId: validKeyId };
      const result = acpTransferDriverSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('requires targetKeyId', () => {
      const data = { sessionId: validSessionId };
      const result = acpTransferDriverSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects invalid targetKeyId format', () => {
      const data = { sessionId: validSessionId, targetKeyId: 'not-a-uuid' };
      const result = acpTransferDriverSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpGetEventsSchema', () => {
    it('validates valid get events request', () => {
      const data = { sessionId: validSessionId };
      const result = acpGetEventsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates with pagination parameters', () => {
      const data = { sessionId: validSessionId, since: 100, limit: 50 };
      const result = acpGetEventsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('accepts zero since', () => {
      const data = { sessionId: validSessionId, since: 0 };
      const result = acpGetEventsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects negative since', () => {
      const data = { sessionId: validSessionId, since: -1 };
      const result = acpGetEventsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects zero limit', () => {
      const data = { sessionId: validSessionId, limit: 0 };
      const result = acpGetEventsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpGetChatSchema', () => {
    it('validates valid get chat request', () => {
      const data = { sessionId: validSessionId };
      const result = acpGetChatSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates with pagination parameters', () => {
      const data = { sessionId: validSessionId, offset: 0, limit: 50 };
      const result = acpGetChatSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('accepts zero offset', () => {
      const data = { sessionId: validSessionId, offset: 0 };
      const result = acpGetChatSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects negative offset', () => {
      const data = { sessionId: validSessionId, offset: -1 };
      const result = acpGetChatSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('acpGetTimelineSchema', () => {
    it('validates valid get timeline request', () => {
      const data = { sessionId: validSessionId };
      const result = acpGetTimelineSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates with pagination parameters', () => {
      const data = { sessionId: validSessionId, offset: 10, limit: 100 };
      const result = acpGetTimelineSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('acpGetTerminalDebugSchema', () => {
    it('validates valid get terminal debug request', () => {
      const data = { sessionId: validSessionId };
      const result = acpGetTerminalDebugSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates with maxLines parameter', () => {
      const data = { sessionId: validSessionId, maxLines: 100 };
      const result = acpGetTerminalDebugSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects zero maxLines', () => {
      const data = { sessionId: validSessionId, maxLines: 0 };
      const result = acpGetTerminalDebugSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('Schema composition', () => {
    it('all schemas reject extra fields (strict mode)', () => {
      const data = {
        sessionId: validSessionId,
        prompt: 'test',
        extraField: 'not allowed',
      };
      const result = acpSendPromptSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('all ACP schemas use UUID for IDs', () => {
      const invalidId = 'not-a-uuid';
      
      const schemas = [
        { schema: acpSendPromptSchema, data: { sessionId: invalidId, prompt: 'test' } },
        { schema: acpRespondApprovalSchema, data: { sessionId: invalidId, approved: true } },
        { schema: acpPauseSessionSchema, data: { sessionId: invalidId } },
        { schema: acpResumeSessionSchema, data: { sessionId: invalidId } },
        { schema: acpCancelSessionSchema, data: { sessionId: invalidId } },
        { schema: acpClaimDriverSchema, data: { sessionId: invalidId } },
        { schema: acpReleaseDriverSchema, data: { sessionId: invalidId } },
        { schema: acpGetEventsSchema, data: { sessionId: invalidId } },
        { schema: acpGetChatSchema, data: { sessionId: invalidId } },
        { schema: acpGetTimelineSchema, data: { sessionId: invalidId } },
        { schema: acpGetTerminalDebugSchema, data: { sessionId: invalidId } },
      ];

      for (const { schema, data } of schemas) {
        const result = schema.safeParse(data);
        expect(result.success).toBe(false, `Schema should reject invalid UUID: ${JSON.stringify(data)}`);
      }
    });
  });
});

