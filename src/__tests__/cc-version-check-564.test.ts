/**
 * cc-version-check-564.test.ts — Tests for Issue #564: CC version validation.
 *
 * Verifies:
 * 1. parseSemver handles various version formats
 * 2. compareSemver correctly compares versions
 * 3. extractCCVersion parses `claude --version` output
 * 4. Session creation returns 422 when CC version is too old
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import {
  parseSemver,
  compareSemver,
  extractCCVersion,
  MIN_CC_VERSION,
} from '../validation.js';

// ---------------------------------------------------------------------------
// Unit tests for pure version functions
// ---------------------------------------------------------------------------

describe('Issue #564: CC version validation — pure functions', () => {
  describe('parseSemver', () => {
    it('should parse a valid semver string', () => {
      expect(parseSemver('2.1.80')).toEqual([2, 1, 80]);
    });

    it('should parse a version with trailing text', () => {
      expect(parseSemver('2.1.80-beta')).toEqual([2, 1, 80]);
    });

    it('should trim whitespace', () => {
      expect(parseSemver('  2.1.80  ')).toEqual([2, 1, 80]);
    });

    it('should return null for invalid input', () => {
      expect(parseSemver('not-a-version')).toBeNull();
    });

    it('should return null for incomplete version', () => {
      expect(parseSemver('2.1')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseSemver('')).toBeNull();
    });
  });

  describe('compareSemver', () => {
    it('should return 0 for equal versions', () => {
      expect(compareSemver('2.1.80', '2.1.80')).toBe(0);
    });

    it('should return -1 when a < b (patch difference)', () => {
      expect(compareSemver('2.1.79', '2.1.80')).toBe(-1);
    });

    it('should return 1 when a > b (patch difference)', () => {
      expect(compareSemver('2.1.81', '2.1.80')).toBe(1);
    });

    it('should return -1 when a < b (minor difference)', () => {
      expect(compareSemver('2.0.90', '2.1.80')).toBe(-1);
    });

    it('should return 1 when a > b (major difference)', () => {
      expect(compareSemver('3.0.0', '2.1.80')).toBe(1);
    });

    it('should return 0 if either version is unparseable (fails open)', () => {
      expect(compareSemver('invalid', '2.1.80')).toBe(0);
      expect(compareSemver('2.1.80', 'invalid')).toBe(0);
    });
  });

  describe('extractCCVersion', () => {
    it('should extract version from "2.1.90 (Claude Code)" format', () => {
      expect(extractCCVersion('2.1.90 (Claude Code)')).toBe('2.1.90');
    });

    it('should extract version from "claude-code 2.1.80" format', () => {
      expect(extractCCVersion('claude-code 2.1.80')).toBe('2.1.80');
    });

    it('should extract version from bare "1.2.3" format', () => {
      expect(extractCCVersion('1.2.3')).toBe('1.2.3');
    });

    it('should return null for output without a version', () => {
      expect(extractCCVersion('command not found')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractCCVersion('')).toBeNull();
    });
  });

  describe('MIN_CC_VERSION constant', () => {
    it('should be a valid semver string', () => {
      expect(parseSemver(MIN_CC_VERSION)).not.toBeNull();
    });

    it('should be 2.1.80', () => {
      expect(MIN_CC_VERSION).toBe('2.1.80');
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: POST /v1/sessions returns 422 when CC version is too old
// ---------------------------------------------------------------------------

describe('Issue #564: POST /v1/sessions version check', () => {
  async function buildApp(ccVersion: string | null) {
    const app = Fastify();

    app.post('/v1/sessions', async (_req, reply) => {
      // Issue #564: Validate installed Claude Code version
      if (ccVersion !== null && compareSemver(ccVersion, MIN_CC_VERSION) < 0) {
        return reply.status(422).send({
          error: `Claude Code version ${ccVersion} is below minimum supported version ${MIN_CC_VERSION}. Please upgrade.`,
          code: 'CC_VERSION_TOO_OLD',
          upgrade: 'Run: claude update  or  npm install -g @anthropic-ai/claude-code@latest',
        });
      }

      return reply.status(201).send({ id: 'new-session', reused: false });
    });

    return app;
  }

  it('should return 422 when CC version is below minimum', async () => {
    const app = await buildApp('2.1.63');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.code).toBe('CC_VERSION_TOO_OLD');
    expect(body.error).toContain('2.1.63');
    expect(body.error).toContain(MIN_CC_VERSION);
    expect(body.upgrade).toContain('claude update');
  });

  it('should allow session creation when CC version meets minimum', async () => {
    const app = await buildApp('2.1.80');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('should allow session creation when CC version exceeds minimum', async () => {
    const app = await buildApp('3.0.0');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(201);
  });

  it('should allow session creation when CC version cannot be determined', async () => {
    const app = await buildApp(null);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      payload: { workDir: '/project/a' },
    });

    expect(response.statusCode).toBe(201);
  });
});
