/**
 * requestkeymap-cleanup-839.test.ts — Tests for Issue #839:
 * requestKeyMap entries must be cleaned up after the response completes
 * to prevent an unbounded memory leak.
 *
 * Tests the cleanup pattern: entries added in onRequest are removed in onResponse.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';

describe('Issue #839: requestKeyMap cleanup after response', () => {
  let app: ReturnType<typeof Fastify>;
  let requestKeyMap: Map<string, string>;
  let capturedKeyId: string | undefined;

  beforeEach(async () => {
    requestKeyMap = new Map();
    capturedKeyId = undefined;
    app = Fastify();

    // Simulates the pattern from server.ts:
    // 1. onRequest sets the entry
    app.addHook('onRequest', async (req: FastifyRequest) => {
      requestKeyMap.set(req.id, 'test-key');
    });

    // 2. onResponse deletes the entry (#839 fix)
    app.addHook('onResponse', (req: FastifyRequest, _reply: FastifyReply, done: () => void) => {
      requestKeyMap.delete(req.id);
      done();
    });

    // Routes that read from the map (like batch route does)
    app.get('/v1/test', async (req: FastifyRequest) => {
      const keyId = requestKeyMap.get(req.id);
      return { keyId };
    });

    app.get('/v1/check', async (req: FastifyRequest) => {
      capturedKeyId = requestKeyMap.get(req.id);
      return { ok: true };
    });

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('adds entry during request and cleans up after response', async () => {
    // Before any request, map is empty
    expect(requestKeyMap.size).toBe(0);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ keyId: 'test-key' });

    // After response completes, map should be empty again
    expect(requestKeyMap.size).toBe(0);
  });

  it('does not accumulate entries across multiple requests', async () => {
    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'GET',
        url: '/v1/test',
      });
    }

    // Map should still be empty — no unbounded growth
    expect(requestKeyMap.size).toBe(0);
  });

  it('each request has access to its own keyId during processing', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/check',
    });

    // During processing, the key was accessible
    expect(capturedKeyId).toBe('test-key');
    // After response, map is clean
    expect(requestKeyMap.size).toBe(0);
  });
});
