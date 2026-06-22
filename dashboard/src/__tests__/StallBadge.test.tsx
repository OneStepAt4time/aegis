/**
 * __tests__/StallBadge.test.tsx — Issue #4802: typed stall pill.
 *
 * Path 2 defensive: tests cover both typed payload (post-F-9) and missing
 * fields (pre-F-9) scenarios. The badge must render gracefully when the
 * typed payload isn't yet wired to the SSE bus.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StallBadge } from '../components/session/StallBadge';
import type { StallEventPayload } from '../api/schemas';

describe('Issue #4802: StallBadge', () => {
  it('renders generic "Stalled" label when payload is empty (Path 2 default)', () => {
    render(<StallBadge payload={{}} />);
    expect(screen.getByText('Stalled')).toBeDefined();
  });

  it('renders typed errorClass label when present', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'transient_5xx',
    };
    render(<StallBadge payload={payload} />);
    expect(screen.getByText('Transient 5xx')).toBeDefined();
  });

  it('renders JSONL Stall label for jsonl_stall class', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'jsonl_stall',
    };
    render(<StallBadge payload={payload} />);
    expect(screen.getByText('JSONL Stall')).toBeDefined();
  });

  it('renders sub-label "X/Y (auto-recovering…)" when not exhausted', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'transient_5xx',
      recoveryAttemptCount: 3,
      recoveryMaxAttempts: 5,
    };
    render(<StallBadge payload={payload} />);
    expect(screen.getByText('Transient 5xx')).toBeDefined();
    expect(screen.getByText('3/5 (auto-recovering…)')).toBeDefined();
  });

  it('renders sub-label "X/Y — intervention required" when exhausted', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'transient_5xx',
      recoveryAttemptCount: 5,
      recoveryMaxAttempts: 5,
    };
    render(<StallBadge payload={payload} />);
    expect(screen.getByText('5/5 — intervention required')).toBeDefined();
  });

  it('hides sub-label when max is 0 (Path 2 default)', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'transient_5xx',
      recoveryAttemptCount: 0,
      recoveryMaxAttempts: 0,
    };
    const { container } = render(<StallBadge payload={payload} />);
    expect(screen.getByText('Transient 5xx')).toBeDefined();
    expect(container.textContent).not.toContain('0/0');
  });

  it('renders kill-switch overlay when recoveryDisabled', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'transient_5xx',
      recoveryAttemptCount: 2,
      recoveryMaxAttempts: 5,
      recoveryDisabled: true,
    };
    render(<StallBadge payload={payload} />);
    // Kill-switch icon has aria-label "Auto-recovery paused (operator kill-switch)"
    expect(screen.getByLabelText('Auto-recovery paused (operator kill-switch)')).toBeDefined();
  });

  it('marks data-stall-exhausted when cap is reached', () => {
    const payload: Partial<StallEventPayload> = {
      errorClass: 'transient_5xx',
      recoveryAttemptCount: 5,
      recoveryMaxAttempts: 5,
    };
    const { container } = render(<StallBadge payload={payload} />);
    const badge = container.querySelector('[data-stall-exhausted]');
    expect(badge).not.toBeNull();
  });
});
