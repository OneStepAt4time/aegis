/**
 * utils/__tests__/statusStyles.test.ts
 *
 * Contract test for the centralized §4 status → color map. Asserts every
 * UIState value (plus the `stalled` lifecycle variant) resolves to the
 * expected design token, and that an out-of-contract status falls back to
 * the muted `unknown` style.
 */

import { describe, it, expect } from 'vitest';
import {
  getStatusStyle,
  STATUS_STYLES,
  type StatusKey,
} from '../statusStyles';

const CYAN = 'var(--color-accent-cyan)';
const AMBER = 'var(--color-accent)';
const WARNING = 'var(--color-warning)';
const SUCCESS = 'var(--color-success)';
const DANGER = 'var(--color-danger)';
const MUTED = 'var(--color-placeholder)';

// Expected dot token per status (mirrors DESIGN.md §4 Status color map).
const EXPECTED_DOT: Record<StatusKey, string> = {
  idle: CYAN,
  working: AMBER,
  settings: AMBER,
  compacting: WARNING,
  context_warning: WARNING,
  waiting_for_input: WARNING,
  permission_prompt: WARNING,
  bash_approval: WARNING,
  plan_mode: WARNING,
  pending: WARNING,
  awaiting_approval: WARNING,
  stalled: WARNING,
  ask_question: DANGER,
  error: DANGER,
  rate_limit: DANGER,
  killed: DANGER,
  crashed: DANGER,
  completed: SUCCESS,
  unknown: MUTED,
};

describe('statusStyles — canonical §4 status color map', () => {
  const statuses = Object.keys(EXPECTED_DOT) as StatusKey[];

  it.each(statuses)('maps "%s" to its expected dot token', (status) => {
    expect(getStatusStyle(status).dotColor).toBe(EXPECTED_DOT[status]);
  });

  it.each(statuses)('returns a non-empty label and className for "%s"', (status) => {
    const style = getStatusStyle(status);
    expect(style.label.length).toBeGreaterThan(0);
    expect(style.className).toContain('text-[');
  });

  it('exposes DESIGN-mandated buckets via the explicit tokens', () => {
    expect(getStatusStyle('idle').dotColor).toBe(CYAN);
    expect(getStatusStyle('working').dotColor).toBe(AMBER);
    expect(getStatusStyle('completed').dotColor).toBe(SUCCESS);
    // error / killed / crashed all share the danger token.
    expect(getStatusStyle('error').dotColor).toBe(DANGER);
    expect(getStatusStyle('killed').dotColor).toBe(DANGER);
    expect(getStatusStyle('crashed').dotColor).toBe(DANGER);
  });

  it('falls back to the muted unknown style for an out-of-contract status', () => {
    const fallback = getStatusStyle('totally_not_a_status');
    expect(fallback).toBe(STATUS_STYLES.unknown);
    expect(fallback.dotColor).toBe(MUTED);
    expect(fallback.label).toBe('unknown');
  });

  it('treats an empty string as unknown', () => {
    expect(getStatusStyle('').dotColor).toBe(MUTED);
  });
});
