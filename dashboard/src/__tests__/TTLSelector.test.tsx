import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TTLSelector } from '../components/TTLSelector';

describe('TTLSelector', () => {
  const mockOnChange = vi.fn();

  it('renders preset buttons', () => {
    const {} = render(
      <TTLSelector value={undefined} onChange={mockOnChange} />,
    );

    expect(screen.getByRole('button', { name: '15m' })).toBeDefined();
    expect(screen.getByRole('button', { name: '1h' })).toBeDefined();
    expect(screen.getByRole('button', { name: '4h' })).toBeDefined();
    expect(screen.getByRole('button', { name: '8h' })).toBeDefined();
  });

  it('highlights the selected preset', () => {
    const {} = render(
      <TTLSelector value={15 * 60} onChange={mockOnChange} />,
    );

    const btn15m = screen.getByRole('button', { name: '15m' }) as HTMLButtonElement;
    expect(btn15m.className).toContain('bg-[#00e5ff]/10');
    expect(btn15m.className).toContain('text-[#00e5ff]');
  });

  it('calls onChange when a preset is clicked', () => {
    const onChange = vi.fn();
    render(<TTLSelector value={undefined} onChange={onChange} />);

    const btn1h = screen.getByRole('button', { name: '1h' });
    fireEvent.click(btn1h);

    expect(onChange).toHaveBeenCalledWith(60 * 60);
  });

  it('allows custom duration entry', () => {
    const onChange = vi.fn();
    render(<TTLSelector value={undefined} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Custom minutes…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });

    expect(onChange).toHaveBeenCalledWith(30 * 60);
  });

  it('displays formatted duration for custom input', () => {
    render(<TTLSelector value={undefined} onChange={vi.fn()} />);

    const input = screen.getByPlaceholderText('Custom minutes…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '90' } });

    expect(screen.getByText('1h 30m')).toBeDefined();
  });

  it('displays current TTL value', () => {
    render(<TTLSelector value={4 * 60 * 60} onChange={vi.fn()} />);

    expect(screen.getByText(/TTL: 4h/)).toBeDefined();
  });

  it('clears custom input when preset is clicked', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TTLSelector value={undefined} onChange={onChange} />,
    );

    const input = screen.getByPlaceholderText('Custom minutes…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });
    expect(input.value).toBe('30');

    const btn1h = screen.getByRole('button', { name: '1h' });
    fireEvent.click(btn1h);

    rerender(<TTLSelector value={60 * 60} onChange={onChange} />);
    expect(input.value).toBe('');
  });

  it('clears TTL when custom input is emptied', () => {
    const onChange = vi.fn();
    render(<TTLSelector value={undefined} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Custom minutes…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith(30 * 60);

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('ignores invalid custom input', () => {
    const onChange = vi.fn();
    render(<TTLSelector value={undefined} onChange={onChange} />);

    const input = screen.getByPlaceholderText('Custom minutes…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'invalid' } });

    // onChange should not be called with invalid input
    expect(onChange).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it('shows custom value as selected when value is not a preset', () => {
    render(<TTLSelector value={37 * 60} onChange={vi.fn()} />);

    // Should show the custom input with the value
    const input = screen.getByPlaceholderText('Custom minutes…') as HTMLInputElement;
    expect(input.value).toBe('37');

    // Should display the formatted duration
    expect(screen.getByText('37m')).toBeDefined();
  });
});
