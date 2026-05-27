import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ShieldLogoMark, ShieldWordmark } from '../ShieldLogo';

describe('ShieldLogoMark', () => {
  it('renders an svg element', () => {
    const { container } = render(<ShieldLogoMark />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('defaults to md size (24x24)', () => {
    const { container } = render(<ShieldLogoMark />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('renders sm size (16x16)', () => {
    const { container } = render(<ShieldLogoMark size="sm" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
  });

  it('renders lg size (32x32)', () => {
    const { container } = render(<ShieldLogoMark size="lg" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });

  it('renders xl size (48x48)', () => {
    const { container } = render(<ShieldLogoMark size="xl" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('48');
    expect(svg.getAttribute('height')).toBe('48');
  });

  it('sets aria-hidden="true"', () => {
    const { container } = render(<ShieldLogoMark />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });

  it('has viewBox="0 0 24 24"', () => {
    const { container } = render(<ShieldLogoMark />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('forwards className', () => {
    const { container } = render(<ShieldLogoMark className="my-class" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('class')).toContain('my-class');
  });

  it('contains a linearGradient definition', () => {
    const { container } = render(<ShieldLogoMark />);
    const defs = container.querySelector('defs');
    expect(defs).not.toBeNull();
    const gradient = defs!.querySelector('linearGradient');
    expect(gradient).not.toBeNull();
  });

  it('renders two path elements (gradient fill + overlay)', () => {
    const { container } = render(<ShieldLogoMark />);
    const paths = container.querySelectorAll('path');
    expect(paths.length).toBe(2);
  });
});

describe('ShieldWordmark', () => {
  it('renders the mark and text by default', () => {
    const { container, getByText } = render(<ShieldWordmark />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(getByText('Aegis')).not.toBeNull();
  });

  it('hides text when collapsed=true', () => {
    const { container, queryByText } = render(<ShieldWordmark collapsed />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(queryByText('Aegis')).toBeNull();
  });

  it('defaults to md size', () => {
    const { container } = render(<ShieldWordmark />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('24');
  });

  it('respects size prop', () => {
    const { container } = render(<ShieldWordmark size="lg" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('32');
  });

  it('forwards className to outer div', () => {
    const { container } = render(<ShieldWordmark className="extra-class" />);
    const div = container.firstChild as HTMLElement;
    expect(div.getAttribute('class')).toContain('extra-class');
  });

  it('wraps in a flex container', () => {
    const { container } = render(<ShieldWordmark />);
    const div = container.firstChild as HTMLElement;
    expect(div.getAttribute('class')).toContain('flex');
  });
});
