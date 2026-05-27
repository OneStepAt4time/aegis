import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SparkLine } from '../SparkLine';

describe('SparkLine', () => {
  it('renders null when data has fewer than 2 points', () => {
    const { container } = render(<SparkLine data={[42]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders an SVG with role="img"', () => {
    const { container } = render(<SparkLine data={[1, 2, 3, 4]} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
  });

  it('uses custom aria-label when provided', () => {
    render(<SparkLine data={[1, 2, 3]} ariaLabel="Custom label" />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toBe('Custom label');
  });

  it('generates default aria-label from data', () => {
    render(<SparkLine data={[1, 10, 5]} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('aria-label')).toContain('Trend:');
  });

  it('applies custom dimensions', () => {
    render(<SparkLine data={[1, 2, 3]} width={200} height={100} />);
    const svg = screen.getByRole('img');
    expect(svg.getAttribute('width')).toBe('200');
    expect(svg.getAttribute('height')).toBe('100');
  });

  it('renders a path element with stroke data', () => {
    const { container } = render(<SparkLine data={[0, 10, 5, 8]} color="#ff0000" />);
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('fill')).toBe('none');
    expect(path?.getAttribute('stroke')).toBe('#ff0000');
  });

  it('applies custom className', () => {
    const { container } = render(<SparkLine data={[1, 2]} className="my-class" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('my-class');
  });
});
