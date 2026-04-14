import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from '../components/ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders nothing when open is false', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Test"
        message="Test message"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders the dialog when open is true', () => {
    render(
      <ConfirmDialog
        open
        title="Delete Item"
        message="Are you sure?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(screen.getByText('Delete Item')).toBeDefined();
    expect(screen.getByText('Are you sure?')).toBeDefined();
  });

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    // The backdrop is the first div child with absolute inset-0
    const backdrop = screen.getByRole('alertdialog').parentElement?.querySelector('.absolute');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel on Escape key', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('uses custom labels', () => {
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Delete')).toBeDefined();
    expect(screen.getByText('Keep')).toBeDefined();
  });

  it('has aria-labelledby pointing to the title', () => {
    render(
      <ConfirmDialog
        open
        title="My Title"
        message="Body text"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('alertdialog');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).not.toBeNull();
    const titleEl = document.getElementById(titleId!);
    expect(titleEl?.textContent).toBe('My Title');
  });

  it('applies danger variant styles to confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        variant="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('text-red-300');
  });

  it('applies warning variant styles to confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        variant="warning"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('text-amber-300');
  });

  it('applies default variant styles to confirm button', () => {
    render(
      <ConfirmDialog
        open
        title="Test"
        message="Test"
        variant="default"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const confirmBtn = screen.getByText('Confirm');
    expect(confirmBtn.className).toContain('text-[var(--color-accent)]');
  });
});
