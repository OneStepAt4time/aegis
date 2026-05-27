import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KPIBanner } from '../KPIBanner';
import type { KPIItem } from '../KPIBanner';

const mockItems: KPIItem[] = [
  { id: 'input', label: 'Input Tokens', value: '1.2M', color: 'input', subtitle: '+12%', trend: 'up' },
  { id: 'output', label: 'Output Tokens', value: '456K', color: 'output' },
  { id: 'cost', label: 'Cost', value: '$12.34', color: 'cost', subtitle: '-5%', trend: 'down' },
  { id: 'eff', label: 'Efficiency', value: '87%', color: 'efficiency', subtitle: 'stable', trend: 'flat' },
];

describe('KPIBanner', () => {
  it('renders empty state when no items', () => {
    render(<KPIBanner items={[]} />);
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders all items as list items', () => {
    render(<KPIBanner items={mockItems} />);
    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(4);
  });

  it('renders labels and values', () => {
    render(<KPIBanner items={mockItems} />);
    expect(screen.getByText('Input Tokens')).toBeDefined();
    expect(screen.getByText('1.2M')).toBeDefined();
  });

  it('applies color classes based on item color', () => {
    render(<KPIBanner items={mockItems} />);
    const costValue = screen.getByText('$12.34').closest('span');
    expect(costValue?.className).toContain('text-[');
  });

  it('renders subtitles', () => {
    render(<KPIBanner items={mockItems} />);
    expect(screen.getByText('+12%')).toBeDefined();
  });

  it('renders trend icons', () => {
    render(<KPIBanner items={mockItems} />);
    expect(screen.getByText('▲')).toBeDefined();
    expect(screen.getByText('▼')).toBeDefined();
    expect(screen.getByText('●')).toBeDefined();
  });

  it('has list role on container', () => {
    render(<KPIBanner items={mockItems} />);
    expect(screen.getByRole('list')).toBeDefined();
  });

  it('applies custom className', () => {
    const { container } = render(<KPIBanner items={mockItems} className="my-class" />);
    const banner = container.firstChild as HTMLElement;
    expect(banner.className).toContain('my-class');
  });

  it('sets grid columns based on item count', () => {
    const { container } = render(<KPIBanner items={mockItems} />);
    const banner = container.firstChild as HTMLElement;
    expect(banner.style.gridTemplateColumns).toContain('repeat(4');
  });
});
