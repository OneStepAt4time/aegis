/**
 * ConfirmDestructive tests — hold-to-confirm button and type-to-confirm input.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDestructive } from '../ConfirmDestructive';

describe('ConfirmDestructive', () => {
  describe('hold mode', () => {
    it('renders the label text', () => {
      render(<ConfirmDestructive mode="hold" label="Delete session" onConfirm={vi.fn()} />);
      expect(screen.getByText('Delete session')).not.toBeNull();
    });

    it('has correct aria-label', () => {
      render(<ConfirmDestructive mode="hold" label="Delete session" onConfirm={vi.fn()} />);
      const btn = screen.getByRole('button', { name: 'Hold to Delete session' });
      expect(btn).not.toBeNull();
    });

    it('disables button when disabled prop is true', () => {
      render(<ConfirmDestructive mode="hold" label="Delete" onConfirm={vi.fn()} disabled />);
      const btn = screen.getByRole('button');
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('does not call onConfirm on click alone', () => {
      const onConfirm = vi.fn();
      render(<ConfirmDestructive mode="hold" label="Delete" onConfirm={onConfirm} />);
      fireEvent.click(screen.getByRole('button'));
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('type mode', () => {
    it('renders the label in initial state', () => {
      render(<ConfirmDestructive mode="type" label="Delete project" onConfirm={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Delete project' })).not.toBeNull();
    });

    it('shows input field after clicking the button', () => {
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="my-project" onConfirm={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(screen.getByRole('textbox')).not.toBeNull();
    });

    it('shows entity name instruction after opening', () => {
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="my-app" onConfirm={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(screen.getByText('my-app')).not.toBeNull();
    });

    it('confirm button is disabled when input does not match entityName', () => {
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="my-app" onConfirm={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmBtn.hasAttribute('disabled')).toBe(true);
    });

    it('confirm button enables when input matches entityName', () => {
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="my-app" onConfirm={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'my-app' } });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmBtn.hasAttribute('disabled')).toBe(false);
    });

    it('calls onConfirm and resets when confirm is clicked with matching input', () => {
      const onConfirm = vi.fn();
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="my-app" onConfirm={onConfirm} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my-app' } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm on Enter key with matching input', () => {
      const onConfirm = vi.fn();
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="test" onConfirm={onConfirm} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('does not call onConfirm when input does not match', () => {
      const onConfirm = vi.fn();
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="test" onConfirm={onConfirm} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'wrong' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('closes on Cancel button click', () => {
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="test" onConfirm={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(screen.getByRole('textbox')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      // Back to initial state — no textbox
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('works without entityName — confirms when any non-empty input', () => {
      const onConfirm = vi.fn();
      render(
        <ConfirmDestructive mode="type" label="Delete" onConfirm={onConfirm} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'yes' } });
      // Confirm should be enabled since entityName is undefined and input is non-empty
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmBtn.hasAttribute('disabled')).toBe(false);
    });

    it('has correct aria-label on input', () => {
      render(
        <ConfirmDestructive mode="type" label="Delete" entityName="proj" onConfirm={vi.fn()} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const input = screen.getByRole('textbox');
      expect(input.getAttribute('aria-label')).toBe('Type proj to confirm');
    });

    it('disables initial button when disabled prop is true', () => {
      render(<ConfirmDestructive mode="type" label="Delete" onConfirm={vi.fn()} disabled />);
      const btn = screen.getByRole('button');
      expect(btn.hasAttribute('disabled')).toBe(true);
    });
  });
});
