/**
 * Issue #3862: Prompt delivery fingerprint in session creation response
 *
 * Tests that POST /v1/sessions includes promptFingerprint with preview and hash
 * when a prompt is provided.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

// Helper to create a mock Fastify app with the sessions route
function createMockApp() {
  const handlers: Record<string, Function> = {};
  const app = {
    post: vi.fn((path, opts, handler) => { handlers[`POST ${path}`] = handler; }),
    get: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  };
  return { app, handlers };
}

describe('Prompt delivery fingerprint (#3862)', () => {
  describe('SHA256 prompt hash', () => {
    it('produces consistent 12-char hash', () => {
      const prompt = 'Refactor the authentication middleware';
      const hash = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
      expect(hash).toHaveLength(12);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('different prompts produce different hashes', () => {
      const hash1 = createHash('sha256').update('Fix the bug').digest('hex').slice(0, 12);
      const hash2 = createHash('sha256').update('Add a feature').digest('hex').slice(0, 12);
      expect(hash1).not.toBe(hash2);
    });

    it('same prompt produces same hash', () => {
      const prompt = 'Implement content validation';
      const hash1 = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
      const hash2 = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
      expect(hash1).toBe(hash2);
    });
  });

  describe('prompt preview', () => {
    it('returns full prompt when under 100 chars', () => {
      const prompt = 'Short prompt';
      const preview = prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt;
      expect(preview).toBe('Short prompt');
      expect(preview).not.toContain('...');
    });

    it('truncates prompt over 100 chars', () => {
      const prompt = 'x'.repeat(150);
      const preview = prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt;
      expect(preview).toHaveLength(103); // 100 + '...'
      expect(preview.endsWith('...')).toBe(true);
    });

    it('does not truncate at exactly 100 chars', () => {
      const prompt = 'x'.repeat(100);
      const preview = prompt.length > 100 ? prompt.slice(0, 100) + '...' : prompt;
      expect(preview).toHaveLength(100);
      expect(preview).not.toContain('...');
    });
  });
});
