/**
 * StatusDot.test.tsx — Tests for StatusDot component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusDot from '../StatusDot';

describe('StatusDot', () => {
  it('renders for idle status', () => {
    render(<StatusDot status="idle" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Idle');
  });

  it('renders for working status with pulse animation', () => {
    render(<StatusDot status="working" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Working');
    expect(dot.style.animation).toContain('pulse');
  });

  it('renders for killed status without pulse', () => {
    render(<StatusDot status="killed" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Killed');
    expect(dot.style.animation).toBe('');
  });

  it('renders for completed status', () => {
    render(<StatusDot status="completed" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Completed');
  });

  it('renders health=stall with override color and slower pulse', () => {
    render(<StatusDot status="idle" health="stall" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Stalled');
    expect(dot.style.animation).toContain('2s');
  });

  it('renders health=dead label override', () => {
    render(<StatusDot status="idle" health="dead" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Dead');
  });

  it('renders for permission_prompt with pulse', () => {
    render(<StatusDot status="permission_prompt" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Permission prompt');
    expect(dot.style.animation).toContain('pulse');
  });

  it('renders for error status', () => {
    render(<StatusDot status="error" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Error');
  });

  it('renders for unknown status as fallback', () => {
    render(<StatusDot status="unknown" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('aria-label')).toBe('Status: Unknown');
  });

  it('has title attribute matching label', () => {
    render(<StatusDot status="idle" />);
    const dot = screen.getByRole('img');
    expect(dot.getAttribute('title')).toBe('Idle');
  });
});
