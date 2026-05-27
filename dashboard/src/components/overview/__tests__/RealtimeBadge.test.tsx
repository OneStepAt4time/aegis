import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RealtimeBadge from '../RealtimeBadge';

describe('RealtimeBadge', () => {
  it('renders polling mode label', () => {
    render(<RealtimeBadge mode="polling" message="SSE disconnected" />);
    expect(screen.getByText('Polling fallback')).toBeDefined();
  });

  it('renders paused mode label', () => {
    render(<RealtimeBadge mode="paused" message="Manual pause" />);
    expect(screen.getByText('Live updates paused')).toBeDefined();
  });

  it('sets title attribute from message prop', () => {
    render(<RealtimeBadge mode="polling" message="Connection lost" />);
    const badge = screen.getByText('Polling fallback').closest('span');
    expect(badge?.getAttribute('title')).toBe('Connection lost');
  });

  it('applies warning styling classes', () => {
    render(<RealtimeBadge mode="polling" message="test" />);
    const badge = screen.getByText('Polling fallback').closest('span');
    expect(badge?.className).toContain('border');
    expect(badge?.className).toContain('rounded-full');
  });
});
