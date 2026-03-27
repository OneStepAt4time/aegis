import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PipelineStatusBadge from '../components/pipeline/PipelineStatusBadge';

describe('PipelineStatusBadge', () => {
  it('renders running status with cyan color', () => {
    render(<PipelineStatusBadge status="running" />);
    const badge = screen.getByText('running');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-cyan');
  });

  it('renders completed status with green color', () => {
    render(<PipelineStatusBadge status="completed" />);
    const badge = screen.getByText('completed');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-emerald-400');
  });

  it('renders failed status with red color', () => {
    render(<PipelineStatusBadge status="failed" />);
    const badge = screen.getByText('failed');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-red-400');
  });

  it('renders unknown status with gray color', () => {
    render(<PipelineStatusBadge status="something_else" />);
    const badge = screen.getByText('something_else');
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-gray-500');
  });
});
