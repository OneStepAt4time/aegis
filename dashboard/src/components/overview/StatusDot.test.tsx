/**
 * StatusDot.test.tsx — Tests for the canonical StatusDot component.
 *
 * Covers: all UIState colors, health overrides, pulse animation,
 * aria-labels, and i18n labels.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusDot from './StatusDot';
import type { UIState } from '../../types';

describe('StatusDot', () => {
  const statusStates: UIState[] = [
    'idle', 'working', 'compacting', 'context_warning', 'waiting_for_input',
    'permission_prompt', 'plan_mode', 'ask_question', 'bash_approval',
    'settings', 'error', 'rate_limit', 'pending', 'killed', 'completed',
    'crashed', 'unknown',
  ];

  it.each(statusStates)('renders for UIState "%s" as an img role', (status) => {
    const { container } = render(<StatusDot status={status} />);
    const dot = container.querySelector('[role="img"]');
    expect(dot).toBeTruthy();
  });

  it.each(statusStates)('has aria-label for UIState "%s"', (status) => {
    render(<StatusDot status={status} />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toContain('Status:');
  });

  it('renders as an 8x8 circle', () => {
    const { container } = render(<StatusDot status="idle" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.width).toBe('8px');
    expect(dot.style.height).toBe('8px');
    expect(dot.style.borderRadius).toBe('50%');
  });

  it('uses backgroundColor from CSS variables', () => {
    const { container } = render(<StatusDot status="idle" />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.style.backgroundColor).toContain('var(--color-');
  });

  describe('pulse animation', () => {
    const pulseStates: UIState[] = ['working', 'permission_prompt', 'bash_approval', 'ask_question'];
    const noPulseStates: UIState[] = ['idle', 'error', 'completed', 'killed'];

    it.each(pulseStates)('pulses for "%s"', (status) => {
      const { container } = render(<StatusDot status={status} />);
      const dot = container.firstChild as HTMLElement;
      expect(dot.style.animation).toContain('pulse');
    });

    it.each(noPulseStates)('does NOT pulse for "%s"', (status) => {
      const { container } = render(<StatusDot status={status} />);
      const dot = container.firstChild as HTMLElement;
      expect(dot.style.animation).toBeFalsy();
    });
  });

  describe('health state overrides', () => {
    it('overrides color when health="stall"', () => {
      const { container } = render(<StatusDot status="idle" health="stall" />);
      const dot = container.firstChild as HTMLElement;
      expect(dot.style.backgroundColor).toBe('var(--color-warning)');
      expect(dot.style.animation).toContain('pulse');
      expect(dot.style.animation).toContain('2s');
    });

    it('overrides color when health="dead" and does NOT pulse', () => {
      const { container } = render(<StatusDot status="idle" health="dead" />);
      const dot = container.firstChild as HTMLElement;
      expect(dot.style.backgroundColor).toBe('var(--color-dot-red)');
      // Dead is intentionally static — shouldPulse excludes isDead
      expect(dot.style.animation).toBeFalsy();
    });

    it('shows "Dead" label when health="dead"', () => {
      render(<StatusDot status="working" health="dead" />);
      const dot = screen.getByRole('img');
      expect(dot.getAttribute('aria-label')).toBe('Status: Dead');
    });

    it('shows "Stalled" label when health="stall"', () => {
      render(<StatusDot status="working" health="stall" />);
      const dot = screen.getByRole('img');
      expect(dot.getAttribute('aria-label')).toBe('Status: Stalled');
    });

    it('null health does not override', () => {
      const { container: c1 } = render(<StatusDot status="idle" health={null} />);
      const { container: c2 } = render(<StatusDot status="idle" />);
      const dot1 = c1.firstChild as HTMLElement;
      const dot2 = c2.firstChild as HTMLElement;
      expect(dot1.style.backgroundColor).toBe(dot2.style.backgroundColor);
    });
  });

  describe('title attribute', () => {
    it('has title for idle status', () => {
      render(<StatusDot status="idle" />);
      const dot = screen.getByRole('img');
      expect(dot.getAttribute('title')).toBeTruthy();
    });

    it('title changes per status', () => {
      const { rerender } = render(<StatusDot status="idle" />);
      const idleTitle = screen.getByRole('img').getAttribute('title');

      rerender(<StatusDot status="error" />);
      const errorTitle = screen.getByRole('img').getAttribute('title');

      expect(idleTitle).not.toBe(errorTitle);
    });
  });
});
