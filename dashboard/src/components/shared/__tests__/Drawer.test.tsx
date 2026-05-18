/**
 * Drawer.test.tsx — Unit tests for the shared Drawer component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Drawer } from '../Drawer';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Drawer open={false} onClose={() => {}} ariaLabel="Test drawer">
        <p>Content</p>
      </Drawer>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders content when open', () => {
    render(
      <Drawer open={true} onClose={() => {}} ariaLabel="Test drawer">
        <p>Drawer content</p>
      </Drawer>,
    );
    expect(screen.getByText('Drawer content')).toBeDefined();
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Test drawer');
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <Drawer open={true} onClose={onClose} ariaLabel="Test drawer">
        <p>Content</p>
      </Drawer>,
    );
    // Backdrop is the sibling div with aria-hidden
    const dialog = screen.getByRole('dialog');
    const parent = dialog.parentElement;
    const backdrop = parent?.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    if (backdrop) {
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });
});
