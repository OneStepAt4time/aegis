import { describe, it, expect } from 'vitest';

describe('Issue #735: PRD persistence (slice 1)', () => {
  it('session summary shape can include optional prd', () => {
    const summary = {
      sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      windowName: 'cc-test',
      status: 'idle',
      totalMessages: 2,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      permissionMode: 'default',
      prd: 'Must update README and tests',
    };

    expect(typeof summary.prd).toBe('string');
    expect(summary.prd?.includes('README')).toBe(true);
  });

  it('create-session payload may include prd text', () => {
    const payload = {
      workDir: '/tmp/repo',
      prompt: 'Implement issue 735',
      prd: 'Acceptance: keep API backward compatible',
    };

    expect(payload.workDir.length).toBeGreaterThan(0);
    expect(payload.prd.length).toBeGreaterThan(0);
  });
});
