/**
 * permission-autoselect.test.ts — Phase 3.6 / ADR-0034 + Issue #4689.
 * Auto-approve must pick an option the agent actually offered. Claude Code
 * offers 'allow-once'; Kimi offers 'approve'/'approve_for_session'. A hardcoded
 * optionId breaks non-CC runners (edit never applied).
 */
import { describe, expect, it } from 'vitest';

import {
  extractPermissionOptions,
  pickAutoApproveOptionId,
} from '../services/acp/backend/permission-autoselect.js';

describe('pickAutoApproveOptionId — runner-agnostic auto-approve', () => {
  it('selects the Claude Code allow option', () => {
    const params = { options: [{ id: 'allow-once' }, { id: 'allow-always' }, { id: 'deny' }] };
    expect(pickAutoApproveOptionId(params)).toBe('allow-once');
  });

  it('selects the Kimi approve option', () => {
    const params = { options: [{ id: 'approve' }, { id: 'approve_for_session' }, { id: 'reject' }] };
    expect(pickAutoApproveOptionId(params)).toBe('approve');
  });

  it('falls back to the first offered option when none match the allow vocabulary', () => {
    const params = { options: [{ id: 'grant' }, { id: 'permit' }] };
    expect(pickAutoApproveOptionId(params)).toBe('grant');
  });

  it('falls back to "allow-once" when no options are offered', () => {
    expect(pickAutoApproveOptionId({ options: [] })).toBe('allow-once');
    expect(pickAutoApproveOptionId({})).toBe('allow-once');
    expect(pickAutoApproveOptionId(null)).toBe('allow-once');
    expect(pickAutoApproveOptionId(undefined)).toBe('allow-once');
  });

  it('extractPermissionOptions ignores non-object / id-less entries', () => {
    const params = { options: [{ id: 'approve' }, 'junk', { noId: true }, null, { id: 7 }] };
    expect(extractPermissionOptions(params)).toEqual(['approve']);
  });
});
