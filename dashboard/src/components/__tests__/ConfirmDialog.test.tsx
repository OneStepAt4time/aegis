import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

// Mock useFocusTrap to return a plain ref
vi.mock('../../hooks/useFocusTrap.js', () => ({
  useFocusTrap: () => ({ current: document.createElement('div') }),
}));

describe('ConfirmDialog', () => {
  const defaults = {
    open: true,
    title: 'Delete item?',
    message: 'This action cannot be undone.',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(<ConfirmDialog {...defaults} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders title and message when open=true', () => {
    render(<ConfirmDialog {...defaults} />);
    expect(screen.getByText('Delete item?')).not.toBeNull();
    expect(screen.getByText('This action cannot be undone.')).not.toBeNull();
  });

  it('has role="alertdialog" and aria-modal="true"', () => {
    render(<ConfirmDialog {...defaults} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('links title via aria-labelledby', () => {
    render(<ConfirmDialog {...defaults} />);
    const dialog = screen.getByRole('alertdialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('confirm-dialog-title');
    const title = document.getElementById('confirm-dialog-title');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('Delete item?');
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...defaults} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaults} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaults} onCancel={onCancel} />);
    // Backdrop is the first child div inside the fixed overlay
    const overlay = screen.getByRole('alertdialog').parentElement!;
    const backdrop = overlay.firstChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('uses custom confirmLabel and cancelLabel', () => {
    render(<ConfirmDialog {...defaults} confirmLabel="Delete" cancelLabel="Go back" />);
    expect(screen.getByText('Delete')).not.toBeNull();
    expect(screen.getByText('Go back')).not.toBeNull();
  });

  it('auto-focuses confirm button after opening', () => {
    render(<ConfirmDialog {...defaults} />);
    act(() => { vi.advanceTimersByTime(100); });
    const confirmBtn = screen.getByText('Confirm');
    expect(document.activeElement).toBe(confirmBtn);
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...defaults} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('applies danger variant styles to confirm button', () => {
    render(<ConfirmDialog {...defaults} variant="danger" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.getAttribute('class')).toContain('color-danger');
  });

  it('applies warning variant styles to confirm button', () => {
    render(<ConfirmDialog {...defaults} variant="warning" />);
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.getAttribute('class')).toContain('color-warning');
  });

  it('renders confirm and cancel buttons as type="button"', () => {
    render(<ConfirmDialog {...defaults} />);
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn.getAttribute('type')).toBe('button');
    }
  });
});
