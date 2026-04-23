import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DateRangePicker from '../components/DateRangePicker';

const BASE_RANGE = { from: '2026-04-22T10:00:00.000Z', to: '2026-04-23T10:00:00.000Z' };

describe('DateRangePicker', () => {
  it('renders the trigger button', () => {
    render(<DateRangePicker value={BASE_RANGE} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /select time range/i })).toBeDefined();
  });

  it('opens dropdown on click', () => {
    render(<DateRangePicker value={BASE_RANGE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
    expect(screen.getByRole('listbox')).toBeDefined();
  });

  it('shows all preset options when open', () => {
    render(<DateRangePicker value={BASE_RANGE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
    expect(screen.getByRole('option', { name: '1h' })).toBeDefined();
    expect(screen.getByRole('option', { name: '24h' })).toBeDefined();
    expect(screen.getByRole('option', { name: '7d' })).toBeDefined();
    expect(screen.getByRole('option', { name: '30d' })).toBeDefined();
  });

  it('calls onChange when a preset is selected', () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={BASE_RANGE} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
    fireEvent.click(screen.getByRole('option', { name: '7d' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range] = onChange.mock.calls[0];
    expect(new Date(range.from)).toBeInstanceOf(Date);
    expect(new Date(range.to)).toBeInstanceOf(Date);
  });

  it('closes dropdown when a preset is selected', () => {
    render(<DateRangePicker value={BASE_RANGE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
    expect(screen.getByRole('listbox')).toBeDefined();
    fireEvent.click(screen.getByRole('option', { name: '24h' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows custom range inputs when open', () => {
    render(<DateRangePicker value={BASE_RANGE} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
    expect(screen.getByLabelText(/^from$/i)).toBeDefined();
    expect(screen.getByLabelText(/^to$/i)).toBeDefined();
  });

  it('closes when clicking outside (mousedown)', () => {
    // The component listens for mousedown, not click
    render(
      <div>
        <DateRangePicker value={BASE_RANGE} onChange={vi.fn()} />
        <button data-testid="outside">Outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
    expect(screen.getByRole('listbox')).toBeDefined();
    // Simulate mousedown on outside button
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
