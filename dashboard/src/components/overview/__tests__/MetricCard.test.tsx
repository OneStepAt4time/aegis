import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import MetricCard from '../MetricCard';

// Mock AnimatedNumber to avoid complexity
vi.mock('../../shared/AnimatedNumber', () => ({
  AnimatedNumber: ({ value, suffix }: { value: number; suffix?: string }) => (
    <span data-testid="animated-number">{value}{suffix}</span>
  ),
}));

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Sessions" value={42} />);
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('42')).toBeDefined();
  });

  it('renders string value', () => {
    render(<MetricCard label="Status" value="Ready" />);
    expect(screen.getByText('Ready')).toBeDefined();
  });

  it('renders suffix', () => {
    render(<MetricCard label="Cost" value={5.67} suffix="USD" />);
    expect(screen.getByText('USD')).toBeDefined();
  });

  it('renders subLabel', () => {
    render(<MetricCard label="Rate" value={100} subLabel="per minute" />);
    expect(screen.getByText('per minute')).toBeDefined();
  });

  it('applies color variant', () => {
    const { container } = render(<MetricCard label="Test" value={1} color="red" />);
    const valueEl = container.querySelector('.text-\\[var\\(--color-error\\)\\]');
    expect(valueEl).not.toBeNull();
  });

  it('renders progress bar when bar prop is provided', () => {
    const { container } = render(<MetricCard label="CPU" value={75} bar={75} />);
    const bar = container.querySelector('.rounded-full.transition-all');
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe('75%');
  });

  it('clamps progress bar to 0-100', () => {
    const { container } = render(<MetricCard label="Over" value={200} bar={150} />);
    const bar = container.querySelector('.rounded-full.transition-all');
    expect((bar as HTMLElement).style.width).toBe('100%');
  });

  it('does not clamp zero progress', () => {
    const { container } = render(<MetricCard label="Min" value={-10} bar={-5} />);
    const bar = container.querySelector('.rounded-full.transition-all');
    expect((bar as HTMLElement).style.width).toBe('0%');
  });

  it('has role="article" with aria-label', () => {
    render(<MetricCard label="Active" value={10} />);
    const card = screen.getByRole('article');
    expect(card.getAttribute('aria-label')).toContain('Active');
    expect(card.getAttribute('aria-label')).toContain('10');
  });

  it('renders custom visual instead of value', () => {
    render(<MetricCard label="Efficiency" value={85} customVisual={<div data-testid="gauge">Gauge</div>} />);
    expect(screen.getByTestId('gauge')).toBeDefined();
    expect(screen.queryByText('85')).toBeNull();
  });

  it('does not render subLabel with customVisual', () => {
    render(
      <MetricCard label="Test" value={1} subLabel="hidden" customVisual={<div>Visual</div>} />
    );
    expect(screen.queryByText('hidden')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<MetricCard label="Test" value={1} className="col-span-2" />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain('col-span-2');
  });

  describe('progressive disclosure', () => {
    it('is clickable when sparkData is provided', () => {
      const { container } = render(<MetricCard label="Trend" value={5} sparkData={[1, 2, 3, 4]} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;
      expect(card.getAttribute('tabindex')).toBe('0');
    });

    it('is clickable when bar is provided', () => {
      const { container } = render(<MetricCard label="Progress" value={50} bar={50} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;
      expect(card.getAttribute('tabindex')).toBe('0');
    });

    it('is NOT clickable when no detail props', () => {
      const { container } = render(<MetricCard label="Plain" value={42} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;
      expect(card.getAttribute('tabindex')).toBeNull();
    });

    it('expands on click', () => {
      const { container } = render(<MetricCard label="Expand" value={10} bar={50} sparkData={[1, 2, 3]} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;
      expect(card.className).not.toContain('metric-card--expanded');

      fireEvent.click(card);
      expect(card.className).toContain('metric-card--expanded');

      fireEvent.click(card);
      expect(card.className).not.toContain('metric-card--expanded');
    });

    it('expands on Enter key', () => {
      const { container } = render(<MetricCard label="Key" value={10} bar={50} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;

      fireEvent.keyDown(card, { key: 'Enter' });
      expect(card.className).toContain('metric-card--expanded');
    });

    it('expands on Space key', () => {
      const { container } = render(<MetricCard label="Key" value={10} bar={50} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;

      fireEvent.keyDown(card, { key: ' ' });
      expect(card.className).toContain('metric-card--expanded');
    });

    it('does not expand on other keys', () => {
      const { container } = render(<MetricCard label="Key" value={10} bar={50} />);
      const card = container.querySelector('[role="article"]') as HTMLElement;

      fireEvent.keyDown(card, { key: 'Tab' });
      expect(card.className).not.toContain('metric-card--expanded');
    });
  });

  describe('animated numbers', () => {
    it('renders AnimatedNumber when animated=true and value is numeric', () => {
      render(<MetricCard label="Count" value={100} animated />);
      expect(screen.getByTestId('animated-number')).toBeDefined();
    });

    it('does not render AnimatedNumber when animated=false', () => {
      render(<MetricCard label="Count" value={100} animated={false} />);
      expect(screen.queryByTestId('animated-number')).toBeNull();
    });

    it('does not render AnimatedNumber for string values', () => {
      render(<MetricCard label="Status" value="N/A" animated />);
      expect(screen.queryByTestId('animated-number')).toBeNull();
    });
  });
});
