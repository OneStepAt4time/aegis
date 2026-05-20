import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusDot } from '../StatusDot';
import type { StatusDotVariant } from '../StatusDot';

const variants: StatusDotVariant[] = [
  'idle',
  'working',
  'waiting',
  'error',
  'compacting',
  'unknown',
];

const expectedColors: Record<StatusDotVariant, string> = {
  idle: 'var(--color-success)',
  working: 'var(--color-warning)',
  waiting: 'var(--color-info)',
  error: 'var(--color-danger)',
  compacting: 'var(--color-accent-purple)',
  unknown: 'var(--color-text-muted)',
};

describe('StatusDot', () => {
  it.each(variants)('renders variant "%s"', (variant) => {
    const { container } = render(<StatusDot variant={variant} />);
    const circle = container.querySelector('svg');
    expect(circle).not.toBeNull();
    expect(circle?.getAttribute('data-variant')).toBe(variant);
  });

  it.each(variants)('applies correct color for variant "%s"', (variant) => {
    const { container } = render(<StatusDot variant={variant} />);
    const circle = container.querySelector('svg');
    const style = circle?.getAttribute('style') ?? '';
    expect(style).toContain(expectedColors[variant]);
  });

  it.each(variants)('has default aria-label for variant "%s"', (variant) => {
    const { container } = render(<StatusDot variant={variant} />);
    const circle = container.querySelector('svg');
    expect(circle?.getAttribute('aria-label')).toBe(`status: ${variant}`);
  });

  it('uses custom aria-label when provided', () => {
    const { container } = render(<StatusDot variant="error" aria-label="custom label" />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('custom label');
  });

  it('defaults to size 10', () => {
    const { container } = render(<StatusDot variant="idle" />);
    const circle = container.querySelector('svg');
    expect(circle?.getAttribute('width')).toBe('10');
    expect(circle?.getAttribute('height')).toBe('10');
  });

  it('respects custom size', () => {
    const { container } = render(<StatusDot variant="idle" size={12} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('12');
  });

  it('has pulse animation only on working variant', () => {
    const { container: working } = render(<StatusDot variant="working" />);
    expect(working.querySelector('svg')?.getAttribute('style')).toContain('pulse-intense');

    const { container: idle } = render(<StatusDot variant="idle" />);
    expect(idle.querySelector('svg')?.getAttribute('style')).not.toContain('pulse-intense');
  });

  it('has role="img"', () => {
    const { container } = render(<StatusDot variant="idle" />);
    expect(container.querySelector('svg')?.getAttribute('role')).toBe('img');
  });
});
