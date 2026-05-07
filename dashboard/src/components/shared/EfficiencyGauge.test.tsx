/**
 * EfficiencyGauge — unit tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EfficiencyGauge } from './EfficiencyGauge';

describe('EfficiencyGauge', () => {
  it('renders without crashing', () => {
    const { container } = render(<EfficiencyGauge value={75} max={100} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('shows the label when provided', () => {
    render(<EfficiencyGauge value={75} max={100} label="156 tok/ln" />);
    expect(screen.getByText('156 tok/ln')).toBeTruthy();
  });

  it('has a progressbar role', () => {
    render(<EfficiencyGauge value={75} max={100} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
  });

  it('shows percentage in expanded mode', () => {
    render(<EfficiencyGauge value={75} max={100} />);
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('hides label and percentage in compact mode', () => {
    render(
      <EfficiencyGauge value={75} max={100} label="156 tok/ln" compact />,
    );
    // Label should not be rendered in compact mode
    expect(screen.queryByText('156 tok/ln')).toBeNull();
    expect(screen.queryByText('75%')).toBeNull();
  });

  it('handles zero max gracefully', () => {
    const { container } = render(<EfficiencyGauge value={50} max={0} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('clamps value to 100%', () => {
    render(<EfficiencyGauge value={150} max={100} />);
    expect(screen.getByText('100%')).toBeTruthy();
  });
});
