/**
 * __tests__/EfficiencyGauge.test.tsx — Tests for CCMeter-inspired efficiency gauge.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EfficiencyGauge } from '../components/analytics/EfficiencyGauge';

describe('EfficiencyGauge', () => {
  it('renders display value and unit', () => {
    render(<EfficiencyGauge score={85} unit="tok/ln" displayValue="99" />);
    expect(screen.getByText('99')).not.toBeNull();
    expect(screen.getByText('tok/ln')).not.toBeNull();
  });

  it('has meter role with aria attributes', () => {
    render(<EfficiencyGauge score={85} unit="tok/ln" displayValue="99" />);
    const meter = screen.getByRole('meter');
    expect(meter).not.toBeNull();
    expect(meter.getAttribute('aria-valuenow')).toBe('85');
    expect(meter.getAttribute('aria-valuemin')).toBe('0');
    expect(meter.getAttribute('aria-valuemax')).toBe('100');
  });

  it('uses custom aria-label', () => {
    render(<EfficiencyGauge score={50} unit="tok/ln" displayValue="50" ariaLabel="Code efficiency" />);
    expect(screen.getByRole('meter', { name: 'Code efficiency' })).not.toBeNull();
  });

  it('defaults aria-label from props', () => {
    render(<EfficiencyGauge score={85} unit="tok/ln" displayValue="99" />);
    expect(screen.getByRole('meter', { name: 'Efficiency: 99 tok/ln' })).not.toBeNull();
  });

  it('clamps score to 0-100 range', () => {
    const { rerender } = render(<EfficiencyGauge score={-10} unit="tok/ln" displayValue="-10" />);
    let meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('0');

    rerender(<EfficiencyGauge score={150} unit="tok/ln" displayValue="150" />);
    meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('100');
  });

  it('renders bar with fill width matching score', () => {
    const { container } = render(<EfficiencyGauge score={75} unit="tok/ln" displayValue="75" />);
    const fill = container.querySelector('.absolute.inset-y-0.left-0');
    expect(fill).not.toBeNull();
    expect(fill!.getAttribute('style')).toContain('width: 75%');
  });
});
