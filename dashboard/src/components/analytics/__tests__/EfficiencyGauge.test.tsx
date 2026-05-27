import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EfficiencyGauge } from '../EfficiencyGauge';

describe('EfficiencyGauge', () => {
  it('renders with role="meter"', () => {
    render(<EfficiencyGauge score={75} unit="tok/ln" displayValue="42" />);
    expect(screen.getByRole('meter')).toBeDefined();
  });

  it('displays the value and unit', () => {
    render(<EfficiencyGauge score={75} unit="tok/ln" displayValue="42" />);
    expect(screen.getByText('42')).toBeDefined();
    expect(screen.getByText('tok/ln')).toBeDefined();
  });

  it('sets aria-valuenow, min, max', () => {
    render(<EfficiencyGauge score={75} unit="tok/ln" displayValue="42" />);
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('75');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps score above 100', () => {
    render(<EfficiencyGauge score={150} unit="tok/ln" displayValue="high" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('100');
  });

  it('clamps score below 0', () => {
    render(<EfficiencyGauge score={-10} unit="tok/ln" displayValue="low" />);
    expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0');
  });

  it('uses custom aria-label', () => {
    render(<EfficiencyGauge score={50} unit="%" displayValue="50%" ariaLabel="Custom label" />);
    expect(screen.getByRole('meter').getAttribute('aria-label')).toBe('Custom label');
  });

  it('renders progress bar with correct width', () => {
    const { container } = render(<EfficiencyGauge score={60} unit="%" displayValue="60%" />);
    const bar = container.querySelector('.transition-all');
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe('60%');
  });

  it('applies custom barHeight', () => {
    const { container } = render(<EfficiencyGauge score={50} unit="%" displayValue="50%" barHeight={10} />);
    const track = container.querySelector('.overflow-hidden');
    expect((track as HTMLElement).style.height).toBe('10px');
  });

  it('applies custom className', () => {
    const { container } = render(<EfficiencyGauge score={50} unit="%" displayValue="50%" className="my-gauge" />);
    const gauge = container.firstChild as HTMLElement;
    expect(gauge.className).toContain('my-gauge');
  });
});
