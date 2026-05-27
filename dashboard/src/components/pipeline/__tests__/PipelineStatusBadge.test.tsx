import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineStatusBadge from '../PipelineStatusBadge';

describe('PipelineStatusBadge', () => {
  it('renders the status text', () => {
    render(<PipelineStatusBadge status="completed" />);
    expect(screen.getByText('completed')).toBeTruthy();
  });

  it('has role="status"', () => {
    render(<PipelineStatusBadge status="running" />);
    const badge = screen.getByRole('status');
    expect(badge).toBeTruthy();
  });

  it('has correct aria-label for known status', () => {
    render(<PipelineStatusBadge status="failed" />);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('Pipeline status: Failed');
  });

  it('shows pulse indicator for running status', () => {
    const { container } = render(<PipelineStatusBadge status="running" />);
    const ping = container.querySelector('.animate-ping');
    expect(ping).toBeTruthy();
  });

  it('does not show pulse for completed status', () => {
    const { container } = render(<PipelineStatusBadge status="completed" />);
    const ping = container.querySelector('.animate-ping');
    expect(ping).toBeNull();
  });

  it('does not show pulse for pending status', () => {
    const { container } = render(<PipelineStatusBadge status="pending" />);
    const ping = container.querySelector('.animate-ping');
    expect(ping).toBeNull();
  });

  it('handles unknown status with fallback styling', () => {
    render(<PipelineStatusBadge status="unknown-status" />);
    const badge = screen.getByRole('status');
    expect(badge.textContent).toBe('unknown-status');
    expect(badge.getAttribute('aria-label')).toBe('Pipeline status: unknown-status');
  });

  it('applies known status styles for completed', () => {
    render(<PipelineStatusBadge status="completed" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-[var(--color-success-glow)]');
  });

  it('applies known status styles for failed', () => {
    render(<PipelineStatusBadge status="failed" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-[var(--color-danger)]');
  });

  it('applies pending status styles', () => {
    render(<PipelineStatusBadge status="pending" />);
    const badge = screen.getByRole('status');
    expect(badge.className).toContain('text-[var(--color-text-muted)]');
  });
});
