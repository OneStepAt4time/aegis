/**
 * Issue #3860: GET /v1/sessions/:id/status returns 404 for all sessions
 *
 * Simple integration test: verify /v1/sessions/:id/status route exists
 * and returns expected shape.
 */
import { describe, it, expect } from 'vitest';

const BASE = 'http://localhost:9100';
const TOKEN = process.env.AEGIS_TOKEN || '';

describe('GET /v1/sessions/:id/status (#3860)', () => {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };

  it('returns 200 with {id, status, lastActivity} for existing session', async () => {
    // Create a session
    const createRes = await fetch(`${BASE}/v1/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workDir: '/home/bubuntu/projects/aegis' }),
    });
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json() as any;

    // Hit the status endpoint
    const statusRes = await fetch(`${BASE}/v1/sessions/${id}/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(statusRes.status).toBe(200);
    const body = await statusRes.json() as any;
    expect(body.id).toBe(id);
    expect(typeof body.status).toBe('string');
    expect(typeof body.lastActivity).toBe('number');

    // Cleanup
    await fetch(`${BASE}/v1/sessions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it('returns 404 for non-existent session', async () => {
    const res = await fetch(`${BASE}/v1/sessions/00000000-0000-4000-8000-000000009999/status`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
  });
});
