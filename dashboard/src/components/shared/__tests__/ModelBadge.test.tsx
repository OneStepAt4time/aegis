/**
 * ModelBadge.test.tsx — Tests for the model name badge component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelBadge } from '../ModelBadge';

describe('ModelBadge', () => {
  it('renders nothing when model is undefined', () => {
    const { container } = render(<ModelBadge />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when model is null', () => {
    const { container } = render(<ModelBadge model={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders Opus label for opus model', () => {
    render(<ModelBadge model="claude-opus-4.7" />);
    expect(screen.getByText('Opus')).toBeTruthy();
  });

  it('renders Sonnet label for sonnet model', () => {
    render(<ModelBadge model="claude-sonnet-4.6" />);
    expect(screen.getByText('Sonnet')).toBeTruthy();
  });

  it('renders Haiku label for haiku model', () => {
    render(<ModelBadge model="claude-haiku-3.5" />);
    expect(screen.getByText('Haiku')).toBeTruthy();
  });

  it('renders raw model name for unknown models', () => {
    render(<ModelBadge model="gpt-5" />);
    expect(screen.getByText('gpt-5')).toBeTruthy();
  });

  it('shows full model in title attribute', () => {
    render(<ModelBadge model="claude-opus-4.7-20250515" />);
    const badge = screen.getByText('Opus');
    expect(badge.closest('[title]')?.getAttribute('title')).toBe('claude-opus-4.7-20250515');
  });
});
