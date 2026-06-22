/**
 * __tests__/StallBadge.guard.test.tsx — Issue #4802 (Argus review feedback):
 * always-conditional component integration guard.
 *
 * StallBadge must return null when the payload has no useful stall data,
 * to prevent a misleading "Stalled" pill from rendering for healthy sessions.
 * Mirrors the SendContinueButton L36 pattern.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StallBadge } from '../components/session/StallBadge';

describe('Issue #4802: StallBadge always-conditional guard (Argus review)', () => {
  it('returns null when payload is empty (no stall data)', () => {
    const { container } = render(<StallBadge payload={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when payload has only undefined fields', () => {
    const { container } = render(
      <StallBadge payload={{ errorClass: undefined, recoveryDisabled: undefined }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when all counters are 0 (Path 2 default state)', () => {
    const { container } = render(
      <StallBadge
        payload={{ recoveryAttemptCount: 0, recoveryMaxAttempts: 0, recoveryDisabled: false }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when errorClass is present (Path 2 with typed payload)', () => {
    const { container } = render(
      <StallBadge payload={{ errorClass: 'transient_5xx' }} />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('renders when recoveryDisabled is true (kill-switch overlay)', () => {
    const { container } = render(
      <StallBadge payload={{ recoveryDisabled: true }} />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('renders when recovery counter is non-zero', () => {
    const { container } = render(
      <StallBadge payload={{ recoveryAttemptCount: 3, recoveryMaxAttempts: 5 }} />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
