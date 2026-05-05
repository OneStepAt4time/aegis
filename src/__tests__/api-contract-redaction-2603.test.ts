/**
 * api-contract-redaction-2603.test.ts — ACP-060 public session contract cleanup.
 */

import { describe, expect, it } from 'vitest';
import { redactSession } from '../routes/context.js';

describe('ACP-060 public API redaction', () => {
  it('removes tmux window identifiers while preserving the public session name', () => {
    const redacted = redactSession({
      id: 'session-1',
      windowId: '@42',
      windowName: 'review-session',
      workDir: 'D:\\repo',
      status: 'idle',
      hookSecret: 'secret',
      activeSubagents: new Set(['reviewer']),
    });

    expect(redacted).not.toHaveProperty('windowId');
    expect(redacted).not.toHaveProperty('windowName');
    expect(redacted).not.toHaveProperty('hookSecret');
    expect(redacted).toMatchObject({
      id: 'session-1',
      name: 'review-session',
      workDir: 'D:\\repo',
      activeSubagents: ['reviewer'],
    });
  });
});
