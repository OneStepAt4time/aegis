/**
 * PipelineStatusBadge tests — status badge for pipeline states.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineStatusBadge from './PipelineStatusBadge';

describe('PipelineStatusBadge', () => {
  it('renders status text', () => {
    render(<PipelineStatusBadge status="running" />);
    expect(screen.getByText('running')).not.toBeNull();
  });

  it('has role="status"', () => {
    render(<PipelineStatusBadge status="completed" />);
    expect(screen.getByRole('status')).not.toBeNull();
  });

  it('has aria-label with status label', () => {
    render(<PipelineStatusBadge status="failed" />);
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Pipeline status: Failed');
  });

  it('shows ping animation for running status', () => {
    const { container } = render(<PipelineStatusBadge status="running" />);
    expect(container.querySelector('.animate-ping')).not.toBeNull();
  });

  it('no ping animation for completed status', () => {
    const { container } = render(<PipelineStatusBadge status="completed" />);
    expect(container.querySelector('.animate-ping')).toBeNull();
  });

  it('no ping animation for pending status', () => {
    const { container } = render(<PipelineStatusBadge status="pending" />);
    expect(container.querySelector('.animate-ping')).toBeNull();
  });

  it('handles unknown status gracefully', () => {
    render(<PipelineStatusBadge status="unknown-status" />);
    expect(screen.getByText('unknown-status')).not.toBeNull();
  });
});
