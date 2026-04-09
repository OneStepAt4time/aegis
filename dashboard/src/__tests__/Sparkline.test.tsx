import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Sparkline from '../components/Sparkline';

describe('Sparkline', () => {
  it('renders with data', () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5, 4]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    const bars = svg!.querySelectorAll('rect');
    expect(bars.length).toBe(5);
  });

  it('renders empty state (flat line)', () => {
    const { container } = render(<Sparkline data={[]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    const line = svg!.querySelector('line');
    expect(line).toBeDefined();
    // No bars should be rendered
    const bars = svg!.querySelectorAll('rect');
    expect(bars.length).toBe(0);
  });

  it('renders single data point', () => {
    const { container } = render(<Sparkline data={[42]} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
    const bars = svg!.querySelectorAll('rect');
    expect(bars.length).toBe(1);
  });

  it('has correct SVG attributes (viewBox, bars)', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} width={60} height={24} color="#ff0000" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('60');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('viewBox')).toBe('0 0 60 24');

    const bars = svg.querySelectorAll('rect');
    expect(bars.length).toBe(3);
    // All bars should use the provided color
    for (const bar of bars) {
      expect(bar.getAttribute('fill')).toBe('#ff0000');
    }
  });

  it('uses default dimensions when not specified', () => {
    const { container } = render(<Sparkline data={[1, 2]} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('60');
    expect(svg.getAttribute('height')).toBe('24');
    const bars = svg.querySelectorAll('rect');
    expect(bars[0].getAttribute('fill')).toBe('#00e5ff');
  });
});
