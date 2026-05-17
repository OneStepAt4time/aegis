/**
 * ConfirmDestructive tests — hold-to-confirm and type-to-confirm buttons.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDestructive } from './ConfirmDestructive';

describe('ConfirmDestructive — hold mode', () => {
  it('renders button with label', () => {
    render(<ConfirmDestructive mode="hold" label="Delete" onConfirm={vi.fn()} />);
    expect(screen.getByText('Delete')).not.toBeNull();
  });

  it('has aria-label', () => {
    render(<ConfirmDestructive mode="hold" label="Delete" onConfirm={vi.fn()} />);
    expect(screen.getByLabelText('Hold to Delete')).not.toBeNull();
  });

  it('disables button when disabled prop is true', () => {
    render(<ConfirmDestructive mode="hold" label="Delete" onConfirm={vi.fn()} disabled />);
    expect(screen.getByLabelText('Hold to Delete').hasAttribute('disabled')).toBe(true);
  });
});

describe('ConfirmDestructive — type mode', () => {
  it('renders initial button with label', () => {
    render(<ConfirmDestructive mode="type" label="Delete" onConfirm={vi.fn()} />);
    expect(screen.getByText('Delete')).not.toBeNull();
  });

  it('opens confirmation input on click', () => {
    render(<ConfirmDestructive mode="type" label="Delete" entityName="my-session" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByPlaceholderText('my-session')).not.toBeNull();
  });

  it('confirm button disabled when input does not match entityName', () => {
    render(<ConfirmDestructive mode="type" label="Delete" entityName="my-session" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText('Delete'));
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);
  });

  it('confirm button enabled when input matches entityName', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDestructive mode="type" label="Delete" entityName="my-session" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Delete'));
    const input = screen.getByPlaceholderText('my-session');
    fireEvent.change(input, { target: { value: 'my-session' } });
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
  });

  it('calls onConfirm when matching input and confirm clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDestructive mode="type" label="Delete" entityName="my-session" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Delete'));
    const input = screen.getByPlaceholderText('my-session');
    fireEvent.change(input, { target: { value: 'my-session' } });
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('closes on Cancel click', () => {
    render(<ConfirmDestructive mode="type" label="Delete" entityName="my-session" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText('Delete'));
    fireEvent.click(screen.getByText('Cancel'));
    // Back to initial button state
    expect(screen.getByText('Delete')).not.toBeNull();
    expect(screen.queryByPlaceholderText('my-session')).toBeNull();
  });

  it('renders entityName in instruction text', () => {
    render(<ConfirmDestructive mode="type" label="Delete" entityName="test-entity" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByText('test-entity', { selector: '.font-mono' })).not.toBeNull();
  });
});
