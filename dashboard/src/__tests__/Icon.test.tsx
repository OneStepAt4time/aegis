import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from '../components/Icon';

describe('Icon', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the requested Lucide icon as an svg at the requested size', () => {
    const { container } = render(<Icon name="Search" size={24} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('defaults to size 16 when no size is provided', () => {
    const { container } = render(<Icon name="Search" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
  });

  it('sets aria-hidden="true" when no aria-label is provided', () => {
    const { container } = render(<Icon name="Search" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('aria-label')).toBeNull();
  });

  it('omits aria-hidden and sets aria-label when aria-label is provided', () => {
    const { container } = render(<Icon name="Search" aria-label="Search" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBe('Search');
  });

  it('forwards className to the underlying svg', () => {
    const { container } = render(
      <Icon name="Search" className="text-accent" />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class') ?? '').toContain('text-accent');
  });

  it('renders nothing and warns when the icon name is not exported by lucide-react', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Cast through unknown — we are deliberately passing an invalid name at
    // runtime to verify the guard. Compile-time generics protect normal usage.
    const BadIcon = Icon as unknown as (props: {
      name: string;
      size?: number;
    }) => React.ReactElement | null;
    const { container } = render(<BadIcon name="DefinitelyNotAnIcon" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
